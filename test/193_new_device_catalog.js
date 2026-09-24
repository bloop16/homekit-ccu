const path = require('path')
const fs = require('fs')
const os = require('os')
const expect = require('expect.js')
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))
const { buildDeviceCatalog, isSecondaryChannel } = require(path.join(__dirname, '..', 'lib', 'util', 'newDeviceCatalog.js'))

const quietLog = { debug () {}, info () {}, warn () {}, error () {} }
const fixture = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', file))).devices
const BSM = '6094613587ABCD'
const DRBL4 = '3445238272ABCD'
const KRC4 = '000B1BE9A1B2C3'

describe('HomeKit-CCU new device catalog', () => {
  let serviceTable
  let devices
  let catalog

  before(async () => {
    serviceTable = await new Server(quietLog).buildServiceList()
    devices = ['HmIP-BSM.json', 'HmIPW-DRBL4.json', 'HmIP-KRC4.json'].flatMap(fixture)
    // the server marks the channels a service class supports
    devices.forEach(device => device.channels.forEach(channel => {
      channel.isSuported = (serviceTable[channel.type] !== undefined) || (serviceTable[device.type + ':' + channel.type] !== undefined)
    }))
    const rooms = [{ id: 1, name: 'Küche', channels: [1005] }, { id: 2, name: 'Flur', channels: [2002, 2003] }]
    catalog = (mappings = {}) => buildDeviceCatalog(devices, mappings, { serviceTable, rooms })
  })

  const device = (list, serial) => list.find(entry => entry.address === serial)
  const channel = (list, address) => device(list, address.split(':')[0]).channels.find(entry => entry.address === address)

  it('lists devices sorted by name with their rooms, without channel 0', () => {
    const list = catalog()
    expect(list.map(entry => entry.name)).to.eql(['Fernbedienung', 'HmIP-BSM', 'HmIPW-DRBL4'])
    expect(device(list, KRC4).rooms).to.eql(['Flur'])
    expect(channel(list, KRC4 + ':1').rooms).to.eql(['Flur'])
    expect(channel(list, KRC4 + ':4').rooms).to.eql([])
    expect(list.every(entry => entry.channels.every(item => item.number > 0))).to.be(true)
  })

  it('folds the second and third virtual channel of an output', () => {
    const list = catalog()
    const secondary = (serial) => device(list, serial).channels.filter(item => item.secondary).map(item => item.number)
    expect(secondary(BSM)).to.eql([5, 6])
    expect(secondary(DRBL4)).to.eql([3, 4, 7, 8, 11, 12, 15, 16])
  })

  it('is no secondary channel without a virtual channel of the same type in front', () => {
    const channels = [{ address: 'X:3', type: 'SWITCH_TRANSMITTER' }, { address: 'X:4', type: 'SWITCH_VIRTUAL_RECEIVER' }, { address: 'X:5', type: 'SWITCH_VIRTUAL_RECEIVER' }]
    expect(channels.map(item => isSecondaryChannel(channels, item))).to.eql([false, false, true])
    expect(isSecondaryChannel(channels, undefined)).to.be(false)
  })

  it('preselects outputs, not the folded channels, the keys of an actuator or the meter channel', () => {
    const list = catalog()
    const preselected = (serial) => device(list, serial).channels.filter(item => item.preselect).map(item => item.number)
    expect(preselected(BSM)).to.eql([4])
    expect(preselected(DRBL4)).to.eql([2, 6, 10, 14])
    // a remote consists of keys only, its keys are its function
    expect(preselected(KRC4)).to.eql([1, 2, 3, 4])
  })

  it('does not preselect channels already in HomeKit', () => {
    const list = catalog({ [BSM + ':4']: { name: 'Licht', Service: 'HomeMaticSwitchAccessory' } })
    expect(channel(list, BSM + ':4')).to.have.property('mapping')
    expect(channel(list, BSM + ':4').preselect).to.be(false)
  })

  it('offers the native service first, with its choice settings and native default', () => {
    const services = channel(catalog(), BSM + ':4').services
    expect(services[0].serviceClazz).to.be('HomeMaticSwitchAccessory')
    expect(services[0].description).to.be.a('string')
    const type = services[0].options.find(option => option.key === 'Type')
    expect(type.values).to.contain('Outlet')
    expect(type.default).to.be('Switch')
  })
})

