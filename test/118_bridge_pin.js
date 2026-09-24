'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const util = require('util')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const { HAPStorage } = require('@homebridge/hap-nodejs')
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const hapIds = require(path.join(__dirname, '..', 'lib', 'util', 'hapIds.js'))
const { migrateInstances } = require(path.join(__dirname, '..', 'lib', 'util', 'instanceMigration.js'))
const { CONFIG_VERSION, upgradeConfigVersion } = require(path.join(__dirname, '..', 'lib', 'util', 'configMigration.js'))
const { normalizeInstance, normalizeMappingInstances, removeInstanceFrom } = require(path.join(__dirname, '..', 'lib', 'util', 'mappingInstances.js'))
const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))
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
    const instances = { a: { name: 'default', user: '12:34:56:0D:4E:7F', pin: '482-91-736', publishDevices: true } }
    const result = migrateInstances(instances, gen)
    expect(result.instances.a).to.eql({ name: 'default', user: '12:34:56:0D:4E:7F', pincode: '482-91-736', setupID: 'AB12', publishDevices: true })
    expect(result.migrated).to.have.length(1)
    expect(result.migrated[0].id).to.be('a')
    // the input stays untouched
    expect(instances.a.pin).to.be('482-91-736')
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

describe('HomeKit-CCU config version', () => {
  it('is 2', () => {
    expect(CONFIG_VERSION).to.be(2)
  })

  it('turns the session check on for a config without configVersion, even when it was false', () => {
    const config = { useCCCAuthentication: false, useTLS: false, instances: {} }
    const result = upgradeConfigVersion(config)
    expect(result.upgraded).to.be(true)
    expect(result.config).to.eql({ useCCCAuthentication: true, useTLS: false, instances: {}, configVersion: 2 })
    // the input stays untouched
    expect(config.useCCCAuthentication).to.be(false)
    expect(config.configVersion).to.be(undefined)
  })

  it('upgrades configs of an older version', () => {
    expect(upgradeConfigVersion({ configVersion: 1, useCCCAuthentication: false }).config).to.eql({ configVersion: 2, useCCCAuthentication: true })
  })

  it('leaves configs of version 2 and newer alone', () => {
    const config = { configVersion: 2, useCCCAuthentication: false }
    expect(upgradeConfigVersion(config)).to.eql({ config, upgraded: false })
    expect(upgradeConfigVersion({ configVersion: 3 }).upgraded).to.be(false)
  })
})

