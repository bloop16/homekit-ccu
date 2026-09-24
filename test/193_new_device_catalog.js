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

  it('combines further free switch outputs of the same device into one mapping', () => {
    const DRS = 'X'
    expect(save([entry(BSM + ':4', { combine: [BSM + ':5', BSM + ':6'] })])).to.eql({ result: 'saved', count: 1 })
    expect(readConfig().mappings[BSM + ':4'].settings).to.eql({ channels: [BSM + ':5', BSM + ':6'], Type: 'Switch' })
    expect(readConfig().channels).to.eql([BSM + ':4'])
    // a combined output is taken: neither a mapping of its own nor part of another combination
    expect(save([entry(BSM + ':5')]).reason).to.be('channel already in HomeKit')
    writeConfig({ mappings: {}, channels: [] })
    const wrong = [
      [{ combine: [] }, 'invalid combination'],
      [{ combine: BSM + ':5' }, 'invalid combination'],
      [{ combine: [BSM + ':4'] }, 'invalid combination'],
      [{ combine: [KRC4 + ':1'] }, 'invalid combination'],
      [{ combine: [DRS + ':1'] }, 'invalid combination'],
      [{ combine: [BSM + ':1'] }, 'invalid combination'],
      [{ combine: [BSM + ':5', BSM + ':5'] }, 'channel already in HomeKit'],
      [{ combine: [BSM + ':5'], serviceClass: 'HomeMaticDoorOpenerAccessory' }, 'invalid combination']
    ]
    wrong.forEach(([more, reason]) => {
      expect(save([entry(BSM + ':4', more)]).reason).to.be(reason)
    })
    expect(save([entry(BSM + ':4', { combine: [BSM + ':5'] }), entry(BSM + ':5')]).reason).to.be('channel already in HomeKit')
    expect(readConfig().mappings).to.eql({})
  })

  it('refuses a payload that is no list of entries', () => {
    expect(save('not json').result).to.be('error saving')
    expect(save([]).result).to.be('error saving')
    expect(save({ address: BSM + ':4' }).result).to.be('error saving')
    expect(save([null]).reason).to.be('unknown channel')
  })
})

