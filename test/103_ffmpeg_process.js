const path = require('path')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const FfmpegProcess = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'FfmpegProcess.js'))

const FAKE = path.join(__dirname, 'fixtures', 'fake-ffmpeg.sh')
const log = new Logger('HAP Test')
log.setDebugEnabled(false)

describe('HomeKit-CCU FfmpegProcess', () => {
  it('probes available encoders synchronously', () => {
    const encoders = FfmpegProcess.probeEncoders(FAKE, log)
    expect(encoders.has('libopus')).to.be(true)
    expect(encoders.has('libfdk_aac')).to.be(true)
    expect(encoders.has('libx264')).to.be(true)
    expect(encoders.has('nope')).to.be(false)
  })

  it('returns an empty set when the binary is missing', () => {
    const encoders = FfmpegProcess.probeEncoders('/nonexistent/ffmpeg', log)
    expect(encoders.size).to.be(0)
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
    const proc = new FfmpegProcess('video', FAKE, ['-i', 'x'], log, { onExit: (code, signal) => exits.push({ code, signal }) })
    proc.start()
    expect(proc.isRunning()).to.be(true)
    await proc.stop()
    expect(proc.isRunning()).to.be(false)
    expect(exits.length).to.be(1)
    expect(exits[0].signal).to.be('SIGKILL')
  })

  it('reports unexpected exit with code', (done) => {
    const proc = new FfmpegProcess('video', FAKE, ['-i', 'x'], log, {
      env: { FAKE_EXIT_CODE: '3' },
      onExit: (code, signal, expected) => {
        expect(code).to.be(3)
        expect(expected).to.be(false)
        done()
      }
    })
    proc.start()
  })

  it('reports a binary that cannot be spawned as unexpected exit', (done) => {
    const proc = new FfmpegProcess('video', '/nonexistent/ffmpeg', ['-i', 'x'], log, {
      onExit: (code, signal, expected) => {
        expect(expected).to.be(false)
        expect(proc.isRunning()).to.be(false)
        proc.stop().then(() => done())
      }
    })
    proc.start()
  })

  it('rejects collectStdout when ffmpeg fails', async () => {
    let error
    try {
      await FfmpegProcess.collectStdout(FAKE, ['-i', 'x'], log, 2000, { FAKE_EXIT_CODE: '1' })
    } catch (e) { error = e }
    expect(error).to.be.an(Error)
    expect(error.message).to.contain('code 1')
  })

  it('writes stdin and closes it', async () => {
    const proc = new FfmpegProcess('return', FAKE, ['-f', 'sdp', '-i', 'pipe:'], log, {})
    proc.start()
    proc.writeStdin('v=0\r\n')
    expect(proc.isRunning()).to.be(true)
    await proc.stop()
    expect(proc.isRunning()).to.be(false)
  })
})
