const path = require('path')
const expect = require('expect.js')
const { startServer, shutdown } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { buildNewDeviceList, isCoveredByRemote, REMOTE_SERVICE } = require(path.join(__dirname, '..', 'lib', 'util', 'remoteMapping.js'))

const KRC4 = '000B1BE9A1B2C3'
const addresses = (list, serial) => list.find(entry => entry.device === serial).channels.map(channel => channel.address)

describe('HomeKit-CCU remote: new device list', () => {
  let server
  let compatibleDevices

  before(async () => {
    ({ server } = await startServer('HmIP-KRC4.json', { mappings: {} }))
    compatibleDevices = server._compatibleDevices
  })

  after(() => shutdown(server))

  it('lists every key while there is no remote mapping', () => {
    const list = buildNewDeviceList(compatibleDevices, {})
    expect(addresses(list, KRC4)).to.eql([1, 2, 3, 4].map(key => KRC4 + ':' + key))
    expect(list[0]).to.only.have.keys('device', 'name', 'type', 'channels')
    expect(list[0].channels[0]).to.only.have.keys('id', 'address', 'name', 'type')
  })

  it('lists the remote once: the other keys of the device are hidden', () => {
    const mappings = { [KRC4 + ':1']: { name: 'Fernbedienung', Service: REMOTE_SERVICE } }
    expect(addresses(buildNewDeviceList(compatibleDevices, mappings), KRC4)).to.eql([KRC4 + ':1'])
  })

  it('hides the keys also when the remote sits on another key', () => {
    const mappings = { [KRC4 + ':3']: { Service: REMOTE_SERVICE } }
    expect(addresses(buildNewDeviceList(compatibleDevices, mappings), KRC4)).to.eql([KRC4 + ':3'])
  })

  it('keeps all keys for per-key mappings (HomeMaticKeyAccessory)', () => {
    const mappings = { [KRC4 + ':1']: { Service: 'HomeMaticKeyAccessory' }, [KRC4 + ':2']: { Service: 'HomeMaticKeyAccessory' } }
    expect(addresses(buildNewDeviceList(compatibleDevices, mappings), KRC4)).to.have.length(4)
  })

  it('does not change the device list it was given', () => {
    const before = JSON.stringify(compatibleDevices)
    buildNewDeviceList(compatibleDevices, { [KRC4 + ':1']: { Service: REMOTE_SERVICE } })
    expect(JSON.stringify(compatibleDevices)).to.be(before)
  })

  it('keeps the channels of a device that are no keys', () => {
    const device = {
      address: 'ABC',
      name: 'Wandtaster 230V',
      type: 'HmIP-WRC6-230',
      channels: [
        { id: 1, address: 'ABC:1', name: 'k1', type: 'KEY_TRANSCEIVER', isSuported: true },
        { id: 2, address: 'ABC:2', name: 'k2', type: 'KEY_TRANSCEIVER', isSuported: true },
        { id: 3, address: 'ABC:8', name: 's', type: 'SWITCH_TRANSMITTER', isSuported: true },
        { id: 4, address: 'ABC:9', name: 'v', type: 'SWITCH_VIRTUAL_RECEIVER', isSuported: false }
      ]
    }
    const list = buildNewDeviceList([device], { 'ABC:1': { Service: REMOTE_SERVICE } })
    expect(addresses(list, 'ABC')).to.eql(['ABC:1', 'ABC:8'])
  })

  it('tolerates missing mappings and devices', () => {
    expect(buildNewDeviceList(undefined, undefined)).to.eql([])
    expect(addresses(buildNewDeviceList(compatibleDevices, undefined), KRC4)).to.have.length(4)
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
