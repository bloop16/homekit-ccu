const path = require('path')
const fs = require('fs')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const HomeMaticTestCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticTestCCU.js'))
const { Service, Characteristic, HAPStatus } = require('@homebridge/hap-nodejs')
const EveHomeKitThermoTypes = require(path.join(__dirname, '..', 'lib', 'services', 'EveThermo.js'))

const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const SERIAL = '2123456789ABCD'
const CHANNEL = 'HmIP.' + SERIAL + ':1.'
const MAINTENANCE = 'HmIP.' + SERIAL + ':0.'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

async function startServer (values, settings = {}) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', 'HmIP-eTRV-2.json')).toString())
  const server = new Server(log)
  await server.simulate(undefined, {
    config: { channels: Object.keys(data.ccu) },
    devices: data.devices,
    mappings: { [SERIAL + ':1']: { Service: 'HomeMaticRadiatorThermostatAccessory', settings } },
    values
  })
  await settle()
  return server
}

function firstAccessory (server) {
  return server._publishedAccessories[Object.keys(server._publishedAccessories)[0]]
}

function stopServer (server) {
  Object.keys(server._publishedAccessories).forEach(key => server._publishedAccessories[key].shutdown())
}

function thermostat (server) {
  return firstAccessory(server).homeKitAccessory.getService(Service.Thermostat)
}

function read (service, characteristic) {
  return service.getCharacteristic(characteristic).handleGetRequest()
}

function write (service, characteristic, value) {
  return new Promise((resolve) => service.getCharacteristic(characteristic).setValue(value, () => resolve()))
}

async function fire (server, address, value) {
  server._ccu.fireEvent(address, value)
  await settle()
}