describe('HomeKit-CCU new device catalog: filters and pictures', () => {
  const { parseDevDb, deviceIcons } = require(path.join(__dirname, '..', 'lib', 'util', 'deviceIcons.js'))
  const { categoryOf, radioSystemOf, isVirtualKeyDevice } = require(path.join(__dirname, '..', 'lib', 'util', 'newDeviceCatalog.js'))
  const { orderedServicesForChannel } = require(path.join(__dirname, '..', 'lib', 'util', 'defaultServices.js'))
  let serviceTable

  before(async () => {
    serviceTable = await new Server(quietLog).buildServiceList()
  })

  const supported = (devices) => {
    devices.forEach(device => device.channels.forEach(channel => {
      channel.isSuported = (serviceTable[channel.type] !== undefined) || (serviceTable[device.type + ':' + channel.type] !== undefined)
    }))
    return devices
  }
  const rcv = (type, channelType) => ({
    id: 9000,
    address: 'RCV',
    name: type,
    type,
    channels: [1, 2, 3].map(number => ({ id: 9000 + number, address: 'RCV:' + number, name: type + ' RCV:' + number, type: channelType }))
  })

  it('reads the 50 pixel pictures from the DEV_PATHS line of DEVDB.tcl', () => {
    const devdb = [
      '#!/bin/tclsh',
      'array set DEV_DESCRIPTION {HmIP-BSM HmIP-BSM}',
      'array set DEV_PATHS       {HmIP-BSM {{50 /config/img/devices/50/PushButton-2ch-wm_thumb.png} {250 /config/img/devices/250/PushButton-2ch-wm.png}} ' +
        'VIR-LG-RGB-DIM {{50 /config/img/devices/50/coupling/hm-coupling-rgb-dim.png} {250 /config/img/devices/250/coupling/x.png}} BROKEN {{250 /x.png}}}'
    ].join('\n')
    expect(parseDevDb(devdb)).to.eql({
      'HmIP-BSM': '/config/img/devices/50/PushButton-2ch-wm_thumb.png',
      'VIR-LG-RGB-DIM': '/config/img/devices/50/coupling/hm-coupling-rgb-dim.png'
    })
    expect(parseDevDb(undefined)).to.eql({})
  })

  it('has no pictures without a DEVDB.tcl', () => {
    expect(deviceIcons(path.join(__dirname, 'no-such-devdb.tcl'))).to.eql({})
  })

  it('gives every device a category, a radio system, its functions and its picture', () => {
    const devices = supported(['HmIP-BSM.json', 'HmIPW-DRBL4.json', 'HmIP-eTRV-2.json', 'HM-Sec-WDS.json', 'HmIP-PSM.json'].flatMap(fixture))
    const functions = [{ id: 1, name: 'Licht', channels: [1005] }]
    const icons = { 'HmIP-BSM': '/config/img/devices/50/PushButton-2ch-wm_thumb.png' }
    // the category follows the function of the device, not what is already in HomeKit
    const mappings = { '5857734983ABCD:3': { Service: 'HomeMaticSwitchAccessory' } }
    const list = buildDeviceCatalog(devices, mappings, { serviceTable, functions, icons })
    const byType = (type) => list.find(entry => entry.type === type)
    expect(byType('HmIP-BSM')).to.have.property('icon', icons['HmIP-BSM'])
    expect(byType('HmIP-BSM').functions).to.eql(['Licht'])
    expect(byType('HmIPW-DRBL4')).to.not.have.property('icon')
    expect(list.map(entry => [entry.type, entry.category, entry.system])).to.eql([
      ['HM-Sec-WDS', 'sensor', 'BidCos-RF'],
      ['HmIP-BSM', 'switch', 'HmIP'],
      ['HmIP-eTRV-2', 'climate', 'HmIP'],
      ['HMIP-PSM', 'switch', 'HmIP'],
      ['HmIPW-DRBL4', 'cover', 'HmIP-Wired']
    ])
  })

  it('knows the categories and radio systems', () => {
    expect(['HomeMaticDimmerAccessory', 'HomeMaticKeyMaticAccessory', 'HomeMaticRemoteAccessory', 'HomeMaticIPWaterStopAccessory', 'HomeMaticIPPowerMeterSwitchAccessory', 'HomeMaticSPHTTPAccessory'].map(categoryOf))
      .to.eql(['light', 'security', 'button', 'water', 'switch', 'other'])
    expect(['HmIPW-DRAP', 'HmIP-BSM', 'ELV-SH-CTH', 'HMW-IO-12-Sw14-DR', 'HM-LC-Sw1-FM', 'VIR-LG-ONOFF'].map(radioSystemOf))
      .to.eql(['HmIP-Wired', 'HmIP', 'HmIP', 'BidCos-Wired', 'BidCos-RF', 'other'])
  })

  it('marks the virtual keys of the CCU, a programmable switch per key and nothing preselected', () => {
    expect(['HM-RCV-50', 'HmIP-RCV-50', 'HMW-RCV-50'].every(isVirtualKeyDevice)).to.be(true)
    expect(isVirtualKeyDevice('HmIP-WRC6')).to.be(false)
    const list = buildDeviceCatalog(supported([rcv('HmIP-RCV-50', 'KEY_TRANSCEIVER'), rcv('HM-RCV-50', 'KEY')]), {}, { serviceTable, icons: {} })
    list.forEach(device => {
      expect(device.virtualKeys).to.be(true)
      expect(device.category).to.be('button')
      expect(device.channels.map(item => [item.key, item.preselect, item.services[0].serviceClazz]))
        .to.eql([1, 2, 3].map(() => [false, false, 'HomeMaticKeyAccessory']))
    })
    expect(orderedServicesForChannel(serviceTable, 'HmIP-RCV-50', 'KEY_TRANSCEIVER')[0].serviceClazz).to.be('HomeMaticKeyAccessory')
  })
})

