'use strict'

// The configuration service runs as a child process; its warnings (e.g. refused api calls)
// have to end up in the log file of the add-on as well.

const path = require('path')
const fs = require('fs')
const os = require('os')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))

describe('HomeKit-CCU log of the configuration service', () => {
  const oldFile = new Logger('x').getLogFile()
  const oldEnv = process.env.UIX_LOGFILE

  after(() => {
    new Logger('x').setLogFile(oldFile)
    if (oldEnv === undefined) delete process.env.UIX_LOGFILE; else process.env.UIX_LOGFILE = oldEnv
  })

  it('takes the log file of the main process from its environment', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'configurationsrv', 'index.js'), 'utf8')
    expect(source).to.contain('logger.setLogFile(process.env.UIX_LOGFILE, false)')
  })

  it('does not rotate a shared log file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-207-'))
    try {
      const file = path.join(dir, 'homekit-ccu.log')
      fs.writeFileSync(file, 'x'.repeat(6 * 1024 * 1024))
      new Logger('x').setLogFile(file, false)
      expect(fs.existsSync(file + '.1')).to.be(false)
      new Logger('x').setLogFile(file)
      expect(fs.existsSync(file + '.1')).to.be(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
