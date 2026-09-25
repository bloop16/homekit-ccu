'use strict'

/*
 * The default HomeKit service of a channel is chosen on purpose (lib/util/defaultServices.js)
 * instead of by the accidental sort order of equal priorities, and new switch mappings store
 * the native switch type (lib/util/newMappingDefaults.js) while stored mappings keep theirs.
 */

const path = require('path')
const fs = require('fs')
const os = require('os')
const expect = require('expect.js')
const { Service } = require('@homebridge/hap-nodejs')

const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))
const {
  DEFAULT_SERVICES,
  preferredServices,
  orderServiceList,
  orderedServicesForChannel,
  defaultServiceFor
} = require(path.join(__dirname, '..', 'lib', 'util', 'defaultServices.js'))
const {
  nativeSwitchType,
  withNativeSettingDefaults,
  completeNewMappingSettings
} = require(path.join(__dirname, '..', 'lib', 'util', 'newMappingDefaults.js'))
const { startServer, accessoryAt, shutdown, findService } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

const SERVICES_DIR = path.join(__dirname, '..', 'lib', 'services')
const quietLog = { debug () {}, info () {}, warn () {}, error () {} }

// the first class of the preference list that exists (other classes are added in parallel)
const firstExisting = (...names) => names.find(name => fs.existsSync(path.join(SERVICES_DIR, name + '.js')))
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', name)).toString())
const item = (serviceClazz, priority = 0, filterDevice = []) => ({ serviceClazz, priority, filterDevice, settings: {} })
const names = (list) => list.map(entry => entry.serviceClazz)

