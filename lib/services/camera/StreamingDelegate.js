'use strict'

const path = require('path')
const { CameraController, StreamRequestTypes } = require('@homebridge/hap-nodejs')
const FfmpegProcess = require(path.join(__dirname, 'FfmpegProcess.js'))
const udpPort = require(path.join(__dirname, 'udpPort.js'))
const { watchdogSeconds, startRtcpWatchdog } = require(path.join(__dirname, 'rtcpWatchdog.js'))
const { buildSnapshotArgs, buildStreamArgs, buildReturnAudioSdp, buildReturnAudioArgs } = require(path.join(__dirname, 'ffmpegArgs.js'))

const SNAPSHOT_TIMEOUT_MS = 15000
const SNAPSHOT_CACHE_MS = 5000
const WATCHDOG_FLOOR_SECONDS = 10
// battery doorbells may need a long time until the first frame reaches the viewer
const WATCHDOG_INITIAL_SECONDS = 30

/**
 * Implements hap CameraStreamingDelegate on top of ffmpeg.
 * settings: { ffmpegPath, source, stillImageSource, vcodec, maxWidth, maxHeight, maxFPS, maxBitrate, audio, returnAudioTarget }
 *   audio must be false when no audio codec was offered to HomeKit: hap then fakes an Opus
 *   configuration and still sends audio parameters with every START request.
 * options (mostly for tests): { env, killTimeoutMs, collectStdout, snapshotCacheMs, watchdogFloorSeconds,
 *   watchdogInitialSeconds, bindUdpSocket, reserveUdpPortPair }; stillImage: a StillImage
 *   (util/doorbellImage.js) that answers snapshots instead of a frame of the video
 */
class StreamingDelegate {
  constructor (name, settings, log, options = {}) {
    this.name = name
    this.settings = settings
    this.log = log
    this.processEnv = options.env || {}
    this.killTimeoutMs = options.killTimeoutMs
    this.collectStdout = options.collectStdout || FfmpegProcess.collectStdout
    this.snapshotCacheMs = options.snapshotCacheMs !== undefined ? options.snapshotCacheMs : SNAPSHOT_CACHE_MS
    this.watchdogFloorSeconds = options.watchdogFloorSeconds !== undefined ? options.watchdogFloorSeconds : WATCHDOG_FLOOR_SECONDS
    this.watchdogInitialSeconds = options.watchdogInitialSeconds !== undefined ? options.watchdogInitialSeconds : WATCHDOG_INITIAL_SECONDS
    // return ports in the range the firewall opens (udpPort.js)
    this.bindUdpSocket = options.bindUdpSocket || udpPort.bindReturnSocket
    this.reserveUdpPortPair = options.reserveUdpPortPair || udpPort.reserveUdpPortPair
    this.releaseUdpPortPair = options.releaseUdpPortPair || udpPort.releaseUdpPortPair
    this.shuttingDown = false
    this.controller = null
    this.pendingSessions = new Map()
    this.ongoingSessions = new Map()
    this.snapshotInFlight = null
    this.snapshotCache = null
    // a picture (util/doorbellImage.js StillImage) instead of a frame of the video
    this.stillImage = options.stillImage
  }

  /**
   * The controller is needed to force-stop a session whose ffmpeg died or whose viewer went away.
   */
  attachController (controller) {
    this.controller = controller
  }

  /**
   * hap SnapshotRequestCallback: callback(error?, buffer?)
   */
  handleSnapshotRequest (request, callback) {
    this.snapshot(request)
      .then((buffer) => callback(undefined, buffer))
      .catch((err) => {
        this.log.error('[Camera %s] snapshot failed: %s', this.name, err.message)
        callback(err)
      })
  }

