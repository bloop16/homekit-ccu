const path = require('path')
const fs = require('fs')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const { Service, Characteristic, HAPStatus } = require('@homebridge/hap-nodejs')
const EveHomeKitThermoTypes = require(path.join(__dirname, '..', 'lib', 'services', 'EveThermo.js'))
const EveHomeKitValveTypes = require(path.join(__dirname, '..', 'lib', 'services', 'EveValve.js'))

const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

async function startServer (fixture, mappings, values) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', fixture)).toString())
  const server = new Server(log)
  await server.simulate(undefined, {
    config: { channels: Object.keys(data.ccu) },
    devices: data.devices,
    mappings: mappings || data.mappings,
    values
  })
  await settle()
  return server
}

function stopServer (server) {
  Object.keys(server._publishedAccessories).forEach(key => server._publishedAccessories[key].shutdown())
}

const firstAccessory = (server) => server._publishedAccessories[Object.keys(server._publishedAccessories)[0]]
const thermostat = (server) => firstAccessory(server).homeKitAccessory.getService(Service.Thermostat)
const read = (service, characteristic) => service.getCharacteristic(characteristic).handleGetRequest()
const write = (service, characteristic, value) => new Promise((resolve) => service.getCharacteristic(characteristic).setValue(value, () => resolve()))
const fire = async (server, address, value) => {
  server._ccu.fireEvent(address, value)
  await settle()
}

