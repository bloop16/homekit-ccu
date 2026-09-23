const path = require('path')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const StreamingDelegate = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'StreamingDelegate.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))

const FAKE = path.join(__dirname, 'fixtures', 'fake-ffmpeg.sh')
const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const settings = {
  ffmpegPath: FAKE,
  source: '-i rtsp://cam/stream',
  stillImageSource: '-i http://cam/snap.jpg',
  vcodec: 'libx264',
  maxWidth: 1280,
  maxHeight: 720,
  maxFPS: 15,
  maxBitrate: 1000,
  audio: true,
  returnAudioTarget: ''
}

const key = Buffer.alloc(16, 1)
const salt = Buffer.alloc(14, 2)

function prepareRequest (sessionID) {
  return {
    sessionID,
    sourceAddress: '192.168.1.5',
    targetAddress: '192.168.1.20',
    addressVersion: 'ipv4',
    video: { port: 50000, srtpCryptoSuite: hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80, srtp_key: key, srtp_salt: salt },
    audio: { port: 50002, srtpCryptoSuite: hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80, srtp_key: key, srtp_salt: salt }
  }
}

function startRequest (sessionID, withAudio) {
  return {
    sessionID,
    type: hap.StreamRequestTypes.START,
    video: { codec: 0, profile: 1, level: 0, packetizationMode: 0, width: 1280, height: 720, fps: 15, pt: 99, ssrc: 1, max_bit_rate: 800, rtcp_interval: 0.5, mtu: 1316 },
    audio: withAudio
      ? { codec: hap.AudioStreamingCodecType.OPUS, channel: 1, bit_rate: 0, sample_rate: hap.AudioStreamingSamplerate.KHZ_16, packet_time: 20, pt: 110, ssrc: 2, max_bit_rate: 24, rtcp_interval: 5, comfort_pt: 13, comfortNoiseEnabled: false }
      : undefined
  }
}

function prepare (delegate, sessionID) {
  return new Promise((resolve, reject) => {
    delegate.prepareStream(prepareRequest(sessionID), (err, response) => err ? reject(err) : resolve(response))
  })
}