  /**
   * One ffmpeg run serves all concurrent requests; the last image is reused for snapshotCacheMs.
   */
  snapshot (request) {
    if (this.stillImage) {
      return this.stillImage.snapshot(request.width, request.height)
    }
    if (this.snapshotCache && Date.now() - this.snapshotCache.time < this.snapshotCacheMs) {
      return Promise.resolve(this.snapshotCache.buffer)
    }
    if (!this.snapshotInFlight) {
      const args = buildSnapshotArgs(this.settings, request)
      this.snapshotInFlight = this.collectStdout(this.settings.ffmpegPath, args, this.log, SNAPSHOT_TIMEOUT_MS, this.processEnv)
        .then((buffer) => {
          this.snapshotCache = { buffer, time: Date.now() }
          return buffer
        })
        .finally(() => { this.snapshotInFlight = null })
    }
    return this.snapshotInFlight
  }

  /**
   * Bind the video return socket (RTCP watchdog), reserve the return audio ports and create SSRCs;
   * hap PrepareStreamCallback: callback(error?, response?)
   */
  prepareStream (request, callback) {
    Promise.allSettled([this.bindVideoReturnSocket(request.addressVersion), this.reserveUdpPortPair(request.addressVersion)])
      .then(([bound, reserved]) => {
        const failure = [bound, reserved].find(result => result.status === 'rejected')
        if (failure || this.shuttingDown) {
          // never leak a socket that was bound while the other half failed or the camera went away
          if (bound.status === 'fulfilled') {
            bound.value.close()
          }
          throw failure ? failure.reason : new Error('camera is shutting down')
        }
        this.registerPendingSession(request, bound.value, reserved.value, callback)
      })
      .catch((err) => {
        this.log.error('[Camera %s] prepareStream failed: %s', this.name, err.message)
        callback(err)
      })
  }

  /**
   * Bind the video return socket and log its errors right away: an 'error' event without a listener
   * would crash the process, also while prepareStream still waits for the audio ports.
   */
  bindVideoReturnSocket (addressVersion) {
    return this.bindUdpSocket(addressVersion).then((socket) => {
      socket.on('error', (err) => this.log.warn('[Camera %s] video return socket: %s', this.name, err.message))
      return socket
    })
  }

  registerPendingSession (request, videoReturnSocket, audioReturnPair, callback) {
    const session = {
      address: request.targetAddress,
      addressVersion: request.addressVersion,
      videoPort: request.video.port,
      videoReturnSocket,
      videoReturnPort: videoReturnSocket.address().port,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC: CameraController.generateSynchronisationSource(),
      audioPort: request.audio.port,
      audioReturnPort: audioReturnPair.rtp,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC: CameraController.generateSynchronisationSource()
    }
    this.pendingSessions.set(request.sessionID, session)
    callback(undefined, {
      video: { port: session.videoReturnPort, ssrc: session.videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt },
      audio: { port: session.audioReturnPort, ssrc: session.audioSSRC, srtp_key: request.audio.srtp_key, srtp_salt: request.audio.srtp_salt }
    })
  }