describe('HomeKit-CCU default services: table and ordering', () => {
  it('stores every preference as a list of class names', () => {
    Object.keys(DEFAULT_SERVICES).forEach(key => {
      expect(DEFAULT_SERVICES[key]).to.be.an('array')
      DEFAULT_SERVICES[key].forEach(name => expect(name).to.match(/^HomeMatic\w+Accessory$/))
    })
  })

  it('looks up DEVICETYPE:CHANNELTYPE before a device type prefix before CHANNELTYPE', () => {
    expect(preferredServices('HEATING_CLIMATECONTROL_TRANSCEIVER', 'HmIP-STH')).to.eql(['HomeMaticThermometerAccessory'])
    expect(preferredServices('HEATING_CLIMATECONTROL_TRANSCEIVER', 'HmIP-WTH-2')).to.eql(['HomeMaticRadiatorThermostatAccessory'])
    expect(preferredServices('HEATING_CLIMATECONTROL_TRANSCEIVER', 'HmIP-eTRV-2')).to.eql(['HomeMaticRadiatorThermostatAccessory'])
    expect(preferredServices('KEY_TRANSCEIVER', 'HmIP-DBB')).to.eql(['HomeMaticKeyAccessory', 'HomeMaticDoorBellAccessory'])
    expect(preferredServices('KEY_TRANSCEIVER', 'HmIP-WRC6')).to.eql(['HomeMaticRemoteAccessory', 'HomeMaticKeyAccessory'])
    expect(preferredServices('NO_SUCH_TYPE', 'HmIP-XYZ')).to.eql([])
  })

  it('orders equal priorities by class name, whatever the input order', () => {
    const a = orderServiceList([item('HomeMaticWindowAccessory'), item('HomeMaticDoorAccessory'), item('HomeMaticBAccessory')], 'NO_SUCH_TYPE')
    const b = orderServiceList([item('HomeMaticBAccessory'), item('HomeMaticWindowAccessory'), item('HomeMaticDoorAccessory')], 'NO_SUCH_TYPE')
    expect(names(a)).to.eql(['HomeMaticBAccessory', 'HomeMaticDoorAccessory', 'HomeMaticWindowAccessory'])
    expect(names(b)).to.eql(names(a))
  })

  it('puts lower priority values first', () => {
    const list = orderServiceList([item('HomeMaticAAccessory', 2), item('HomeMaticZAccessory', 0), item('HomeMaticMAccessory', 1)], 'NO_SUCH_TYPE')
    expect(names(list)).to.eql(['HomeMaticZAccessory', 'HomeMaticMAccessory', 'HomeMaticAAccessory'])
  })

  it('puts the preferred class first and does not change the input list', () => {
    const input = [item('HomeMaticPushTheButtonAccessory'), item('HomeMaticDoorBellAccessory', 1), item('HomeMaticKeyAccessory')]
    const copy = input.slice()
    const list = orderServiceList(input, 'KEY')
    expect(names(list)).to.eql(['HomeMaticKeyAccessory', 'HomeMaticPushTheButtonAccessory', 'HomeMaticDoorBellAccessory'])
    expect(input).to.eql(copy)
  })

  it('ignores preferred classes that do not exist and uses the next preference', () => {
    const withoutRemote = orderServiceList([item('HomeMaticPushTheButtonAccessory'), item('HomeMaticKeyAccessory')], 'KEY_TRANSCEIVER')
    expect(names(withoutRemote)[0]).to.be('HomeMaticKeyAccessory')
    const withRemote = orderServiceList([item('HomeMaticPushTheButtonAccessory'), item('HomeMaticKeyAccessory'), item('HomeMaticRemoteAccessory', 3)], 'KEY_TRANSCEIVER')
    expect(names(withRemote).slice(0, 2)).to.eql(['HomeMaticRemoteAccessory', 'HomeMaticKeyAccessory'])
  })

  it('merges device type and channel type candidates without duplicates and honours filterDevice', () => {
    const table = {
      KEY_TRANSCEIVER: [item('HomeMaticKeyAccessory', 0, ['HmIP-BBL']), item('HomeMaticPushTheButtonAccessory', 0, ['HmIP-BBL']), item('HomeMaticKeyAccessory', 0, ['HmIP-BBL'])],
      'HmIP-BBL:KEY_TRANSCEIVER': [item('HomeMaticSpecialAccessory')]
    }
    expect(names(orderedServicesForChannel(table, 'HmIP-WRC2', 'KEY_TRANSCEIVER'))).to.eql(['HomeMaticKeyAccessory', 'HomeMaticPushTheButtonAccessory'])
    expect(names(orderedServicesForChannel(table, 'HmIP-BBL', 'KEY_TRANSCEIVER'))).to.eql(['HomeMaticSpecialAccessory'])
  })

  it('keeps a device type specific class ahead of the generic ones when the table has no entry', () => {
    const table = {
      ACCELERATION_TRANSCEIVER: [item('HomeMaticIPAccelerationAccessory')],
      'HmIP-SAM:ACCELERATION_TRANSCEIVER': [item('HomeMaticContactSensorAccessory')]
    }
    expect(defaultServiceFor(table, 'HmIP-SAM', 'ACCELERATION_TRANSCEIVER')).to.be('HomeMaticContactSensorAccessory')
    expect(defaultServiceFor(table, 'HmIP-SAM', 'NOTHING')).to.be(undefined)
  })
})