async function waitFor (condition, timeoutMs = 3000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('condition not met within ' + timeoutMs + 'ms')
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function stream (delegate, request) {
  return new Promise((resolve, reject) => {
    delegate.handleStreamRequest(request, (err) => err ? reject(err) : resolve())
  })
}

describe('HomeKit-CCU StreamingDelegate', () => {
  let delegate
  let forced

  beforeEach(() => {
    forced = []
    delegate = new StreamingDelegate('Test Door', settings, log)
    delegate.attachController({ forceStopStreamingSession: (id) => forced.push(id) })
  })

  afterEach(async () => {
    await delegate.shutdown()
  })

  it('answers snapshot requests with the image from ffmpeg', (done) => {
    delegate.handleSnapshotRequest({ width: 640, height: 480 }, (err, buffer) => {
      expect(err).to.be(undefined)
      expect(buffer.toString()).to.contain('FAKEJPEG')
      done()
    })
  })

  it('reports snapshot errors instead of throwing', (done) => {
    const broken = new StreamingDelegate('Broken', { ...settings, ffmpegPath: '/nonexistent/ffmpeg' }, log)
    broken.handleSnapshotRequest({ width: 640, height: 480 }, (err, buffer) => {
      expect(err).to.be.an(Error)
      expect(buffer).to.be(undefined)
      done()
    })
  })

  it('prepares a session with fresh ssrcs and local ports', async () => {
    const response = await prepare(delegate, 'sess-1')
    expect(response.video.ssrc).to.be.a('number')
    expect(response.audio.ssrc).to.be.a('number')
    expect(response.video.ssrc).to.not.be(response.audio.ssrc)
    expect(response.video.port).to.be.within(1024, 65535)
    expect(response.video.srtp_key).to.eql(key)
    expect(response.audio.srtp_salt).to.eql(salt)
    expect(delegate.pendingSessions.has('sess-1')).to.be(true)
    const session = delegate.pendingSessions.get('sess-1')
    expect(session.address).to.be('192.168.1.20')
    expect(session.videoPort).to.be(50000)
    expect(session.videoSRTP).to.eql(Buffer.concat([key, salt]))
  })

  it('starts and stops a video/audio stream', async () => {
    await prepare(delegate, 'sess-2')
    await stream(delegate, startRequest('sess-2', true))
    expect(delegate.pendingSessions.has('sess-2')).to.be(false)
    const active = delegate.ongoingSessions.get('sess-2')
    expect(active.main.isRunning()).to.be(true)
    expect(active.returnAudio).to.be(null)
    await stream(delegate, { sessionID: 'sess-2', type: hap.StreamRequestTypes.STOP })
    expect(delegate.ongoingSessions.has('sess-2')).to.be(false)
    expect(active.main.isRunning()).to.be(false)
  })

  it('starts a return audio process when a target is configured', async () => {
    await delegate.shutdown()
    delegate = new StreamingDelegate('Test Door', { ...settings, returnAudioTarget: 'rtsp://cam/talk' }, log)
    delegate.attachController({ forceStopStreamingSession: (id) => forced.push(id) })
    await prepare(delegate, 'sess-3')
    await stream(delegate, startRequest('sess-3', true))
    const active = delegate.ongoingSessions.get('sess-3')
    expect(active.returnAudio.isRunning()).to.be(true)
    await stream(delegate, { sessionID: 'sess-3', type: hap.StreamRequestTypes.STOP })
    expect(active.returnAudio.isRunning()).to.be(false)
  })

  it('acknowledges reconfigure without touching the process', async () => {
    await prepare(delegate, 'sess-4')
    await stream(delegate, startRequest('sess-4', false))
    const active = delegate.ongoingSessions.get('sess-4')
    await stream(delegate, { sessionID: 'sess-4', type: hap.StreamRequestTypes.RECONFIGURE, video: { width: 640, height: 480, fps: 10, max_bit_rate: 300, rtcp_interval: 0.5 } })
    expect(active.main.isRunning()).to.be(true)
  })

  it('forces the session to stop when ffmpeg dies', async () => {
    await delegate.shutdown()
    delegate = new StreamingDelegate('Test Door', settings, log, { env: { FAKE_EXIT_CODE: '2' } })
    delegate.attachController({ forceStopStreamingSession: (id) => forced.push(id) })
    await prepare(delegate, 'sess-5')
    await stream(delegate, startRequest('sess-5', false))
    await waitFor(() => forced.length > 0)
    expect(forced).to.eql(['sess-5'])
    expect(delegate.ongoingSessions.has('sess-5')).to.be(false)
  })

  it('streams video only when audio is disabled, even if hap sends audio parameters', async () => {
    await delegate.shutdown()
    delegate = new StreamingDelegate('Test Door', { ...settings, audio: false, returnAudioTarget: 'rtsp://cam/talk' }, log)
    await prepare(delegate, 'sess-6')
    await stream(delegate, startRequest('sess-6', true))
    const active = delegate.ongoingSessions.get('sess-6')
    expect(active.main.args.join(' ')).to.not.contain('libopus')
    expect(active.returnAudio).to.be(null)
  })

  it('stops the whole session when the return audio process dies', async () => {
    await delegate.shutdown()
    delegate = new StreamingDelegate('Test Door', { ...settings, returnAudioTarget: 'rtsp://cam/talk' }, log)
    delegate.attachController({ forceStopStreamingSession: (id) => forced.push(id) })
    await prepare(delegate, 'sess-7')
    await stream(delegate, startRequest('sess-7', true))
    const active = delegate.ongoingSessions.get('sess-7')
    process.kill(active.returnAudio.child.pid, 'SIGKILL')
    await waitFor(() => forced.length > 0)
    expect(forced).to.eql(['sess-7'])
    expect(active.main.isRunning()).to.be(false)
  })

  it('acknowledges a stop for an unknown session', async () => {
    await prepare(delegate, 'sess-8')
    await stream(delegate, { sessionID: 'sess-8', type: hap.StreamRequestTypes.STOP })
    expect(delegate.pendingSessions.has('sess-8')).to.be(false)
  })

  it('rejects an unknown stream request type', async () => {
    let error
    try {
      await stream(delegate, { sessionID: 'x', type: 'bogus' })
    } catch (e) { error = e }
    expect(error).to.be.an(Error)
  })

  it('fails and warns on a start request for an unknown session', async () => {
    const rec = recordingLog()
    delegate = new StreamingDelegate('Test Door', settings, rec)
    let error
    try {
      await stream(delegate, startRequest('unknown', false))
    } catch (e) { error = e }
    expect(error).to.be.an(Error)
    expect(rec.text('warn')).to.contain('unknown')
  })

  it('still answers STOP when stopping fails', async () => {
    const rec = recordingLog()
    delegate = new StreamingDelegate('Test Door', settings, rec)
    delegate.stopStream = () => Promise.reject(new Error('boom'))
    await stream(delegate, { sessionID: 'sess-9', type: hap.StreamRequestTypes.STOP })
    expect(rec.text('error')).to.contain('boom')
    delegate = new StreamingDelegate('Test Door', settings, log)
  })

  it('still forces the session to stop when cleanup after a crash fails', async () => {
    const rec = recordingLog()
    delegate = new StreamingDelegate('Test Door', settings, rec, { env: { FAKE_EXIT_CODE: '2' } })
    delegate.attachController({ forceStopStreamingSession: (id) => forced.push(id) })
    await prepare(delegate, 'sess-10')
    await stream(delegate, startRequest('sess-10', false))
    const realStop = delegate.stopStream.bind(delegate)
    delegate.stopStream = () => Promise.reject(new Error('cleanup failed'))
    await waitFor(() => forced.length > 0)
    expect(forced).to.eql(['sess-10'])
    expect(rec.text('error')).to.contain('cleanup failed')
    delegate.stopStream = realStop
  })
})
