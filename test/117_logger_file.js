'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const { once } = require('events')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))

const TWO_MB = 2 * 1024 * 1024

describe('HomeKit-CCU logger file', () => {
  let scratch, file, savedEnv
  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-117-logger-'))
    file = path.join(scratch, 'homekit-ccu.log')
    savedEnv = process.env.UIX_LOGFILE
  })
  afterEach(() => {
    new Logger().setLogFile(undefined) // later tests must not write into the scratch file
    if (savedEnv === undefined) {
      delete process.env.UIX_LOGFILE
    } else {
      process.env.UIX_LOGFILE = savedEnv
    }
    fs.rmSync(scratch, { recursive: true, force: true })
  })

  const writeLine = async (text) => {
    const log = new Logger('Test')
    log.setLogFile(file)
    const origLog = console.log
    console.log = () => {}
    try {
      log.info(text)
    } finally {
      console.log = origLog
    }
    log.close()
    await once(log.writer, 'close')
  }

  it('keeps the existing content (installer lines) and appends', async () => {
    fs.writeFileSync(file, 'installer line\n')
    await writeLine('app line')
    const content = fs.readFileSync(file, 'utf8')
    expect(content).to.contain('installer line\n')
    expect(content).to.contain('info - [Test] app line')
    expect(content.indexOf('installer line')).to.be.lessThan(content.indexOf('app line'))
  })

  it('rotates a file larger than 2 MB to .1 and starts a fresh one', async () => {
    fs.writeFileSync(file, 'x'.repeat(TWO_MB + 1))
    fs.writeFileSync(file + '.1', 'older rotation')
    await writeLine('after rotation')
    expect(fs.statSync(file + '.1').size).to.be(TWO_MB + 1)
    const content = fs.readFileSync(file, 'utf8')
    expect(content).not.to.contain('x')
    expect(content).to.contain('after rotation')
  })

  it('does not rotate a file of 2 MB or less', async () => {
    fs.writeFileSync(file, 'y'.repeat(TWO_MB))
    await writeLine('small enough')
    expect(fs.existsSync(file + '.1')).to.be(false)
    expect(fs.statSync(file).size).to.be.greaterThan(TWO_MB)
  })

  it('sets UIX_LOGFILE for the config server', () => {
    new Logger().setLogFile(file)
    expect(process.env.UIX_LOGFILE).to.be(file)
  })
})