describe('HomeKit-CCU default services: native defaults of real channels', () => {
  let server
  let serviceConfig

  before(async () => {
    server = new Server(quietLog)
    server.log = quietLog
    serviceConfig = await server.buildServiceList()
    server.serviceConfig = serviceConfig
    server._configuration = { mappings: server.buildMappings({}, serviceConfig) }
  })

  const defaultFor = (dtype, type) => server._findServiceClass({ address: 'UNMAPPED0000:1', dtype, type })
  // device and channel type of a fixture channel
  const fromFixture = (file, address) => {
    const data = fixture(file)
    const device = data.devices.find(dev => dev.channels.some(ch => ch.address === address))
    return [device.type, device.channels.find(ch => ch.address === address).type]
  }

  const KEY_DEFAULT = () => firstExisting('HomeMaticRemoteAccessory', 'HomeMaticKeyAccessory')
  const cases = [
    ['HmIP-KRCA remote key', () => fromFixture('HmIP-KRCA.json', '4436784678ABCD:1'), KEY_DEFAULT],
    ['HmIP-SMI55 key', () => fromFixture('HmIP-SMI55.json', '9979012713ABCD:1'), KEY_DEFAULT],
    ['HM-PB-2-WM55 KEY', () => ['HM-PB-2-WM55', 'KEY'], KEY_DEFAULT],
    ['CCU VIRTUAL_KEY', () => ['HM-RCV-50', 'VIRTUAL_KEY'], () => 'HomeMaticKeyAccessory'],
    ['HmIP-DSD-PCB doorbell input', () => fromFixture('HmIP-DSD-PCB.json', '0002DD89A1B2C3:1'), () => 'HomeMaticKeyAccessory'],
    ['HmIP-DBB doorbell key', () => ['HmIP-DBB', 'KEY_TRANSCEIVER'], () => 'HomeMaticKeyAccessory'],
    ['HM-Sen-DB-PCB doorbell key', () => ['HM-Sen-DB-PCB', 'KEY'], () => 'HomeMaticKeyAccessory'],
    ['HmIP-FCI1 contact interface', () => ['HmIP-FCI1', 'MULTI_MODE_INPUT_TRANSMITTER'], () => 'HomeMaticContactSensorAccessory'],
    ['HmIP-SWDM contact', () => fromFixture('HmIP-SWDM.json', '0123456789ABCD:1'), () => 'HomeMaticContactSensorAccessory'],
    ['HmIP-SWDO-I contact', () => fromFixture('HmIP-SWDO-I.json', '5962284199ABCD:1'), () => 'HomeMaticContactSensorAccessory'],
    ['HM-Sec-SC-2 contact', () => ['HM-Sec-SC-2', 'SHUTTER_CONTACT'], () => 'HomeMaticContactSensorAccessory'],
    ['HM-SCI-3-FM contact', () => ['HM-SCI-3-FM', 'CONTACT'], () => 'HomeMaticContactSensorAccessory'],
    ['HM-Sec-TiS tilt sensor', () => ['HM-Sec-TiS', 'TILT_SENSOR'], () => 'HomeMaticContactSensorAccessory'],
    ['HMW-Sen-SC-12-DR wired contact', () => fromFixture('HMW-Sen-SC-12-DR.json', '7348266248ABCD:1'), () => 'HomeMaticContactSensorAccessory'],
    ['HM-Sec-RHS rotary handle', () => ['HM-Sec-RHS', 'ROTARY_HANDLE_SENSOR'], () => 'HomeMaticRotarySensorAccessory'],
    ['HmIP-SRH rotary handle', () => ['HmIP-SRH', 'ROTARY_HANDLE_TRANSCEIVER'], () => 'HomeMaticRotarySensorAccessory'],
    ['HmIP-WTH-2 wall thermostat', () => fromFixture('HmIP-WTH-2.json', '3123456789ABCD:1'), () => 'HomeMaticRadiatorThermostatAccessory'],
    ['HmIP-WTH wall thermostat', () => ['HmIP-WTH', 'HEATING_CLIMATECONTROL_TRANSCEIVER'], () => 'HomeMaticRadiatorThermostatAccessory'],
    ['HmIP-STHD wall thermostat', () => ['HmIP-STHD', 'HEATING_CLIMATECONTROL_TRANSCEIVER'], () => 'HomeMaticRadiatorThermostatAccessory'],
    ['HmIP-BWTH wall thermostat', () => ['HmIP-BWTH', 'HEATING_CLIMATECONTROL_TRANSCEIVER'], () => 'HomeMaticRadiatorThermostatAccessory'],
    ['HmIPW-WTH wall thermostat', () => ['HmIPW-WTH', 'HEATING_CLIMATECONTROL_TRANSCEIVER'], () => 'HomeMaticRadiatorThermostatAccessory'],
    ['ALPHA-IP-RBG wall thermostat', () => ['ALPHA-IP-RBG', 'HEATING_CLIMATECONTROL_TRANSCEIVER'], () => 'HomeMaticRadiatorThermostatAccessory'],
    ['HmIP-eTRV-2 radiator thermostat', () => fromFixture('HmIP-eTRV-2.json', '2123456789ABCD:1'), () => 'HomeMaticRadiatorThermostatAccessory'],
    ['HmIP-STH climate sensor', () => fromFixture('HmIP-STH.json', '4734919797ABCD:1'), () => 'HomeMaticThermometerAccessory'],
    ['HmIP-STHO climate sensor', () => ['HmIP-STHO', 'CLIMATE_TRANSCEIVER'], () => 'HomeMaticThermometerAccessory'],
    ['HmIP-PS-2 plug', () => fromFixture('HmIP-PS-2.json', '0001D709A1B2C3:3'), () => 'HomeMaticSwitchAccessory'],
    ['HmIP-FSM16 actuator', () => fromFixture('HmIP-FSM16.json', '0001D5A9B1C2D3:2'), () => 'HomeMaticSwitchAccessory'],
    ['HM-LC-Sw1-FM actuator', () => ['HM-LC-Sw1-FM', 'SWITCH'], () => 'HomeMaticSwitchAccessory'],
    ['HMW-IO-12-Sw14-DR output', () => fromFixture('HMW-IO-12-Sw14-DR.json', '2752767911ABCD:1'), () => 'HomeMaticSwitchAccessory'],
    ['HmIP-BSM energy meter', () => fromFixture('HmIP-BSM.json', '6094613587ABCD:7'), () => 'HomeMaticIPPowerMeterSwitchAccessory'],
    ['HM-ES-PMSw1-Pl power meter', () => ['HM-ES-PMSw1-Pl', 'POWERMETER'], () => 'HomeMaticPowerMeterSwitchAccessory'],
    ['HmIP-SPI presence detector', () => ['HmIP-SPI', 'PRESENCEDETECTOR_TRANSCEIVER'], () => firstExisting('HomeMaticOccupancyAccessory', 'HomeMaticPresenceAccessory')],
    ['HM-Sen-RD-O rain detector', () => ['HM-Sen-RD-O', 'RAINDETECTOR'], () => firstExisting('HomeMaticRainLeakAccessory', 'HomeMaticRainDetectorAccessory')],
    ['HmIP-SWSD smoke detector', () => ['HmIP-SWSD', 'SMOKE_DETECTOR'], () => 'HomeMaticIPSmokeDetectorAccessory'],
    ['HmIP-SWO-PL weather station', () => fromFixture('HmIP-SWO-PL.json', '00185A49B1C2D3:1'), () => 'HomeMaticWeatherStationAccessory'],
    ['HmIP-SWO-B weather station', () => ['HmIP-SWO-B', 'WEATHER_TRANSMIT'], () => 'HomeMaticWeatherStationAccessory'],
    ['HM-WDS100-C6-O-2 weather station', () => ['HM-WDS100-C6-O-2', 'WEATHER'], () => 'HomeMaticWeatherStationAccessory'],
    ['KS550 weather station', () => ['KS550', 'WEATHER'], () => 'HomeMaticWeatherStationAccessory'],
    ['HmIP-ESI energy sensor', () => ['HmIP-ESI', 'ENERGIE_METER_TRANSMITTER'], () => 'HomeMaticPowerMeterAccessory'],
    ['HmIP-ESI-IND gas sensor', () => ['HmIP-ESI-IND', 'ENERGIE_METER_TRANSMITTER'], () => 'HomeMaticPowerMeterAccessory'],
    ['HM-WDS10-TH-O climate sensor', () => ['HM-WDS10-TH-O', 'WEATHER'], () => 'HomeMaticThermometerAccessory']
  ]

  cases.forEach(([label, channel, expected]) => {
    it(label + ' defaults to its native service', () => {
      const [dtype, type] = channel()
      expect(defaultFor(dtype, type)).to.be(expected())
    })
  })

  it('keeps Thermometer and Humidity selectable for a wall thermostat', () => {
    const list = names(orderedServicesForChannel(serviceConfig, 'HmIP-WTH-2', 'HEATING_CLIMATECONTROL_TRANSCEIVER'))
    expect(list[0]).to.be('HomeMaticRadiatorThermostatAccessory')
    expect(list).to.contain('HomeMaticThermometerAccessory')
    expect(list).to.contain('HomeMaticHumidityAccessory')
  })

  it('keeps PushTheButton selectable for a key', () => {
    expect(names(orderedServicesForChannel(serviceConfig, 'HM-PB-2-WM55', 'KEY'))).to.contain('HomeMaticPushTheButtonAccessory')
  })

  it('starts every channel type list of the service table with its table default', () => {
    Object.keys(DEFAULT_SERVICES).forEach(key => {
      const list = serviceConfig[key]
      const preferred = DEFAULT_SERVICES[key].find(name => (list || []).some(entry => entry.serviceClazz === name))
      if (preferred) {
        expect([key, list[0].serviceClazz]).to.eql([key, preferred])
      }
    })
  })

  it('never uses a stored mapping of a channel for the default but returns it as is', () => {
    server._configuration.mappings['3123456789ABCD:1'] = { Service: 'HomeMaticThermometerAccessory' }
    try {
      expect(server._findServiceClass({ address: '3123456789ABCD:1', dtype: 'HmIP-WTH-2', type: 'HEATING_CLIMATECONTROL_TRANSCEIVER' })).to.be('HomeMaticThermometerAccessory')
    } finally {
      delete server._configuration.mappings['3123456789ABCD:1']
    }
  })

  it('still honours a device type mapping from the configuration', () => {
    server._configuration.mappings['HmIP-XYZ:KEY_TRANSCEIVER'] = { serviceClazz: 'HomeMaticPushTheButtonAccessory' }
    try {
      expect(defaultFor('HmIP-XYZ', 'KEY_TRANSCEIVER')).to.be('HomeMaticPushTheButtonAccessory')
    } finally {
      delete server._configuration.mappings['HmIP-XYZ:KEY_TRANSCEIVER']
    }
  })

  describe('configuration UI service list', () => {
    const makeConfigService = (devices, services) => {
      const service = Object.create(ConfigurationService.prototype)
      service.log = quietLog
      service.compatibleDevices = devices
      service.services = services
      service.loadSettings = () => ({ mappings: {} })
      return service
    }

    it('offers the server default as the first entry', () => {
      const devices = ['HmIP-WTH-2.json', 'HmIP-KRCA.json', 'HmIP-DSD-PCB.json', 'HmIP-SWDO-I.json', 'HmIP-STH.json', 'HmIP-SWO-PL.json']
        .flatMap(file => fixture(file).devices)
      const ui = makeConfigService(devices, serviceConfig)
      devices.forEach(device => device.channels.forEach(channel => {
        const list = ui.serviceSettingsFor(channel.address).service
        if (list.length > 0) {
          expect([channel.address, list[0].serviceClazz]).to.eql([channel.address, defaultFor(device.type, channel.type)])
          expect(new Set(names(list)).size).to.be(list.length)
        }
      }))
    })
  })
})