describe('Heating: BidCos radiator thermostat (HM-CC-RT-DN)', () => {
  const SERIAL = '4123456789ABCD'
  const CHANNEL = 'BidCos-RF.' + SERIAL + ':4.'
  const MAINTENANCE = 'BidCos-RF.' + SERIAL + ':0.'
  let server

  before(async () => {
    server = await startServer('HM-CC-RT-DN.json', {
      [SERIAL + ':4']: { Service: 'HomeMaticThermostatAccessory', settings: { addBootMode: true } }
    }, {
      [MAINTENANCE + 'LOWBAT']: false,
      [MAINTENANCE + 'UNREACH']: false,
      [CHANNEL + 'ACTUAL_TEMPERATURE']: 19,
      [CHANNEL + 'SET_TEMPERATURE']: 21,
      [CHANNEL + 'CONTROL_MODE']: 0,
      [CHANNEL + 'VALVE_STATE']: 40,
      [CHANNEL + 'BOOST_STATE']: 0
    })
  })

  after(() => stopServer(server))

  it('offers 0.5 degree steps from 4.5 (off) to 30.5', () => {
    const props = thermostat(server).getCharacteristic(Characteristic.TargetTemperature).props
    expect(props.minStep).to.be(0.5)
    expect(props.minValue).to.be(4.5)
    expect(props.maxValue).to.be(30.5)
  })

  it('only reports the heating states HomeKit allows for the current state', () => {
    const props = thermostat(server).getCharacteristic(Characteristic.CurrentHeatingCoolingState).props
    expect(props.validValues).to.eql([0, 1])
  })

  it('reports the valve opening as percent (VALVE_STATE already is percent)', async () => {
    const eveValve = new EveHomeKitValveTypes(server.gatoHomeBridge.hap)
    expect(await read(thermostat(server), eveValve.Characteristic.CurrentValveState)).to.be(40)
    const eveThermo = new EveHomeKitThermoTypes(server.gatoHomeBridge.hap)
    expect(await read(thermostat(server), eveThermo.Characteristic.ValvePosition)).to.be(40)
  })

  it('reports HEAT while the valve is open and OFF while it is closed', async () => {
    const service = thermostat(server)
    await fire(server, CHANNEL + 'ACTUAL_TEMPERATURE', 23)
    await fire(server, CHANNEL + 'VALVE_STATE', 12)
    expect(await read(service, Characteristic.CurrentHeatingCoolingState)).to.be(Characteristic.CurrentHeatingCoolingState.HEAT)
    await fire(server, CHANNEL + 'ACTUAL_TEMPERATURE', 18)
    await fire(server, CHANNEL + 'VALVE_STATE', 0)
    expect(await read(service, Characteristic.CurrentHeatingCoolingState)).to.be(Characteristic.CurrentHeatingCoolingState.OFF)
  })

  it('reads text values from the CCU as numbers', async () => {
    const accessory = firstAccessory(server)
    accessory.targetTemperature = undefined
    server._ccu.dummyValues[CHANNEL + 'SET_TEMPERATURE'] = '21.5'
    expect(await read(thermostat(server), Characteristic.TargetTemperature)).to.be(21.5)
    expect(await read(thermostat(server), Characteristic.TargetHeatingCoolingState)).to.be(Characteristic.TargetHeatingCoolingState.AUTO)
  })

  it('sends target temperatures rounded to 0.5 degrees', async () => {
    await firstAccessory(server).setTargetTemperature(20.3)
    expect(server._ccu.dummyValues[CHANNEL + 'SET_TEMPERATURE']).to.be(20.5)
  })

  it('turns OFF from the weekly program (manual mode at 4.5 degrees)', async () => {
    await fire(server, CHANNEL + 'CONTROL_MODE', 0)
    await write(thermostat(server), Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.OFF)
    await settle()
    expect(server._ccu.dummyValues[CHANNEL + 'MANU_MODE']).to.be(4.5)
    expect(await read(thermostat(server), Characteristic.TargetHeatingCoolingState)).to.be(Characteristic.TargetHeatingCoolingState.OFF)
    expect(firstAccessory(server)._persistentValues.lastTargetTemperature).to.be(20.5)
  })

  it('turns HEAT from manual off with the remembered temperature (never -255)', async () => {
    const accessory = firstAccessory(server)
    accessory.lockModes = false
    await fire(server, CHANNEL + 'CONTROL_MODE', 1)
    await fire(server, CHANNEL + 'SET_TEMPERATURE', 4.5)
    accessory._persistentValues.lastTargetTemperature = 22.5
    await write(thermostat(server), Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.HEAT)
    await settle()
    expect(server._ccu.dummyValues[CHANNEL + 'MANU_MODE']).to.be(22.5)
    expect(await read(thermostat(server), Characteristic.TargetHeatingCoolingState)).to.be(Characteristic.TargetHeatingCoolingState.HEAT)
  })

  it('switches to AUTO', async () => {
    delete server._ccu.dummyValues[CHANNEL + 'AUTO_MODE']
    await write(thermostat(server), Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.AUTO)
    await settle()
    expect(server._ccu.dummyValues[CHANNEL + 'AUTO_MODE']).to.be.ok()
    expect(firstAccessory(server).controlMode).to.be(0)
  })

  it('names the boost switch "<name> Boost" and keeps its subtype', () => {
    const accessory = firstAccessory(server)
    const boost = accessory.homeKitAccessory.services.find(s => s.UUID === Service.Switch.UUID)
    expect(boost.subtype).to.be('Boost Mode')
    expect(boost.getCharacteristic(Characteristic.Name).value).to.be(accessory._name + ' Boost')
  })

  it('ending a boost in manual mode keeps the temperature instead of switching off', async () => {
    const accessory = firstAccessory(server)
    const boost = accessory.homeKitAccessory.services.find(s => s.UUID === Service.Switch.UUID)
    accessory.lockModes = false
    await fire(server, CHANNEL + 'CONTROL_MODE', 1)
    await fire(server, CHANNEL + 'SET_TEMPERATURE', 22)
    await write(boost, Characteristic.On, true)
    expect(server._ccu.dummyValues[CHANNEL + 'BOOST_MODE']).to.be.ok()
    await fire(server, CHANNEL + 'CONTROL_MODE', 3)
    await fire(server, CHANNEL + 'BOOST_STATE', 5)
    expect(await read(boost, Characteristic.On)).to.be(true)
    expect(await read(thermostat(server), Characteristic.CurrentHeatingCoolingState)).to.be(Characteristic.CurrentHeatingCoolingState.HEAT)
    await write(boost, Characteristic.On, false)
    expect(server._ccu.dummyValues[CHANNEL + 'MANU_MODE']).to.be(22)
  })

  it('answers "No Response" while the device is unreachable', async () => {
    await fire(server, MAINTENANCE + 'UNREACH', true)
    let status
    try {
      await read(thermostat(server), Characteristic.CurrentTemperature)
    } catch (e) {
      status = e
    }
    expect(status).to.be(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    await fire(server, MAINTENANCE + 'UNREACH', false)
    expect(Number.isFinite(await read(thermostat(server), Characteristic.CurrentTemperature))).to.be(true)
  })
})

describe('Heating: BidCos thermostat without control mode (HM-CC-TC)', () => {
  let server

  before(async () => {
    server = await startServer('HM-CC-TC.json', undefined, { 'BidCos-RF.5120978032ABCD:1.HUMIDITY': 50 })
  })

  after(() => stopServer(server))

  it('does not claim to be off: HEAT is the only target state', async () => {
    const service = thermostat(server)
    expect(service.getCharacteristic(Characteristic.TargetHeatingCoolingState).props.validValues).to.eql([1])
    expect(await read(service, Characteristic.TargetHeatingCoolingState)).to.be(Characteristic.TargetHeatingCoolingState.HEAT)
  })

  it('answers the temperatures with numbers before the first event', async () => {
    const service = thermostat(server)
    expect(Number.isFinite(await read(service, Characteristic.CurrentTemperature))).to.be(true)
    expect(Number.isFinite(await read(service, Characteristic.TargetTemperature))).to.be(true)
    expect([0, 1]).to.contain(await read(service, Characteristic.CurrentHeatingCoolingState))
  })

  it('shows the room heating while it is colder than the setpoint', async () => {
    await fire(server, 'BidCos-RF.5120978032ABCD:2.SETPOINT', 21)
    await fire(server, 'BidCos-RF.5120978032ABCD:1.TEMPERATURE', 18)
    expect(await read(thermostat(server), Characteristic.CurrentHeatingCoolingState)).to.be(Characteristic.CurrentHeatingCoolingState.HEAT)
  })
})

describe('Heating: programmable BidCos wall thermostat (HM-TC-IT-WM-W-EU)', () => {
  const CHANNEL = 'BidCos-RF.0123456789ABCD:2.'
  let server

  before(async () => {
    server = await startServer('HM-TC-IT-WM-W-EU.json', {
      '0123456789ABCD:2': { Service: 'HomeMaticProgrammableThermostatAccessory' }
    }, {
      [CHANNEL + 'ACTUAL_HUMIDITY']: 40,
      [CHANNEL + 'CONTROL_MODE']: 3,
      [CHANNEL + 'SET_TEMPERATURE']: 21
    })
  })

  after(() => stopServer(server))

  it('switches to AUTO while a boost runs', async () => {
    await fire(server, CHANNEL + 'CONTROL_MODE', 3)
    await write(thermostat(server), Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.AUTO)
    await settle()
    expect(server._ccu.dummyValues[CHANNEL + 'AUTO_MODE']).to.be.ok()
  })

  it('tells Eve that the schedule is active after switching to AUTO', async () => {
    const eve = new EveHomeKitThermoTypes(server.gatoHomeBridge.hap)
    const data = Buffer.from(await read(thermostat(server), eve.Characteristic.ProgramData), 'base64')
    expect(data[2]).to.be(0x13)
    expect(data[3]).to.be(1)
  })

  it('turns HEAT from off with a real temperature', async () => {
    const accessory = firstAccessory(server)
    accessory.lockModes = false
    await fire(server, CHANNEL + 'CONTROL_MODE', 1)
    await fire(server, CHANNEL + 'SET_TEMPERATURE', 4.5)
    await write(thermostat(server), Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.HEAT)
    await settle()
    const manual = server._ccu.dummyValues[CHANNEL + 'MANU_MODE']
    expect(manual > 4.5 && manual <= 30.5).to.be(true)
  })
})
