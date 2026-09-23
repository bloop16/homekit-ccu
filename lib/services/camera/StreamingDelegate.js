'use strict'

const path = require('path')
const { CameraController, StreamRequestTypes } = require('@homebridge/hap-nodejs')
const FfmpegProcess = require(path.join(__dirname, 'FfmpegProcess.js'))
const { reserveUdpPort } = require(path.join(__dirname, 'udpPort.js'))
const { buildSnapshotArgs, buildStreamArgs, buildReturnAudioSdp, buildReturnAudioArgs } = require(path.join(__dirname, 'ffmpegArgs.js'))

const SNAPSHOT_TIMEOUT_MS = 15000

/**
 * Implements hap CameraStreamingDelegate on top of ffmpeg.
 * settings: { ffmpegPath, source, stillImageSource, vcodec, maxWidth, maxHeight, maxFPS, maxBitrate, audio, returnAudioTarget }
 *   audio must be false when no audio codec was offered to HomeKit: hap then fakes an Opus
 *   configuration and still sends audio parameters with every START request.
 * options:  { env } (passed to every ffmpeg process, used by tests)
 */
class StreamingDelegate {
  constructor (name, settings, log, options = {}) {
    this.name = name
    this.settings = settings
    this.log = log
    this.processEnv = options.env || {}
    this.controller = null
    this.pendingSessions = new Map()
    this.ongoingSessions = new Map()
  }

  /**
   * The controller is needed to force-stop a session whose ffmpeg died.
   */
  attachController (controller) {
    this.controller = controller
  }

  /**
   * hap SnapshotRequestCallback: callback(error?, buffer?)
   */
  handleSnapshotRequest (request, callback) {
    const args = buildSnapshotArgs(this.settings, request)
    FfmpegProcess.collectStdout(this.settings.ffmpegPath, args, this.log, SNAPSHOT_TIMEOUT_MS, this.processEnv)
      .then((buffer) => callback(undefined, buffer))
      .catch((err) => {
        this.log.error('[Camera %s] snapshot failed: %s', this.name, err.message)
        callback(err)
      })
  }

  /**
   * Reserve local return ports and SSRCs for a new session; hap PrepareStreamCallback: callback(error?, response?)
   */
  prepareStream (request, callback) {
    Promise.all([reserveUdpPort(request.addressVersion), reserveUdpPort(request.addressVersion)])
      .then(([videoReturnPort, audioReturnPort]) => {
        const session = {
          address: request.targetAddress,
          addressVersion: request.addressVersion,
          videoPort: request.video.port,
          videoReturnPort,
          videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
          videoSSRC: CameraController.generateSynchronisationSource(),
          audioPort: request.audio.port,
          audioReturnPort,
          audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
          audioSSRC: CameraController.generateSynchronisationSource()
        }
        this.pendingSessions.set(request.sessionID, session)
        callback(undefined, {
          video: { port: videoReturnPort, ssrc: session.videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt },
          audio: { port: audioReturnPort, ssrc: session.audioSSRC, srtp_key: request.audio.srtp_key, srtp_salt: request.audio.srtp_salt }
        })
      })
      .catch((err) => {
        this.log.error('[Camera %s] prepareStream failed: %s', this.name, err.message)
        callback(err)
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

  startStream (request, callback) {
    const session = this.pendingSessions.get(request.sessionID)
    if (!session) {
      this.log.warn('[Camera %s] start requested for unknown session %s', this.name, request.sessionID)
      callback(new Error(`no prepared session ${request.sessionID}`))
      return
    }
    this.pendingSessions.delete(request.sessionID)
    const audio = this.settings.audio === false ? null : (request.audio || null)
    const onExit = (code, signal, expected) => {
      if (!expected) {
        this.log.error('[Camera %s] ffmpeg for session %s died (code %s), stopping session', this.name, request.sessionID, code)
        this.stopStream(request.sessionID)
          .catch((err) => this.log.error('[Camera %s] cleaning up session %s failed: %s', this.name, request.sessionID, err.message))
          .then(() => {
            if (this.controller) {
              this.controller.forceStopStreamingSession(request.sessionID)
            }
          })
      }
    }
    const main = new FfmpegProcess('video', this.settings.ffmpegPath, buildStreamArgs(this.settings, session, { video: request.video, audio }), this.log, { env: this.processEnv, onExit })
    let returnAudio = null
    if (audio && this.settings.returnAudioTarget) {
      returnAudio = new FfmpegProcess('return-audio', this.settings.ffmpegPath, buildReturnAudioArgs(this.settings.returnAudioTarget, audio), this.log, { env: this.processEnv, onExit })
    }
    this.ongoingSessions.set(request.sessionID, { session, main, returnAudio })
    main.start()
    if (returnAudio) {
      returnAudio.start()
      returnAudio.writeStdin(buildReturnAudioSdp(session, audio))
    }
    this.log.info('[Camera %s] stream %s started (%sx%s, audio %s, talkback %s)', this.name, request.sessionID, request.video.width, request.video.height, audio ? audio.codec : 'off', returnAudio ? 'on' : 'off')
    callback()
  }

  /**
   * Kill all ffmpeg processes of a session. Safe to call for unknown or already stopped sessions.
   */
  async stopStream (sessionID) {
    const active = this.ongoingSessions.get(sessionID)
    if (!active) {
      this.pendingSessions.delete(sessionID)
      return
    }
    this.ongoingSessions.delete(sessionID)
    await active.main.stop()
    if (active.returnAudio) {
      await active.returnAudio.stop()
    }
    this.log.info('[Camera %s] stream %s stopped', this.name, sessionID)
  }

  /**
   * Stop every running session (server shutdown).
   */
  async shutdown () {
    for (const sessionID of Array.from(this.ongoingSessions.keys())) {
      await this.stopStream(sessionID)
    }
    this.pendingSessions.clear()
  }
}

module.exports = StreamingDelegate
