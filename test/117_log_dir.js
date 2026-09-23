'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const expect = require('expect.js')
const { isWritableDir, selectLogDir } = require(path.join(__dirname, '..', 'lib', 'util', 'logDir.js'))

describe('HomeKit-CCU log directory', () => {
  let scratch
  beforeEach(() => { scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-117-')) })
  afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }))

  it('recognizes a writable directory', () => {
    expect(isWritableDir(scratch)).to.be(true)
  })

  it('rejects a missing path, a file and an empty value', () => {
    const file = path.join(scratch, 'file')
    fs.writeFileSync(file, '')
    expect(isWritableDir(path.join(scratch, 'missing'))).to.be(false)
    expect(isWritableDir(file)).to.be(false)
    expect(isWritableDir(undefined)).to.be(false)
    expect(isWritableDir('')).to.be(false)
  })

  it('rejects a directory without write permission', function () {
    if (process.getuid && process.getuid() === 0) {
      this.skip() // root may write everywhere
    }
    const readOnly = path.join(scratch, 'ro')
    fs.mkdirSync(readOnly, { mode: 0o555 })
    expect(isWritableDir(readOnly)).to.be(false)
  })

  it('uses the first writable candidate', () => {
    const second = fs.mkdtempSync(path.join(scratch, 'b-'))
    expect(selectLogDir([scratch, second], '/fallback')).to.be(scratch)
    expect(selectLogDir([undefined, path.join(scratch, 'missing'), second], '/fallback')).to.be(second)
  })

  it('falls back when no candidate is writable', () => {
    expect(selectLogDir([undefined, path.join(scratch, 'missing')], '/fallback')).to.be('/fallback')
  })
})

describe('HomeKit-CCU index.js log file', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

  it('picks -L, then /var/log, then the temp directory', () => {
    expect(index).to.contain("selectLogDir([logPath, '/var/log'], fs.realpathSync(os.tmpdir()))")
    expect(index).not.to.match(/&&\s*\(?fs\.accessSync/)
  })
})