describe('HomeKit-CCU setup assistant: applyAssistant', () => {
  let scratch
  let previousConfigPath
  let serviceTable
  let sent

  const writeConfig = (config) => fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify(config))
  const readConfig = () => JSON.parse(fs.readFileSync(path.join(scratch, 'config.json')))
  const apply = (plan) => {
    const service = Object.create(ConfigurationService.prototype)
    service.log = quietLog
    service.compatibleDevices = ['HmIP-BSM.json', 'HmIP-PSM.json'].flatMap(fixture)
    service.services = serviceTable
    service.ensureFirewallPorts = () => {}
    service.process = { send (message) { sent.push(message.topic) } }
    return service.applyAssistant(typeof plan === 'string' ? plan : JSON.stringify(plan))
  }
  const device = (address, bridge) => ({ address, name: 'Gerät ' + address, serviceClass: 'HomeMaticSwitchAccessory', bridge })
  const PSM = '5857734983ABCD'

  before(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-193a-'))
    previousConfigPath = process.env.UIX_CONFIG_PATH
    process.env.UIX_CONFIG_PATH = scratch
    serviceTable = await new Server(quietLog).buildServiceList()
  })

  beforeEach(() => {
    sent = []
    writeConfig({ instances: { def: { name: 'default', pincode: '111-22-333' } }, mappings: {}, channels: [] })
  })

  after(() => {
    if (previousConfigPath === undefined) {
      delete process.env.UIX_CONFIG_PATH
    } else {
      process.env.UIX_CONFIG_PATH = previousConfigPath
    }
    fs.rmSync(scratch, { recursive: true, force: true })
  })

  it('creates new bridges without published devices and maps the devices onto them', () => {
    const result = apply({
      bridges: [{ key: 'room:Küche', name: 'Küche', roomId: 10 }, { key: 'floor:OG', name: 'OG', roomIds: [20, '30', 'x'] }, { key: 'id:def', id: 'def' }],
      devices: [device(BSM + ':4', 'room:Küche'), device(PSM + ':3', 'floor:OG'), device(BSM + ':5', 'id:def')]
    })
    expect(result.result).to.be('saved')
    expect(result.count).to.be(3)
    expect(result.created).to.have.length(2)
    const config = readConfig()
    const kitchen = config.instances[result.bridges['room:Küche']]
    expect(kitchen).to.have.keys('name', 'user', 'pincode', 'setupID', 'roomId')
    expect([kitchen.name, kitchen.roomId, kitchen.publishDevices]).to.eql(['Küche', 10, undefined])
    expect(config.instances[result.bridges['floor:OG']].roomIds).to.eql([20, 30])
    expect(result.bridges['id:def']).to.be('def')
    expect(config.mappings[BSM + ':4'].instance).to.be(result.bridges['room:Küche'])
    expect(config.mappings[BSM + ':5'].instance).to.be('def')
    expect(sent).to.eql(['reloadApplicances'])
  })

  it('refuses the whole plan when a bridge or device is wrong', () => {
    const cases = [
      [{ bridges: [{ key: 'a', id: 'nope' }], devices: [] }, 'unknown instance'],
      [{ bridges: [{ key: 'a', name: 'Default' }], devices: [] }, 'bridge name missing or not unique'],
      [{ bridges: [{ key: 'a', name: 'Bad' }, { key: 'b', name: 'bad' }], devices: [] }, 'bridge name missing or not unique'],
      [{ bridges: [{ key: 'a', name: ' ' }], devices: [] }, 'bridge name missing or not unique'],
      [{ bridges: [{ key: 'a', name: 'Bad' }, { key: 'a', name: 'Flur' }], devices: [] }, 'invalid bridge key'],
      [{ bridges: [{ key: 'a', name: 'Bad' }], devices: [device(BSM + ':4', 'a'), device(BSM + ':4', 'a')] }, 'channel already in HomeKit'],
      [{ bridges: [{ key: 'a', name: 'Bad' }], devices: [device(BSM + ':4', 'missing')] }, 'missing instance'],
      [{ bridges: 'x', devices: [] }, 'invalid payload']
    ]
    cases.forEach(([plan, reason]) => {
      expect(apply(plan).reason).to.be(reason)
      expect(Object.keys(readConfig().instances)).to.eql(['def'])
      expect(readConfig().mappings).to.eql({})
    })
    expect(apply('not json').reason).to.be('invalid payload')
    expect(sent).to.eql([])
  })
})
