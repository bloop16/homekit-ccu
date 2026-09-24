const path = require('path')
const fs = require('fs')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const EveHomeKitThermoTypes = require(path.join(__dirname, '..', 'lib', 'services', 'EveThermo.js'))

const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const SERIAL = '3123456789ABCD'
const CHANNEL = 'HmIP.' + SERIAL + ':1.'
const MAINTENANCE = 'HmIP.' + SERIAL + ':0.'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('Heating: HmIP wall thermostat (HmIP-WTH-2)', () => {
  let server

  const accessory = () => server._publishedAccessories[Object.keys(server._publishedAccessories)[0]]
  const thermostat = () => accessory().homeKitAccessory.getService(Service.Thermostat)
  const read = (service, characteristic) => service.getCharacteristic(characteristic).handleGetRequest()
  const fire = async (address, value) => {
    server._ccu.fireEvent(address, value)
    await settle()
  }

  before(async () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', 'HmIP-WTH-2.json')).toString())
    server = new Server(log)
    await server.simulate(undefined, {
      config: { channels: Object.keys(data.ccu) },
      devices: data.devices,
      mappings: data.mappings,
      values: {
        [MAINTENANCE + 'LOW_BAT']: false,
        [MAINTENANCE + 'OPERATING_VOLTAGE']: 2.9,
        // known to the CCU, but no value yet
        [CHANNEL + 'HUMIDITY']: null,
        [CHANNEL + 'SET_POINT_MODE']: 1
      }
    })
    await settle()
  })

  after(() => {
    Object.keys(server._publishedAccessories).forEach(key => server._publishedAccessories[key].shutdown())
  })

  it('is a thermostat', () => {
    expect(accessory().serviceClass).to.be('HomeMaticRadiatorThermostatAccessory')
    expect(thermostat()).to.be.ok()
  })

  it('answers the humidity with a number before the first event', async () => {
    const value = await read(thermostat(), Characteristic.CurrentRelativeHumidity)
    expect(Number.isFinite(value)).to.be(true)
  })

  it('shows the humidity of the wall thermostat', async () => {
    await fire(CHANNEL + 'HUMIDITY', 47)
    expect(thermostat().getCharacteristic(Characteristic.CurrentRelativeHumidity).value).to.be(47)
    expect(await read(thermostat(), Characteristic.CurrentRelativeHumidity)).to.be(47)
  })

  it('has no valve position (a wall thermostat has no valve)', () => {
    const eve = new EveHomeKitThermoTypes(server.gatoHomeBridge.hap)
    expect(thermostat().testCharacteristic(eve.Characteristic.ValvePosition)).to.be(false)
  })

  it('reports HEAT while the room is colder than the target', async () => {
    await fire(CHANNEL + 'SET_POINT_TEMPERATURE', 21)
    await fire(CHANNEL + 'ACTUAL_TEMPERATURE', 19.5)
    expect(await read(thermostat(), Characteristic.CurrentHeatingCoolingState)).to.be(Characteristic.CurrentHeatingCoolingState.HEAT)
    expect(await read(thermostat(), Characteristic.TargetHeatingCoolingState)).to.be(Characteristic.TargetHeatingCoolingState.HEAT)
  })

  it('reports OFF once the room reached the target', async () => {
    await fire(CHANNEL + 'ACTUAL_TEMPERATURE', 21.4)
    expect(thermostat().getCharacteristic(Characteristic.CurrentHeatingCoolingState).value).to.be(Characteristic.CurrentHeatingCoolingState.OFF)
  })

  it('reports AUTO for the weekly program', async () => {
    await fire(CHANNEL + 'SET_POINT_MODE', 0)
    expect(thermostat().getCharacteristic(Characteristic.TargetHeatingCoolingState).value).to.be(Characteristic.TargetHeatingCoolingState.AUTO)
  })

  it('has a battery', async () => {
    const battery = accessory().homeKitAccessory.getService(Service.Battery)
    expect(battery).to.be.ok()
    expect(await read(battery, Characteristic.StatusLowBattery)).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
  })
})