  /**
   * Dispatch START / RECONFIGURE / STOP; hap StreamRequestCallback: callback(error?)
   */
  handleStreamRequest (request, callback) {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.startStream(request, callback)
        break
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug('[Camera %s] reconfigure requested (%sx%s@%s), keeping current stream', this.name, request.video.width, request.video.height, request.video.fps)
        callback()
        break
      case StreamRequestTypes.STOP:
        this.stopStream(request.sessionID)
          .catch((err) => this.log.error('[Camera %s] stopping stream %s failed: %s', this.name, request.sessionID, err.message))
          .then(() => callback())
        break
      default:
        callback(new Error(`unknown stream request type ${request.type}`))
    }
  }

  /**
   * Seconds without RTCP after which a session is stopped.
   */
  watchdogSeconds (rtcpInterval) {
    return watchdogSeconds(rtcpInterval, this.watchdogFloorSeconds)
  }

  startStream (request, callback) {
    const session = this.pendingSessions.get(request.sessionID)
    if (!session) {
      this.log.warn('[Camera %s] start requested for unknown session %s', this.name, request.sessionID)
      callback(new Error(`no prepared session ${request.sessionID}`))
      return
    }
    this.pendingSessions.delete(request.sessionID)
    const sessionID = request.sessionID
    const audio = this.settings.audio === false ? null : (request.audio || null)
    const onExit = (code, signal, expected) => {
      if (!expected) {
        this.abortSession(sessionID, `ffmpeg for session ${sessionID} died (code ${code})`)
      }
    }
    const processOptions = { env: this.processEnv, killTimeoutMs: this.killTimeoutMs, onExit }
    const main = new FfmpegProcess('video', this.settings.ffmpegPath, buildStreamArgs(this.settings, session, { video: request.video, audio }), this.log, processOptions)
    let returnAudio = null
    if (audio && this.settings.returnAudioTarget) {
      returnAudio = new FfmpegProcess('return-audio', this.settings.ffmpegPath, buildReturnAudioArgs(this.settings.returnAudioTarget, audio), this.log, { ...processOptions, stdin: true })
    }
    const timeout = this.watchdogSeconds(request.video.rtcp_interval)
    const stopWatchdog = startRtcpWatchdog(session.videoReturnSocket, timeout, (seconds, first) => {
      const silence = first ? `within ${seconds}s of stream start` : `for ${seconds}s`
      this.abortSession(sessionID, `no RTCP from viewer ${silence}, stopping session ${sessionID}`)
    }, this.watchdogInitialSeconds)
    this.ongoingSessions.set(sessionID, { session, main, returnAudio, stopWatchdog })
    main.start()
    if (returnAudio) {
      returnAudio.start()
      returnAudio.writeStdin(buildReturnAudioSdp(session, audio))
    }
    this.log.info('[Camera %s] stream %s started (%sx%s, audio %s, talkback %s)', this.name, sessionID, request.video.width, request.video.height, audio ? audio.codec : 'off', returnAudio ? 'on' : 'off')
    callback()
  }

  /**
   * Stop a broken session on our side and tell HomeKit about it.
   */
  abortSession (sessionID, reason) {
    this.log.warn('[Camera %s] %s', this.name, reason)
    this.stopStream(sessionID)
      .catch((err) => this.log.error('[Camera %s] cleaning up session %s failed: %s', this.name, sessionID, err.message))
      .then(() => {
        if (this.controller) {
          this.controller.forceStopStreamingSession(sessionID)
        }
      })
  }

  /**
   * Stop all ffmpeg processes of a session in parallel and release its socket.
   * Safe to call for pending, unknown or already stopped sessions.
   */
  async stopStream (sessionID) {
    const pending = this.pendingSessions.get(sessionID)
    if (pending) {
      this.pendingSessions.delete(sessionID)
      pending.videoReturnSocket.close()
      this.releaseUdpPortPair(pending.audioReturnPort)
    }
    const active = this.ongoingSessions.get(sessionID)
    if (!active) {
      return
    }
    this.ongoingSessions.delete(sessionID)
    active.stopWatchdog()
    active.session.videoReturnSocket.close()
    await Promise.all([active.main.stop(), active.returnAudio ? active.returnAudio.stop() : null])
    // ffmpeg has left the audio return ports
    this.releaseUdpPortPair(active.session.audioReturnPort)
    this.log.info('[Camera %s] stream %s stopped', this.name, sessionID)
  }

  /**
   * Stop every session in parallel (server shutdown).
   */
  async shutdown () {
    this.shuttingDown = true
    const sessionIDs = [...this.pendingSessions.keys(), ...this.ongoingSessions.keys()]
    await Promise.all(sessionIDs.map(sessionID => this.stopStream(sessionID)))
  }

  static get SNAPSHOT_CACHE_MS () {
    return SNAPSHOT_CACHE_MS
  }
}

module.exports = StreamingDelegate
