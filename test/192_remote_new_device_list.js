const path = require('path')
const expect = require('expect.js')
const { startServer, shutdown } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { isCoveredByRemote, REMOTE_SERVICE } = require(path.join(__dirname, '..', 'lib', 'util', 'remoteMapping.js'))
const { buildDeviceCatalog } = require(path.join(__dirname, '..', 'lib', 'util', 'newDeviceCatalog.js'))

const KRC4 = '000B1BE9A1B2C3'
const keysOf = (catalog, serial) => catalog.find(entry => entry.address === serial).channels

describe('HomeKit-CCU remote: new device catalog', () => {
  let server
  let catalog

  before(async () => {
    ({ server } = await startServer('HmIP-KRC4.json', { mappings: {} }))
    catalog = (mappings) => buildDeviceCatalog(server._compatibleDevices, mappings, { serviceTable: server.serviceConfig })
  })

  after(() => shutdown(server))

  it('lists every key as free while there is no remote mapping', () => {
    const keys = keysOf(catalog({}), KRC4)
    expect(keys.map(channel => channel.address)).to.eql([1, 2, 3, 4].map(key => KRC4 + ':' + key))
    expect(keys.every(channel => (channel.key === true) && (channel.mapping === undefined) && (channel.coveredBy === undefined))).to.be(true)
    expect(keys[0].services[0].serviceClazz).to.be(REMOTE_SERVICE)
  })

  it('marks the other keys as buttons of a mapped remote', () => {
    const keys = keysOf(catalog({ [KRC4 + ':1']: { name: 'Fernbedienung', Service: REMOTE_SERVICE } }), KRC4)
    expect(keys[0].mapping).to.eql({ name: 'Fernbedienung', service: REMOTE_SERVICE })
    expect(keys.slice(1).map(channel => channel.coveredBy)).to.eql([KRC4 + ':1', KRC4 + ':1', KRC4 + ':1'])
  })

  it('also when the remote sits on another key', () => {
    const keys = keysOf(catalog({ [KRC4 + ':3']: { Service: REMOTE_SERVICE } }), KRC4)
    expect(keys.map(channel => channel.coveredBy)).to.eql([KRC4 + ':3', KRC4 + ':3', undefined, KRC4 + ':3'])
    expect(keys[2].mapping.service).to.be(REMOTE_SERVICE)
  })

  it('keeps unmapped keys free next to per-key mappings (HomeMaticKeyAccessory)', () => {
    const mappings = { [KRC4 + ':1']: { Service: 'HomeMaticKeyAccessory' }, [KRC4 + ':2']: { Service: 'HomeMaticKeyAccessory' } }
    const keys = keysOf(catalog(mappings), KRC4)
    expect(keys.map(channel => Boolean(channel.mapping))).to.eql([true, true, false, false])
    expect(keys.every(channel => channel.coveredBy === undefined)).to.be(true)
  })

  it('does not change the device list it was given', () => {
    const before = JSON.stringify(server._compatibleDevices)
    catalog({ [KRC4 + ':1']: { Service: REMOTE_SERVICE } })
    expect(JSON.stringify(server._compatibleDevices)).to.be(before)
  })

  it('tolerates missing mappings and devices', () => {
    expect(buildDeviceCatalog(undefined, undefined)).to.eql([])
    expect(keysOf(catalog(undefined), KRC4)).to.have.length(4)
  })
})

describe('HomeKit-CCU remote: isCoveredByRemote', () => {
  const mappings = {
    [KRC4 + ':1']: { Service: REMOTE_SERVICE },
    KEY_TRANSCEIVER: [{ serviceClazz: 'HomeMaticKeyAccessory' }],
    'HmIP-KRC4:KEY_TRANSCEIVER': { serviceClazz: 'HomeMaticKeyAccessory' }
  }

  it('is true for the other keys of the remote device', () => {
    expect(isCoveredByRemote(mappings, { address: KRC4 + ':2', type: 'KEY_TRANSCEIVER' })).to.be(true)
  })

  it('is false for the channel carrying the remote, other devices and other channel types', () => {
    expect(isCoveredByRemote(mappings, { address: KRC4 + ':1', type: 'KEY_TRANSCEIVER' })).to.be(false)
    expect(isCoveredByRemote(mappings, { address: 'OTHER:2', type: 'KEY_TRANSCEIVER' })).to.be(false)
    expect(isCoveredByRemote(mappings, { address: KRC4 + ':0', type: 'MAINTENANCE' })).to.be(false)
    expect(isCoveredByRemote(undefined, { address: KRC4 + ':2', type: 'KEY_TRANSCEIVER' })).to.be(false)
  })

  it('does not match a device whose serial only starts like the remote one', () => {
    expect(isCoveredByRemote(mappings, { address: KRC4 + 'X:2', type: 'KEY_TRANSCEIVER' })).to.be(false)
  })
})

describe('HomeKit-CCU remote: setup wizard', () => {
  const fs = require('fs')
  const os = require('os')
  const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
  const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))
  const quietLog = { debug () {}, info () {}, warn () {}, error () {} }
  const KEYS = [1, 2, 3, 4].map(key => ({ address: KRC4 + ':' + key, name: 'Key ' + key, type: 'KEY_TRANSCEIVER' }))
  let scratch
  let previousConfigPath
  let serviceConfig

  const writeConfig = (config) => fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify(config))
  const readConfig = () => JSON.parse(fs.readFileSync(path.join(scratch, 'config.json')))
  const runWizard = () => {
    const service = Object.create(ConfigurationService.prototype)
    service.log = quietLog
    service.compatibleDevices = JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', 'HmIP-KRC4.json'))).devices
    service.services = serviceConfig
    service.process = { send () {} }
    service.createapplicancesWizzard('bridge1', KEYS)
    return readConfig()
  }

  before(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-192-'))
    previousConfigPath = process.env.UIX_CONFIG_PATH
    process.env.UIX_CONFIG_PATH = scratch
    serviceConfig = await new Server(quietLog).buildServiceList()
  })

  after(() => {
    if (previousConfigPath === undefined) {
      delete process.env.UIX_CONFIG_PATH
    } else {
      process.env.UIX_CONFIG_PATH = previousConfigPath
    }
    fs.rmSync(scratch, { recursive: true, force: true })
  })

  it('adds no keys of a device whose remote is already mapped', () => {
    writeConfig({ mappings: { [KRC4 + ':1']: { name: 'Remote', Service: REMOTE_SERVICE, settings: {} } }, channels: [KRC4 + ':1'] })
    const config = runWizard()
    expect(Object.keys(config.mappings)).to.eql([KRC4 + ':1'])
    expect(config.mappings[KRC4 + ':1'].Service).to.be(REMOTE_SERVICE)
    expect(config.channels).to.eql([KRC4 + ':1'])
  })

  it('creates at most one remote per device', () => {
    writeConfig({ mappings: {}, channels: [] })
    const config = runWizard()
    const remotes = Object.keys(config.mappings).filter(address => config.mappings[address].Service === REMOTE_SERVICE)
    expect(remotes.length).to.be.below(2)
    if (remotes.length === 1) {
      expect(Object.keys(config.mappings)).to.eql([KRC4 + ':1'])
    } else {
      expect(Object.keys(config.mappings)).to.have.length(4)
    }
  })
})