describe('HomeKit-CCU new device catalog: saveNewDevices', () => {
  let scratch
  let previousConfigPath
  let serviceTable

  const writeConfig = (config) => fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify(config))
  const readConfig = () => JSON.parse(fs.readFileSync(path.join(scratch, 'config.json')))
  const save = (entries) => {
    const service = Object.create(ConfigurationService.prototype)
    service.log = quietLog
    service.compatibleDevices = ['HmIP-BSM.json', 'HmIP-KRC4.json'].flatMap(fixture)
    service.services = serviceTable
    return service.saveNewDevices(typeof entries === 'string' ? entries : JSON.stringify(entries))
  }
  const entry = (address, more = {}) => ({ address, name: 'Name ' + address, serviceClass: 'HomeMaticSwitchAccessory', instanceIDs: ['bridge1'], ...more })

  before(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-193-'))
    previousConfigPath = process.env.UIX_CONFIG_PATH
    process.env.UIX_CONFIG_PATH = scratch
    serviceTable = await new Server(quietLog).buildServiceList()
  })

  beforeEach(() => writeConfig({ mappings: {}, channels: [] }))

  after(() => {
    if (previousConfigPath === undefined) {
      delete process.env.UIX_CONFIG_PATH
    } else {
      process.env.UIX_CONFIG_PATH = previousConfigPath
    }
    fs.rmSync(scratch, { recursive: true, force: true })
  })

  it('saves all entries with native settings and the chosen choice settings', () => {
    expect(save([
      entry(BSM + ':4'),
      entry(BSM + ':5', { settings: { Type: 'Lightbulb' } }),
      entry(KRC4 + ':1', { serviceClass: 'HomeMaticRemoteAccessory', instanceIDs: ['bridge1', 'bridge2'] })
    ])).to.eql({ result: 'saved', count: 3 })
    const config = readConfig()
    expect(config.mappings[BSM + ':4']).to.eql({ name: 'Name ' + BSM + ':4', Service: 'HomeMaticSwitchAccessory', instance: 'bridge1', settings: { Type: 'Switch' } })
    expect(config.mappings[BSM + ':5'].settings).to.eql({ Type: 'Lightbulb' })
    expect(config.mappings[KRC4 + ':1'].instance).to.eql(['bridge1', 'bridge2'])
    expect(config.channels).to.eql([BSM + ':4', BSM + ':5', KRC4 + ':1'])
  })

  it('refuses the whole list when one entry is wrong', () => {
    const cases = [
      [entry('UNKNOWN:1'), 'unknown channel'],
      [entry(BSM + ':4', { serviceClass: 'HomeMaticRemoteAccessory' }), 'service does not fit the channel'],
      [entry(BSM + ':4', { serviceClass: '../../index' }), 'service does not fit the channel'],
      [entry(BSM + ':4', { name: '  ' }), 'missing name'],
      [entry(BSM + ':4', { instanceIDs: [] }), 'missing instance'],
      [entry(BSM + ':4', { settings: { Type: 'Toaster' } }), 'invalid setting Type'],
      [entry(BSM + ':4', { settings: { roChannel: 3 } }), 'invalid setting roChannel'],
      [entry(BSM + ':4', { settings: 'Outlet' }), 'invalid setting settings']
    ]
    cases.forEach(([wrong, reason]) => {
      expect(save([entry(BSM + ':5'), wrong])).to.eql({ result: 'error saving', reason, address: wrong.address })
      expect(readConfig().mappings).to.eql({})
    })
  })

  it('refuses channels already in HomeKit, also as a button of a remote or twice in one list', () => {
    writeConfig({ mappings: { [BSM + ':4']: { Service: 'HomeMaticSwitchAccessory' }, [KRC4 + ':1']: { Service: 'HomeMaticRemoteAccessory' } }, channels: [] })
    expect(save([entry(BSM + ':4')]).reason).to.be('channel already in HomeKit')
    expect(save([entry(KRC4 + ':2', { serviceClass: 'HomeMaticKeyAccessory' })]).reason).to.be('channel already in HomeKit')
    expect(save([entry(BSM + ':5'), entry(BSM + ':5')]).reason).to.be('channel already in HomeKit')
  })

  it('refuses a payload that is no list of entries', () => {
    expect(save('not json').result).to.be('error saving')
    expect(save([]).result).to.be('error saving')
    expect(save({ address: BSM + ':4' }).result).to.be('error saving')
    expect(save([null]).reason).to.be('unknown channel')
  })
})
