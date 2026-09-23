'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const util = require('util')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const hapIds = require(path.join(__dirname, '..', 'lib', 'util', 'hapIds.js'))
const { migrateInstances } = require(path.join(__dirname, '..', 'lib', 'util', 'instanceMigration.js'))
const { isValidSetupCode } = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'hapIdentity.js'))

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

const sequence = (values) => {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('HomeKit-CCU hapIds', () => {
  it('generates setup codes of the form 123-45-678 that HomeKit accepts', () => {
    for (let i = 0; i < 500; i++) {
      expect(isValidSetupCode(hapIds.generatePin())).to.be(true)
    }
  })

  it('skips trivial setup codes', () => {
    const pin = hapIds.generatePin(sequence([12345678, 11111111, 87654321, 31415926]))
    expect(pin).to.be('314-15-926')
  })

  it('keeps leading zeros', () => {
    expect(hapIds.generatePin(sequence([31415]))).to.be('000-31-415')
  })

  it('generates 4 character setup IDs from 0-9A-Z', () => {
    const seen = new Set()
    for (let i = 0; i < 500; i++) {
      const id = hapIds.generateSetupID()
      expect(id).to.match(/^[0-9A-Z]{4}$/)
      id.split('').forEach(c => seen.add(c))
    }
    // the inherited generator only ever produced 0-9A-P
    expect([...seen].some(c => c > 'P')).to.be(true)
  })
})

describe('HomeKit-CCU instance migration', () => {
  const gen = { generatePin: () => '314-15-926', generateSetupID: () => 'AB12' }

  it('moves pin to pincode and adds a missing setupID', () => {
    const instances = { a: { name: 'default', user: '12:34:56:3C:AE:A1', pin: '970-71-213', publishDevices: true } }
    const result = migrateInstances(instances, gen)
    expect(result.instances.a).to.eql({ name: 'default', user: '12:34:56:3C:AE:A1', pincode: '970-71-213', setupID: 'AB12', publishDevices: true })
    expect(result.migrated).to.have.length(1)
    expect(result.migrated[0].id).to.be('a')
    // the input stays untouched
    expect(instances.a.pin).to.be('970-71-213')
    expect(instances.a.pincode).to.be(undefined)
  })

  it('generates a pincode for instances without one', () => {
    const result = migrateInstances({ b: { name: 'b', user: 'x' } }, gen)
    expect(result.instances.b.pincode).to.be('314-15-926')
    expect(result.instances.b.setupID).to.be('AB12')
  })

  it('prefers an existing pincode over a stray pin', () => {
    const result = migrateInstances({ c: { name: 'c', pincode: '111-22-333', pin: '444-55-666', setupID: 'ZZ99' } }, gen)
    expect(result.instances.c).to.eql({ name: 'c', pincode: '111-22-333', setupID: 'ZZ99' })
    expect(result.migrated).to.have.length(1)
  })

  it('leaves complete instances alone', () => {
    const instances = { d: { name: 'd', pincode: '111-22-333', setupID: 'ZZ99' } }
    const result = migrateInstances(instances, gen)
    expect(result.migrated).to.have.length(0)
    expect(result.instances).to.eql(instances)
  })

  it('copes with missing instances', () => {
    expect(migrateInstances(undefined, gen).migrated).to.have.length(0)
  })
})

describe('HomeKit-CCU Server bridge PIN', () => {
  let tmp
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-118-')) })
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

  it('migrates pin to pincode on load and saves once', async () => {
    const t = serverFor({ instances: { a: { name: 'default', user: '12:34:56:3c:ae:a1', pin: '970-71-213', publishDevices: true } }, mappings: {} })
    await t.server.loadSettings()
    expect(t.saves()).to.be(1)
    const inst = stored().instances.a
    expect(inst.pincode).to.be('970-71-213')
    expect(inst.pin).to.be(undefined)
    expect(inst.setupID).to.match(/^[0-9A-Z]{4}$/)
    expect(inst.publishDevices).to.be(true)
    expect(stored().mappings).to.eql({})
    expect(t.server._configuration.instances.a.pincode).to.be('970-71-213')
    expect(t.lines.info.filter(l => /migrated bridge settings/.test(l))).to.have.length(1)
  })

  it('adds a missing pincode and setupID and saves once', async () => {
    const t = serverFor({ instances: { a: { name: 'a' }, b: { name: 'b', pincode: '111-22-333', setupID: 'ZZ99' } } })
    await t.server.loadSettings()
    expect(t.saves()).to.be(1)
    expect(isValidSetupCode(stored().instances.a.pincode)).to.be(true)
    expect(stored().instances.a.setupID).to.match(/^[0-9A-Z]{4}$/)
    expect(stored().instances.b).to.eql({ name: 'b', pincode: '111-22-333', setupID: 'ZZ99' })
  })

  it('does not save an already migrated config again', async () => {
    const t = serverFor({ instances: { a: { name: 'default', pincode: '970-71-213', setupID: 'AB12' } } })
    await t.server.loadSettings()
    await t.server.loadSettings()
    expect(t.saves()).to.be(0)
  })

  it('keeps the migrated PIN across restarts', async () => {
    const first = serverFor({ instances: { a: { name: 'default' } } })
    await first.server.loadSettings()
    const pin = stored().instances.a.pincode
    const second = new Server(recordingLog().log, tmp)
    second.buildServiceList = async () => ({})
    await second.loadSettings()
    expect(second._configuration.instances.a.pincode).to.be(pin)
  })

  it('creates the default instance with pincode and setupID', () => {
    const t = serverFor({})
    const instances = t.server.createDefaultInstance()
    const inst = Object.values(instances)[0]
    expect(inst.pin).to.be(undefined)
    expect(isValidSetupCode(inst.pincode)).to.be(true)
    expect(inst.setupID).to.match(/^[0-9A-Z]{4}$/)
    expect(Object.values(stored().instances)[0]).to.eql(inst)
  })

  describe('loadInstance', () => {
    const load = (instanceData) => {
      const { log, lines } = recordingLog()
      const server = new Server(log)
      server.isTestMode = true
      server._configuration = { mappings: {} }
      server.currentPortNum = 9877
      server.loadInstance('b6589fc6-ab0d-4c82-8f12-099d1c2d40ab', instanceData, [], [], [], [])
      const line = lines.debug.find(l => /Your Bridge ID .* PinCode is/.test(l))
      return line.split('PinCode is ')[1]
    }

    it('uses pincode', () => {
      expect(load({ name: 'default', pincode: '111-22-333' })).to.be('111-22-333')
    })

    it('falls back to the legacy pin key', () => {
      expect(load({ name: 'default', pin: '970-71-213' })).to.be('970-71-213')
    })

    it('generates a valid PIN when neither is set', () => {
      expect(isValidSetupCode(load({ name: 'default' }))).to.be(true)
    })
  })
})
