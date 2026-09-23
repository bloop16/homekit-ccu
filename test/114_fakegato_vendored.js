const path = require('path')
const fs = require('fs')
const os = require('os')
const expect = require('expect.js')
const { Accessory, Characteristic, Service, Formats, Perms, Units, uuid } = require('@homebridge/hap-nodejs')

const FAKEGATO = path.join(__dirname, '..', 'lib', 'vendor', 'fakegato-history', 'fakegato-history.js')
const WRITE_TIMEOUT_MS = 2000

// resolves once the history file exists and contains the given number of entries
function waitForHistory (file, entries) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (saved.lastEntry >= entries) {
          resolve(saved)
          return
        }
      } catch (e) {
        // not written (completely) yet
      }
      if (Date.now() - started > WRITE_TIMEOUT_MS) {
        reject(new Error('history file ' + file + ' was not written'))
        return
      }
      setTimeout(poll, 20)
    }
    poll()
  })
}

describe('HomeKit-CCU vendored fakegato-history', () => {
  let tmpDir
  let FakeGatoHistoryService

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homekit-ccu-fakegato-'))
    // same shape as Server.gatoHomeBridge
    const gatoHomeBridge = {
      hap: { Characteristic, Service, Formats, Perms, Units },
      user: { storagePath: () => tmpDir }
    }
    FakeGatoHistoryService = require(FAKEGATO)(gatoHomeBridge)
  })

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does not load googleapis', () => {
    const loaded = Object.keys(require.cache).filter(p => p.includes(path.sep + 'googleapis'))
    expect(loaded).to.eql([])
  })

  it('records history on the filesystem', async () => {
    const accessory = new Accessory('Test Weather', uuid.generate('homekit-ccu:test:fakegato'))
    const filename = 'test_weather_persist.json'
    const history = new FakeGatoHistoryService('weather', accessory, {
      storage: 'fs',
      filename,
      path: tmpDir,
      disableTimer: true,
      length: 1000
    })
    expect(history.UUID).to.be('E863F007-079E-48FF-8F27-9C2605A29F52')

    history.addEntry({ time: Math.round(Date.now() / 1000), temp: 21.5, humidity: 40, pressure: 1013 })

    const saved = await waitForHistory(path.join(tmpDir, filename), 1)
    const entry = saved.history.find(e => e.temp === 21.5)
    expect(entry).to.be.ok()
    expect(entry.humidity).to.be(40)
    expect(entry.pressure).to.be(1013)
  })

  it('rejects Google-Drive storage with a clear error', () => {
    const accessory = new Accessory('Test Drive', uuid.generate('homekit-ccu:test:fakegato-drive'))
    expect(() => new FakeGatoHistoryService('weather', accessory, { storage: 'googleDrive', disableTimer: true }))
      .to.throwException(/not supported by homekit-ccu/)
  })
})
