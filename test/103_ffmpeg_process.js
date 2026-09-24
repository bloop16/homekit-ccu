const path = require('path')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const FfmpegProcess = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'FfmpegProcess.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))
const fs = require('fs')
const os = require('os')

const FAKE = path.join(__dirname, 'fixtures', 'fake-ffmpeg.sh')
const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const READY_TIMEOUT_MS = 5000

// the fake announces on stderr once its SIGTERM handling is installed
async function ready (proc) {
  const start = Date.now()
  while (!proc.stderrTail.text().includes('fake ffmpeg ready')) {
    if (Date.now() - start > READY_TIMEOUT_MS) {
      throw new Error('fake ffmpeg did not get ready')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('HomeKit-CCU FfmpegProcess', function () {
  // spawns fake ffmpeg processes; generous timeout so a slow machine fails with a message instead of a hang
  this.timeout(10000)
  let spawned = []

  // every long running process a test creates, so afterEach can stop it even when the test failed
  function track (proc) {
    spawned.push(proc)
    return proc
  }

  afterEach(async () => {
    const running = spawned.filter(proc => proc.isRunning())
    spawned = []
    await Promise.all(running.map(proc => proc.stop()))
  })

  it('probes available encoders synchronously', () => {
    const encoders = FfmpegProcess.probeEncoders(FAKE, log)
    expect(encoders.has('libopus')).to.be(true)
    expect(encoders.has('libfdk_aac')).to.be(true)
    expect(encoders.has('libx264')).to.be(true)
    expect(encoders.has('nope')).to.be(false)
  })

  it('returns null and names ENOENT when the binary is missing', () => {
    const rec = recordingLog()
    expect(FfmpegProcess.probeEncoders('/nonexistent/ffmpeg', rec)).to.be(null)
    expect(rec.text('error')).to.contain('ENOENT')
    expect(rec.text('error')).to.contain('/nonexistent/ffmpeg')
  })

  it('returns null and suggests chmod +x when the binary is not executable', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-')), 'ffmpeg')
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o644 })
    const rec = recordingLog()
    expect(FfmpegProcess.probeEncoders(file, rec)).to.be(null)
    expect(rec.text('error')).to.contain('EACCES')
    expect(rec.text('error')).to.contain('chmod +x ' + file)
  })

  it('returns null with the stderr tail when ffmpeg exits non-zero', () => {
    const rec = recordingLog()
    process.env.FAKE_EXIT_CODE = '4'
    try {
      expect(FfmpegProcess.probeEncoders(FAKE, rec)).to.be(null)
    } finally {
      delete process.env.FAKE_EXIT_CODE
    }
    expect(rec.text('error')).to.contain('code 4')
    expect(rec.text('error')).to.contain('fake ffmpeg failing')
  })

  it('collects stdout for snapshots', async () => {
    const buf = await FfmpegProcess.collectStdout(FAKE, ['-i', 'x', '-f', 'image2', '-'], log, 2000)
    expect(buf.slice(0, 2)).to.eql(Buffer.from([0xff, 0xd8]))
    expect(buf.toString()).to.contain('FAKEJPEG')
  })

  it('rejects collectStdout on timeout', async () => {
    let error
    try {
      await FfmpegProcess.collectStdout(FAKE, ['-i', 'x'], log, 200)
    } catch (e) { error = e }
    expect(error).to.be.an(Error)
    expect(error.message).to.contain('timeout')
  })

  it('starts, reports running and stops a long running process', async () => {
    const exits = []
    const proc = track(new FfmpegProcess('video', FAKE, ['-i', 'x'], log, { onExit: (code, signal) => exits.push({ code, signal }) }))
    proc.start()
    expect(proc.isRunning()).to.be(true)
    await ready(proc)
    const started = Date.now()
    await proc.stop()
    expect(Date.now() - started).to.be.below(1000)
    expect(proc.isRunning()).to.be(false)
    expect(exits.length).to.be(1)
    // the fake traps SIGTERM and exits cleanly
    expect(exits[0].code).to.be(0)
    expect(exits[0].signal).to.be(null)
  })

  it('kills with SIGKILL when SIGTERM is ignored', async () => {
    const exits = []
    const proc = track(new FfmpegProcess('video', FAKE, ['-i', 'x'], log, {
      env: { FAKE_IGNORE_TERM: '1' },
      killTimeoutMs: 200,
      onExit: (code, signal, expected) => exits.push({ code, signal, expected })
    }))
    proc.start()
    await ready(proc)
    const started = Date.now()
    await proc.stop()
    expect(Date.now() - started).to.be.within(180, 1000)
    expect(exits).to.eql([{ code: null, signal: 'SIGKILL', expected: true }])
  })

  it('waits 1500 ms for SIGTERM by default', () => {
    expect(new FfmpegProcess('video', FAKE, [], log).killTimeoutMs).to.be(1500)
  })

  it('tracks live children for orphan protection', async () => {
    const proc = track(new FfmpegProcess('video', FAKE, ['-i', 'x'], log, {}))
    proc.start()
    const child = proc.child
    expect(FfmpegProcess.liveChildren.has(child)).to.be(true)
    await proc.stop()
    expect(FfmpegProcess.liveChildren.has(child)).to.be(false)
    expect(FfmpegProcess.liveChildren.size).to.be(0)
  })

  it('does not open stdin unless asked to', async () => {
    const proc = track(new FfmpegProcess('video', FAKE, ['-i', 'x'], log, {}))
    proc.start()
    expect(proc.child.stdin).to.be(null)
    proc.writeStdin('ignored')
    await proc.stop()
  })

  it('reports unexpected exit with code', (done) => {
    const proc = track(new FfmpegProcess('video', FAKE, ['-i', 'x'], log, {
      env: { FAKE_EXIT_CODE: '3' },
      onExit: (code, signal, expected) => {
        expect(code).to.be(3)
        expect(expected).to.be(false)
        done()
      }
    }))
    proc.start()
  })

  it('reports a binary that cannot be spawned as unexpected exit', (done) => {
    const proc = track(new FfmpegProcess('video', '/nonexistent/ffmpeg', ['-i', 'x'], log, {
      onExit: (code, signal, expected) => {
        expect(expected).to.be(false)
        expect(proc.isRunning()).to.be(false)
        proc.stop().then(() => done())
      }
    }))
    proc.start()
  })

  it('rejects collectStdout with the redacted stderr tail when ffmpeg fails', async () => {
    let error
    try {
      await FfmpegProcess.collectStdout(FAKE, ['-i', 'x'], log, 2000, { FAKE_EXIT_CODE: '1' })
    } catch (e) { error = e }
    expect(error).to.be.an(Error)
    expect(error.message).to.be('ffmpeg snapshot exited with code 1: fake ffmpeg failing | rtsp://***@cam/stream: Connection refused')
  })

  it('appends the stderr tail to the unexpected exit warning', (done) => {
    const rec = recordingLog()
    const proc = track(new FfmpegProcess('video', FAKE, ['-i', 'x'], rec, {
      env: { FAKE_EXIT_CODE: '3' },
      onExit: () => {
        expect(rec.text('warn')).to.contain('code 3')
        expect(rec.text('warn')).to.contain('fake ffmpeg failing | rtsp://***@cam/stream: Connection refused')
        expect(rec.text()).to.not.contain('secret')
        done()
      }
    }))
    proc.start()
  })

  it('redacts credentials and SRTP keys in the logged command line', async () => {
    const rec = recordingLog()
    const proc = track(new FfmpegProcess('video', FAKE, ['-i', 'rtsp://admin:secret@cam/x', '-srtp_out_params', 'S3CR3TKEY', 'srtp://1.2.3.4:5'], rec, {}))
    proc.start()
    await proc.stop()
    expect(rec.text('debug')).to.contain('-i rtsp://***@cam/x -srtp_out_params *** srtp://1.2.3.4:5')
    expect(rec.text()).to.not.contain('secret')
    expect(rec.text()).to.not.contain('S3CR3TKEY')
  })

  it('writes stdin and closes it', async () => {
    const proc = track(new FfmpegProcess('return', FAKE, ['-f', 'sdp', '-i', 'pipe:'], log, { stdin: true }))
    proc.start()
    proc.writeStdin('v=0\r\n')
    expect(proc.isRunning()).to.be(true)
    await proc.stop()
    expect(proc.isRunning()).to.be(false)
  })
})