describe('HomeKit-CCU mapping instances', () => {
  const A = 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab'
  const B = '356a192b-7913-504c-9457-4d18c28d46e6'

  it('replaces a one-element array by its element and keeps strings and multi-instance arrays', () => {
    expect(normalizeInstance([A])).to.be(A)
    expect(normalizeInstance(A)).to.be(A)
    expect(normalizeInstance([A, B])).to.eql([A, B])
    expect(normalizeInstance(undefined)).to.be(undefined)
  })

  it('normalizes all mappings and names the changed ones', () => {
    const mappings = { 'X:1': { name: 'x', instance: [A] }, 'Y:1': { name: 'y', instance: [A, B] }, 'Z:1': { name: 'z', instance: B }, HM: ['HomeMaticSwitchAccessory'] }
    const result = normalizeMappingInstances(mappings)
    expect(result.normalized).to.eql(['X:1'])
    expect(result.mappings['X:1']).to.eql({ name: 'x', instance: A })
    expect(result.mappings['Y:1'].instance).to.eql([A, B])
    expect(result.mappings.HM).to.eql(['HomeMaticSwitchAccessory'])
    // the input stays untouched
    expect(mappings['X:1'].instance).to.eql([A])
  })

  it('returns the same mappings when nothing changes', () => {
    const mappings = { 'X:1': { instance: A } }
    expect(normalizeMappingInstances(mappings)).to.eql({ mappings, normalized: [] })
    expect(normalizeMappingInstances(undefined).normalized).to.eql([])
  })

  it('removes a bridge from a mapping instance and falls back to the default bridge', () => {
    expect(removeInstanceFrom(B, B, A)).to.be(A)
    expect(removeInstanceFrom([B], B, A)).to.be(A)
    expect(removeInstanceFrom([A, B], B, A)).to.be(A)
    const C = 'c'
    expect(removeInstanceFrom([A, B, C], B, A)).to.eql([A, C])
    expect(removeInstanceFrom(C, B, A)).to.be(C)
    expect(removeInstanceFrom([A, C], B, A)).to.eql([A, C])
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
    const t = serverFor({ instances: { a: { name: 'default', user: '12:34:56:0d:4e:7f', pin: '482-91-736', publishDevices: true } }, mappings: {} })
    await t.server.loadSettings()
    expect(t.saves()).to.be(1)
    const inst = stored().instances.a
    expect(inst.pincode).to.be('482-91-736')
    expect(inst.pin).to.be(undefined)
    expect(inst.setupID).to.match(/^[0-9A-Z]{4}$/)
    expect(inst.publishDevices).to.be(true)
    expect(stored().mappings).to.eql({})
    expect(t.server._configuration.instances.a.pincode).to.be('482-91-736')
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
    const t = serverFor({ configVersion: 2, instances: { a: { name: 'default', pincode: '482-91-736', setupID: 'AB12' } } })
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

  describe('configVersion 2', () => {
    const AUTH_WARNING = '[Server] configuration upgraded to version 2: the configuration UI now requires a CCU administrator session (useCCCAuthentication=true). Turn it off in the settings only if you really want an unprotected configuration UI.'
    const DEFAULT = 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab'
    // shape of a config written by the hap-homematic UI in local mode
    const legacyConfig = () => ({
      useCCCAuthentication: false,
      useTLS: false,
      enableMonitoring: true,
      disableHistory: true,
      interfaceWatchdog: 300,
      instances: { [DEFAULT]: { name: 'default', user: '12:34:56:0d:4e:7f', pin: '482-91-736', publishDevices: true } },
      mappings: { '0008DA49A1B2C3:1': { name: 'Contact', Service: 'HomeMaticIPContactAccessory', instance: [DEFAULT], settings: {} } },
      channels: ['0008DA49A1B2C3:1']
    })

    it('turns the session check on for a config without configVersion, logs it and saves once', async () => {
      const t = serverFor(legacyConfig())
      await t.server.loadSettings()
      expect(t.saves()).to.be(1)
      expect(stored().useCCCAuthentication).to.be(true)
      expect(stored().configVersion).to.be(2)
      expect(t.server._configuration.useCCCAuthentication).to.be(true)
      expect(t.lines.warn).to.eql([AUTH_WARNING])
      // the rest of the config survives, the instance migration ran in the same save
      expect(stored().enableMonitoring).to.be(true)
      expect(stored().interfaceWatchdog).to.be(300)
      expect(stored().channels).to.eql(['0008DA49A1B2C3:1'])
      expect(stored().instances[DEFAULT].pincode).to.be('482-91-736')
    })

    it('turns the session check on for a config without the key', async () => {
      const t = serverFor({ instances: { a: { name: 'a', pincode: '111-22-333', setupID: 'ZZ99' } } })
      await t.server.loadSettings()
      expect(t.saves()).to.be(1)
      expect(stored().useCCCAuthentication).to.be(true)
      expect(stored().configVersion).to.be(2)
    })

    it('honors an explicit false in a version 2 config and does not save', async () => {
      const t = serverFor({ configVersion: 2, useCCCAuthentication: false, instances: { a: { name: 'a', pincode: '111-22-333', setupID: 'ZZ99' } } })
      await t.server.loadSettings()
      expect(t.saves()).to.be(0)
      expect(stored().useCCCAuthentication).to.be(false)
      expect(t.server._configuration.useCCCAuthentication).to.be(false)
      expect(t.lines.warn).to.eql([])
    })

    it('replaces a one-element instance array of a mapping by the instance id', async () => {
      const t = serverFor(legacyConfig())
      await t.server.loadSettings()
      expect(stored().mappings['0008DA49A1B2C3:1'].instance).to.be(DEFAULT)
      expect(stored().mappings['0008DA49A1B2C3:1'].Service).to.be('HomeMaticIPContactAccessory')
    })

    it('keeps multi-instance mappings and saves a version 2 config only when a mapping changed', async () => {
      const multi = { configVersion: 2, mappings: { 'A:1': { instance: [DEFAULT, 'other'] } } }
      const t = serverFor(multi)
      await t.server.loadSettings()
      expect(t.saves()).to.be(0)
      const single = serverFor({ configVersion: 2, mappings: { 'A:1': { instance: ['other'] } } })
      await single.server.loadSettings()
      expect(single.saves()).to.be(1)
      expect(stored().mappings['A:1'].instance).to.be('other')
    })

    it('saves the migration before the config server is spawned, so it sees the new value on this start', async () => {
      const t = serverFor(legacyConfig())
      let seenByConfigServer
      t.server.launchUIConfigurationServer = () => {
        const saved = process.env.UIX_CONFIG_PATH
        process.env.UIX_CONFIG_PATH = tmp
        try {
          seenByConfigServer = new ConfigurationService({ debug () {}, info () {}, warn () {}, error () {} }).useAuth
        } finally {
          if (saved === undefined) {
            delete process.env.UIX_CONFIG_PATH
          } else {
            process.env.UIX_CONFIG_PATH = saved
          }
        }
        throw new Error('stop after spawn')
      }
      // keep the process-wide HAP storage path of the other tests untouched
      const setPath = HAPStorage.setCustomStoragePath
      HAPStorage.setCustomStoragePath = () => {}
      let error
      try {
        await t.server.init(true)
      } catch (e) {
        error = e
      } finally {
        HAPStorage.setCustomStoragePath = setPath
      }
      expect(error.message).to.be('stop after spawn')
      expect(seenByConfigServer).to.be(true)
    })
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

  it('creates the default instance of a fresh install with configVersion 2', () => {
    const { log } = recordingLog()
    const server = new Server(log, tmp)
    server.createDefaultInstance()
    expect(stored().configVersion).to.be(2)
  })

  it('keeps the rest of the stored config when it creates the default instance', () => {
    const t = serverFor({ configVersion: 2, useCCCAuthentication: false, enableMonitoring: true })
    t.server.createDefaultInstance()
    expect(stored().configVersion).to.be(2)
    expect(stored().useCCCAuthentication).to.be(false)
    expect(stored().enableMonitoring).to.be(true)
  })

  describe('loadInstance', () => {
    const load = (instanceData) => {
      const { log, lines } = recordingLog()
      const server = new Server(log)
      server.isTestMode = true
      server._configuration = { mappings: {} }
      server.currentPortNum = 9877
      const bridge = server.loadInstance('b6589fc6-ab0d-4c82-8f12-099d1c2d40ab', instanceData, [], [], [], [])
      const pin = bridge._publishInfo.pincode
      // the setup code must never end up in the log, which users attach to support requests
      Object.values(lines).flat().forEach(line => expect(line).not.to.contain(pin))
      return pin
    }

    it('uses pincode', () => {
      expect(load({ name: 'default', pincode: '111-22-333' })).to.be('111-22-333')
    })

    it('falls back to the legacy pin key', () => {
      expect(load({ name: 'default', pin: '482-91-736' })).to.be('482-91-736')
    })

    it('generates a valid PIN when neither is set', () => {
      expect(isValidSetupCode(load({ name: 'default' }))).to.be(true)
    })
  })
})
