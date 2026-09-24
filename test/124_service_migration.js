'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const util = require('util')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const { migrateServiceNames, RENAMED_SERVICES } = require(path.join(__dirname, '..', 'lib', 'util', 'serviceMigration.js'))

const OLD = 'HomeMaticProgrammableSwitchAccessory'
const NEW = 'HomeMaticSwitchAccessory'
const DEFAULT = 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab'

// a logger that records every formatted line instead of printing it
const recordingLog = () => {
  const base = new Logger('HAP Test')
  base.setDebugEnabled(false)
  const lines = { debug: [], info: [], warn: [], error: [] }
  const log = Object.create(base)
  Object.keys(lines).forEach(level => {
    log[level] = (...args) => lines[level].push(util.format(...args))
  })
  return { log, lines }
}

describe('HomeKit-CCU service name migration', () => {
  it('maps the removed programmable switch class to the switch class', () => {
    expect(RENAMED_SERVICES[OLD]).to.be(NEW)
    expect(fs.existsSync(path.join(__dirname, '..', 'lib', 'services', NEW + '.js'))).to.be(true)
    expect(fs.existsSync(path.join(__dirname, '..', 'lib', 'services', OLD + '.js'))).to.be(false)
  })

  it('renames the Service of affected mappings and keeps all other fields', () => {
    const mappings = {
      'A:1': { name: 'Plug', Service: OLD, instance: DEFAULT, settings: { settings: { x: 1 } } },
      'B:1': { name: 'Contact', Service: 'HomeMaticIPContactAccessory', instance: DEFAULT }
    }
    const result = migrateServiceNames(mappings)
    expect(result.changed).to.be(1)
    expect(result.mappings['A:1']).to.eql({ name: 'Plug', Service: NEW, instance: DEFAULT, settings: { settings: { x: 1 } } })
    expect(result.mappings['B:1']).to.be(mappings['B:1'])
    // the input stays untouched
    expect(mappings['A:1'].Service).to.be(OLD)
  })

  it('is idempotent', () => {
    const once = migrateServiceNames({ 'A:1': { Service: OLD } })
    const twice = migrateServiceNames(once.mappings)
    expect(twice.changed).to.be(0)
    expect(twice.mappings).to.be(once.mappings)
    expect(twice.mappings['A:1'].Service).to.be(NEW)
  })

  it('handles missing mappings and non-object entries', () => {
    expect(migrateServiceNames(undefined)).to.eql({ mappings: undefined, changed: 0 })
    const odd = { SWITCH: [OLD], 'A:1': null, 'B:1': 'text' }
    expect(migrateServiceNames(odd)).to.eql({ mappings: odd, changed: 0 })
  })
})

describe('HomeKit-CCU Server service name migration', () => {
  let tmp
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-124-')) })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const serverFor = (config) => {
    const { log, lines } = recordingLog()
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(config))
    const server = new Server(log, tmp)
    server.buildServiceList = async () => ({})
    server.publishServiceTable = () => {}
    let saves = 0
    const save = server.saveSettings.bind(server)
    server.saveSettings = (settings) => { saves++; save(settings) }
    return { server, lines, saves: () => saves }
  }
  const stored = () => JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8'))
  const config = () => ({
    configVersion: 2,
    instances: { [DEFAULT]: { name: 'default', pincode: '482-91-736', setupID: 'AB12' } },
    mappings: { '0001D3C99C1234:3': { name: 'Plug', Service: OLD, instance: DEFAULT, settings: {} } }
  })

  it('loads a mapping naming the removed class as HomeMaticSwitchAccessory, logs and saves it once', async () => {
    const t = serverFor(config())
    await t.server.loadSettings()
    expect(t.server._configuration.mappings['0001D3C99C1234:3'].Service).to.be(NEW)
    expect(stored().mappings['0001D3C99C1234:3']).to.eql({ name: 'Plug', Service: NEW, instance: DEFAULT, settings: {} })
    expect(t.saves()).to.be(1)
    expect(t.lines.info.filter(l => l.includes(OLD) && l.includes(NEW))).to.have.length(1)

    await t.server.loadSettings()
    expect(t.saves()).to.be(1)
  })

  it('resolves the channel to HomeMaticSwitchAccessory', async () => {
    const t = serverFor(config())
    await t.server.loadSettings()
    expect(t.server._findServiceClass({ address: '0001D3C99C1234:3', dtype: 'HM-ES-PMSw1-Pl', type: 'SWITCH' })).to.be(NEW)
  })
})