describe('HomeKit-CCU default services: switch type of new mappings', () => {
  it('uses Lightbulb for the light output of garage door drives', () => {
    expect(nativeSwitchType('HmIP-MOD-HO')).to.be('Lightbulb')
    expect(nativeSwitchType('HmIP-MOD-TM')).to.be('Lightbulb')
  })

  it('uses Outlet for plugs and Switch for every other switch actuator', () => {
    ['HmIP-PS', 'HmIP-PS-2', 'HmIP-PS-UK', 'HmIP-PSM', 'HmIP-PSM-2', 'HMIP-PSM', 'HmIP-PSMCO', 'HM-LC-Sw1-Pl', 'HM-LC-Sw1-Pl-DN-R1',
      'HM-ES-PMSw1-Pl', 'HM-ES-PMSw1-Pl-DN-R1', 'HmIP-USBSM'].forEach(type => expect([type, nativeSwitchType(type)]).to.eql([type, 'Outlet']))
    ;['HmIP-BSM', 'HmIP-FSM16', 'HmIP-FSM', 'HM-LC-Sw1-FM', 'HMW-IO-12-Sw14-DR', 'HmIP-DRSI4', undefined].forEach(type =>
      expect([type, nativeSwitchType(type)]).to.eql([type, 'Switch']))
  })

  it('changes the Type default of the switch class only for a new mapping, without touching the class settings', () => {
    const SwitchClass = require(path.join(SERVICES_DIR, 'HomeMaticSwitchAccessory.js'))
    const serviceItem = item('HomeMaticSwitchAccessory')
    serviceItem.settings = SwitchClass.configurationItems()
    const plug = withNativeSettingDefaults(serviceItem, 'HmIP-PS-2', undefined)
    expect(plug.settings.Type.default).to.be('Outlet')
    expect(serviceItem.settings.Type.default).to.be('Lightbulb')
    expect(withNativeSettingDefaults(serviceItem, 'HmIP-BSM', undefined).settings.Type.default).to.be('Switch')
    // a stored switch mapping without a type is a Lightbulb in HomeKit and stays one
    const legacy = { Service: 'HomeMaticSwitchAccessory', settings: {} }
    expect(withNativeSettingDefaults(serviceItem, 'HmIP-PS-2', legacy).settings.Type.default).to.be('Lightbulb')
    // other classes are returned unchanged
    const other = item('HomeMaticKeyAccessory')
    expect(withNativeSettingDefaults(other, 'HmIP-PS-2', undefined)).to.be(other)
  })

  it('completes the settings of a new mapping only', () => {
    expect(completeNewMappingSettings('HomeMaticSwitchAccessory', 'HmIP-PS-2', {}, undefined)).to.eql({ Type: 'Outlet' })
    expect(completeNewMappingSettings('HomeMaticSwitchAccessory', 'HmIP-BSM', { OnTime: 0 }, undefined)).to.eql({ OnTime: 0, Type: 'Switch' })
    expect(completeNewMappingSettings('HomeMaticSwitchAccessory', 'HmIP-PS-2', { Type: 'Fan' }, undefined)).to.eql({ Type: 'Fan' })
    expect(completeNewMappingSettings('HomeMaticSwitchAccessory', 'HmIP-PS-2', {}, { Service: 'HomeMaticSwitchAccessory', settings: {} })).to.eql({})
    expect(completeNewMappingSettings('HomeMaticKeyAccessory', 'HmIP-PS-2', {}, undefined)).to.eql({})
  })

  describe('ConfigurationService', () => {
    let scratch
    let previousConfigPath
    let serviceConfig
    const PLUG = '0001D709A1B2C3:3'
    const INWALL = '6094613587ABCD:4'

    const makeConfigService = () => {
      const service = Object.create(ConfigurationService.prototype)
      service.log = quietLog
      service.compatibleDevices = [...fixture('HmIP-PS-2.json').devices, ...fixture('HmIP-BSM.json').devices]
      service.services = serviceConfig
      return service
    }
    const writeConfig = (config) => fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify(config))
    const readConfig = () => JSON.parse(fs.readFileSync(path.join(scratch, 'config.json')))
    const switchTemplate = (service, address) => service.serviceSettingsFor(address).service.find(entry => entry.serviceClazz === 'HomeMaticSwitchAccessory').settings

    before(async () => {
      scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-160-'))
      previousConfigPath = process.env.UIX_CONFIG_PATH
      process.env.UIX_CONFIG_PATH = scratch
      const server = new Server(quietLog)
      server.log = quietLog
      serviceConfig = await server.buildServiceList()
    })

    after(() => {
      if (previousConfigPath === undefined) {
        delete process.env.UIX_CONFIG_PATH
      } else {
        process.env.UIX_CONFIG_PATH = previousConfigPath
      }
      fs.rmSync(scratch, { recursive: true, force: true })
    })

    beforeEach(() => writeConfig({ mappings: {}, channels: [] }))

    it('offers Outlet for a new plug and Switch for a new in-wall actuator', () => {
      const service = makeConfigService()
      expect(switchTemplate(service, PLUG).Type.default).to.be('Outlet')
      expect(switchTemplate(service, INWALL).Type.default).to.be('Switch')
    })

    it('keeps Lightbulb as the default when editing a stored switch mapping without a type', () => {
      writeConfig({ mappings: { [PLUG]: { name: 'Plug', Service: 'HomeMaticSwitchAccessory', settings: {} } }, channels: [PLUG] })
      expect(switchTemplate(makeConfigService(), PLUG).Type.default).to.be('Lightbulb')
    })

    it('stores the native type for a new mapping saved without a type', async () => {
      const service = makeConfigService()
      await service.saveDevice({ name: 'Plug', address: PLUG, serviceClass: 'HomeMaticSwitchAccessory', settings: '{}' })
      await service.saveDevice({ name: 'Light', address: INWALL, serviceClass: 'HomeMaticSwitchAccessory', settings: '{}' })
      const config = readConfig()
      expect(config.mappings[PLUG].settings).to.eql({ Type: 'Outlet' })
      expect(config.mappings[INWALL].settings).to.eql({ Type: 'Switch' })
    })

    it('refuses a second special device with the same name instead of replacing the first', async () => {
      writeConfig({ mappings: {}, channels: [] })
      const special = { name: 'Klingel', address: 'new:special', serviceClass: 'HomeMaticSPCCUDutyCycleAccessory', settings: JSON.stringify({ dcAddress: 'a', instanceIDs: { 0: 'b' } }) }
      expect(await makeConfigService().saveDevice(special)).to.eql({ result: 'saved' })
      const first = readConfig()
      expect(await makeConfigService().saveDevice({ ...special, settings: JSON.stringify({ dcAddress: 'b' }) }))
        .to.eql({ result: 'error saving', reason: 'A special device with this name exists already.' })
      expect(readConfig()).to.eql(first)
      expect(first.special).to.have.length(1)
    })

    it('does not add a type to a stored switch mapping without one', async () => {
      writeConfig({ mappings: { [PLUG]: { name: 'Plug', Service: 'HomeMaticSwitchAccessory', settings: {} } }, channels: [PLUG] })
      await makeConfigService().saveDevice({ name: 'Plug renamed', address: PLUG, serviceClass: 'HomeMaticSwitchAccessory', settings: '{}' })
      expect(readConfig().mappings[PLUG].settings).to.eql({})
    })

    it('creates native mappings in the setup assistant and leaves stored ones alone', () => {
      const stored = { name: 'Old', Service: 'HomeMaticSwitchAccessory', instance: 'x', settings: {} }
      writeConfig({ instances: { bridge1: { name: 'default' } }, mappings: { [INWALL]: stored }, channels: [INWALL] })
      const service = makeConfigService()
      service.process = { send () {} }
      const plan = (devices) => JSON.stringify({ bridges: [{ key: 'b', id: 'bridge1' }], devices })
      // a stored mapping is never changed: the whole plan is refused
      expect(service.applyAssistant(plan([{ address: INWALL, name: 'Light', serviceClass: 'HomeMaticSwitchAccessory', bridge: 'b' }])).reason).to.be('channel already in HomeKit')
      expect(service.applyAssistant(plan([{ address: PLUG, name: 'Plug', serviceClass: 'HomeMaticSwitchAccessory', bridge: 'b' }])).result).to.be('saved')
      const config = readConfig()
      expect(config.mappings[PLUG]).to.eql({ name: 'Plug', Service: 'HomeMaticSwitchAccessory', instance: 'bridge1', settings: { Type: 'Outlet' } })
      expect(config.mappings[INWALL]).to.eql(stored)
    })
  })

  describe('HomeKit service of a stored switch mapping', () => {
    const ADDRESS = '0001D709A1B2C3:3'
    const start = async (settings) => {
      const { server } = await startServer('HmIP-PS-2.json', {
        mappings: { [ADDRESS]: { name: 'Plug', Service: 'HomeMaticSwitchAccessory', settings } },
        values: { ['HmIP.' + ADDRESS + '.STATE']: false }
      })
      return server
    }

    it('stays a Lightbulb when no type is stored', async () => {
      const server = await start({})
      try {
        const accessory = accessoryAt(server, ADDRESS)
        expect(findService(accessory, Service.Lightbulb)).to.be.ok()
        expect(findService(accessory, Service.Outlet)).to.be(undefined)
      } finally {
        shutdown(server)
      }
    })

    it('is an Outlet when the new mapping stored Outlet', async () => {
      const server = await start({ Type: 'Outlet' })
      try {
        const accessory = accessoryAt(server, ADDRESS)
        expect(findService(accessory, Service.Outlet)).to.be.ok()
        expect(findService(accessory, Service.Lightbulb)).to.be(undefined)
      } finally {
        shutdown(server)
      }
    })
  })
})