describe('Heating: HmIP radiator thermostat (HmIP-eTRV-2)', () => {
  let server

  before(async () => {
    server = await startServer({
      [MAINTENANCE + 'LOW_BAT']: false,
      [MAINTENANCE + 'OPERATING_VOLTAGE']: 2.8,
      [MAINTENANCE + 'UNREACH']: false,
      [CHANNEL + 'ACTUAL_TEMPERATURE']: 19.2,
      [CHANNEL + 'SET_POINT_TEMPERATURE']: 21,
      [CHANNEL + 'SET_POINT_MODE']: 1,
      [CHANNEL + 'LEVEL']: 0.3,
      [CHANNEL + 'WINDOW_STATE']: 0,
      [CHANNEL + 'BOOST_MODE']: false
    }, { addBoostMode: true })
  })

  after(() => stopServer(server))

  it('offers target temperatures in the 0.5 degree steps the device accepts, from 4.5 (off) to 30.5', () => {
    const props = thermostat(server).getCharacteristic(Characteristic.TargetTemperature).props
    expect(props.minStep).to.be(0.5)
    expect(props.minValue).to.be(4.5)
    expect(props.maxValue).to.be(30.5)
  })

  it('only reports the heating states a radiator thermostat can have', () => {
    const props = thermostat(server).getCharacteristic(Characteristic.CurrentHeatingCoolingState).props
    expect(props.validValues).to.eql([0, 1])
  })

  it('reports HEAT while the valve is open even when the room is already warmer than the target', async () => {
    await fire(server, CHANNEL + 'ACTUAL_TEMPERATURE', 23)
    await fire(server, CHANNEL + 'LEVEL', 0.3)
    expect(await read(thermostat(server), Characteristic.CurrentHeatingCoolingState)).to.be(Characteristic.CurrentHeatingCoolingState.HEAT)
  })

  it('reports OFF while the valve is closed even when the room is colder than the target', async () => {
    await fire(server, CHANNEL + 'ACTUAL_TEMPERATURE', 18)
    await fire(server, CHANNEL + 'LEVEL', 0)
    const service = thermostat(server)
    expect(await read(service, Characteristic.CurrentHeatingCoolingState)).to.be(Characteristic.CurrentHeatingCoolingState.OFF)
    expect(service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).value).to.be(Characteristic.CurrentHeatingCoolingState.OFF)
  })

  it('pushes the heating state when the valve opens', async () => {
    await fire(server, CHANNEL + 'LEVEL', 0.55)
    expect(thermostat(server).getCharacteristic(Characteristic.CurrentHeatingCoolingState).value).to.be(Characteristic.CurrentHeatingCoolingState.HEAT)
  })

  it('shows the valve position in Eve', async () => {
    const eve = new EveHomeKitThermoTypes(server.gatoHomeBridge.hap)
    const service = thermostat(server)
    expect(service.testCharacteristic(eve.Characteristic.ValvePosition)).to.be(true)
    await fire(server, CHANNEL + 'LEVEL', 0.42)
    expect(await read(service, eve.Characteristic.ValvePosition)).to.be(42)
  })

  it('reports OFF while the window is open', async () => {
    await fire(server, CHANNEL + 'LEVEL', 0.2)
    await fire(server, CHANNEL + 'WINDOW_STATE', 1)
    expect(await read(thermostat(server), Characteristic.CurrentHeatingCoolingState)).to.be(Characteristic.CurrentHeatingCoolingState.OFF)
    await fire(server, CHANNEL + 'WINDOW_STATE', 0)
    expect(await read(thermostat(server), Characteristic.CurrentHeatingCoolingState)).to.be(Characteristic.CurrentHeatingCoolingState.HEAT)
  })

  it('reads the control mode the CCU returns as text (manual -> HEAT, auto -> AUTO)', async () => {
    const accessory = firstAccessory(server)
    accessory.controlMode = undefined
    server._ccu.dummyValues[CHANNEL + 'SET_POINT_MODE'] = '0'
    expect(await read(thermostat(server), Characteristic.TargetHeatingCoolingState)).to.be(Characteristic.TargetHeatingCoolingState.AUTO)
    await fire(server, CHANNEL + 'SET_POINT_MODE', 1)
    expect(await read(thermostat(server), Characteristic.TargetHeatingCoolingState)).to.be(Characteristic.TargetHeatingCoolingState.HEAT)
  })

  it('sends target temperatures rounded to 0.5 degrees', async () => {
    const accessory = firstAccessory(server)
    await accessory.setTargetTemperature(21.2)
    expect(server._ccu.dummyValues[CHANNEL + 'SET_POINT_TEMPERATURE']).to.be(21)
    await accessory.setTargetTemperature(21.3)
    expect(server._ccu.dummyValues[CHANNEL + 'SET_POINT_TEMPERATURE']).to.be(21.5)
    await write(thermostat(server), Characteristic.TargetTemperature, 22)
    expect(server._ccu.dummyValues[CHANNEL + 'SET_POINT_TEMPERATURE']).to.be(22)
  })

  it('remembers the last target temperature persistently', () => {
    expect(firstAccessory(server)._persistentValues.lastTargetTemperature).to.be(22)
  })

  it('turning OFF sets manual mode and 4.5 degrees and marks the thermostat off', async () => {
    const service = thermostat(server)
    await write(service, Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.OFF)
    expect(server._ccu.dummyValues[CHANNEL + 'CONTROL_MODE']).to.be(1)
    expect(server._ccu.dummyValues[CHANNEL + 'SET_POINT_TEMPERATURE']).to.be(4.5)
    await fire(server, CHANNEL + 'SET_POINT_TEMPERATURE', 4.5)
    expect(await read(service, Characteristic.TargetHeatingCoolingState)).to.be(Characteristic.TargetHeatingCoolingState.OFF)
    expect(await read(service, Characteristic.CurrentHeatingCoolingState)).to.be(Characteristic.CurrentHeatingCoolingState.OFF)
  })

  it('turning HEAT again restores the remembered temperature from the persistent store (survives a restart)', async () => {
    const accessory = firstAccessory(server)
    // what a restart looks like: nothing in memory, the value only in the persistent store
    accessory.lastSetTemp = undefined
    accessory._persistentValues.lastTargetTemperature = 22.5
    await write(thermostat(server), Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.HEAT)
    expect(server._ccu.dummyValues[CHANNEL + 'CONTROL_MODE']).to.be(1)
    expect(server._ccu.dummyValues[CHANNEL + 'SET_POINT_TEMPERATURE']).to.be(22.5)
  })

  it('switching to AUTO sets the auto control mode', async () => {
    await write(thermostat(server), Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.AUTO)
    expect(server._ccu.dummyValues[CHANNEL + 'CONTROL_MODE']).to.be(0)
  })

  it('names the boost switch "<name> Boost" and keeps its subtype', () => {
    const accessory = firstAccessory(server)
    const boost = accessory.homeKitAccessory.services.find(s => s.UUID === Service.Switch.UUID)
    expect(boost).to.be.ok()
    expect(boost.subtype).to.be('Boost Mode')
    expect(boost.getCharacteristic(Characteristic.Name).value).to.be(accessory._name + ' Boost')
  })

  it('reports the boost state from the device', async () => {
    const accessory = firstAccessory(server)
    const boost = accessory.homeKitAccessory.services.find(s => s.UUID === Service.Switch.UUID)
    await fire(server, CHANNEL + 'BOOST_MODE', true)
    expect(await read(boost, Characteristic.On)).to.be(true)
    await fire(server, CHANNEL + 'BOOST_MODE', false)
    expect(await read(boost, Characteristic.On)).to.be(false)
  })

  it('answers "No Response" while the device is unreachable', async () => {
    const service = thermostat(server)
    await fire(server, MAINTENANCE + 'UNREACH', true)
    let status
    try {
      await read(service, Characteristic.CurrentTemperature)
    } catch (e) {
      status = e
    }
    expect(status).to.be(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    await fire(server, MAINTENANCE + 'UNREACH', false)
    expect(await read(service, Characteristic.CurrentTemperature)).to.be(18)
  })
})

describe('Heating: HmIP radiator thermostat without known values', () => {
  let server

  before(async () => {
    server = await startServer({ [CHANNEL + 'LEVEL']: 0 })
  })

  after(() => stopServer(server))

  it('answers every thermostat read with a valid value before the first event', async () => {
    const service = thermostat(server)
    const current = await read(service, Characteristic.CurrentTemperature)
    const target = await read(service, Characteristic.TargetTemperature)
    expect(Number.isFinite(current)).to.be(true)
    expect(Number.isFinite(target)).to.be(true)
    expect(target >= 4.5 && target <= 30.5).to.be(true)
    expect([0, 1]).to.contain(await read(service, Characteristic.CurrentHeatingCoolingState))
    expect([0, 1, 3]).to.contain(await read(service, Characteristic.TargetHeatingCoolingState))
    expect(await read(service, Characteristic.TemperatureDisplayUnits)).to.be(Characteristic.TemperatureDisplayUnits.CELSIUS)
  })

  it('the get handlers themselves answer numbers (hap-nodejs would hide NaN behind a warning)', async () => {
    const rawGet = (characteristic) => new Promise((resolve, reject) => {
      thermostat(server).getCharacteristic(characteristic).emit('get', (error, value) => error ? reject(error) : resolve(value))
    })
    expect(Number.isFinite(await rawGet(Characteristic.CurrentTemperature))).to.be(true)
    expect(Number.isFinite(await rawGet(Characteristic.TargetTemperature))).to.be(true)
    expect([0, 1]).to.contain(await rawGet(Characteristic.CurrentHeatingCoolingState))
    expect([0, 1, 3]).to.contain(await rawGet(Characteristic.TargetHeatingCoolingState))
  })

  it('does not add the boost switch unless configured', () => {
    const boost = firstAccessory(server).homeKitAccessory.services.find(s => s.UUID === Service.Switch.UUID)
    expect(boost).to.be(undefined)
  })

  it('turning HEAT from off without a remembered temperature uses a comfort temperature of 21', async () => {
    await fire(server, CHANNEL + 'SET_POINT_TEMPERATURE', 4.5)
    await write(thermostat(server), Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.HEAT)
    expect(server._ccu.dummyValues[CHANNEL + 'CONTROL_MODE']).to.be(1)
    expect(server._ccu.dummyValues[CHANNEL + 'SET_POINT_TEMPERATURE']).to.be(21)
  })
})

describe('Heating: HmIP thermostat limits from the MASTER paramset', () => {
  let server
  const original = HomeMaticTestCCU.prototype.sendInterfaceCommand

  before(async () => {
    HomeMaticTestCCU.prototype.sendInterfaceCommand = function (interfaceId, command, parameters) {
      if ((command === 'getParamset') && (parameters[1] === 'MASTER')) {
        return Promise.resolve({ TEMPERATURE_MINIMUM: 5, TEMPERATURE_MAXIMUM: 28 })
      }
      return original.call(this, interfaceId, command, parameters)
    }
    server = await startServer({ [CHANNEL + 'SET_POINT_TEMPERATURE']: 20 })
  })

  after(() => {
    HomeMaticTestCCU.prototype.sendInterfaceCommand = original
    stopServer(server)
  })

  it('uses the maximum of the device and keeps 4.5 as off temperature', () => {
    const props = thermostat(server).getCharacteristic(Characteristic.TargetTemperature).props
    expect(props.maxValue).to.be(28)
    expect(props.minValue).to.be(4.5)
    expect(props.minStep).to.be(0.5)
  })

  it('never sends more than the maximum', async () => {
    await firstAccessory(server).setTargetTemperature(29)
    expect(server._ccu.dummyValues[CHANNEL + 'SET_POINT_TEMPERATURE']).to.be(28)
  })
})
