const path = require('path')
const fs = require('fs')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const EveHomeKitValveTypes = require(path.join(__dirname, '..', 'lib', 'services', 'EveValve.js'))

const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

async function startServer (fixture, mappings, values, channels) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', fixture)).toString())
  const server = new Server(log)
  await server.simulate(undefined, {
    config: { channels: channels || Object.keys(data.ccu) },
    devices: data.devices,
    mappings: mappings || data.mappings || {},
    values
  })
  await settle()
  return server
}

function stopServer (server) {
  Object.keys(server._publishedAccessories).forEach(key => server._publishedAccessories[key].shutdown())
}

const firstAccessory = (server) => server._publishedAccessories[Object.keys(server._publishedAccessories)[0]]

// calls the get handler of the accessory itself; hap-nodejs would hide an invalid answer behind a warning
function rawGet (characteristic) {
  return new Promise((resolve, reject) => characteristic.emit('get', (error, value) => error ? reject(error) : resolve(value)))
}

describe('Heating: floor heating actuator (HmIP-FALMOT-C12)', () => {
  let server
  let valve

  before(async () => {
    server = await startServer('HmIP-FALMOT-C12.json', undefined, { 'HmIP.4664078465ABCD:2.LEVEL': null })
    const eveValve = new EveHomeKitValveTypes(server.gatoHomeBridge.hap)
    valve = firstAccessory(server).homeKitAccessory.getService(eveValve.Service.ValveService).getCharacteristic(eveValve.Characteristic.CurrentValveState)
  })

  after(() => stopServer(server))

  it('answers a number before the first value arrived', async () => {
    expect(Number.isFinite(await rawGet(valve))).to.be(true)
  })

  it('reports the valve opening in percent', async () => {
    server._ccu.fireEvent('HmIP.4664078465ABCD:2.LEVEL', 0.25)
    expect(await rawGet(valve)).to.be(25)
    expect(valve.value).to.be(25)
  })

  it('ignores invalid events', () => {
    server._ccu.fireEvent('HmIP.4664078465ABCD:2.LEVEL', 'garbage')
    expect(valve.value).to.be(25)
  })
})

describe('Heating: valve on a switch channel (HmIP-PSM)', () => {
  let server
  let service

  before(async () => {
    server = await startServer('HmIP-PSM.json', {
      '5857734983ABCD:3': { Service: 'HomeMaticValveAccessory' }
    }, { 'HmIP.5857734983ABCD:3.STATE': false }, ['5857734983ABCD:3'])
    service = firstAccessory(server).homeKitAccessory.getService(Service.Valve)
  })

  after(() => stopServer(server))

  it('is a valve', () => {
    expect(service).to.be.ok()
  })

  it('reports a valid remaining duration before the valve ran', async () => {
    const value = await rawGet(service.getCharacteristic(Characteristic.RemainingDuration))
    expect(value).to.be(0)
  })
})

describe('Heating: temperature sensor with three probes (HmIP-STE2-PCB)', () => {
  let server
  let sensors

  before(async () => {
    server = await startServer('HmIP-STE2-PCB.json', undefined, { 'HmIP.5123456789ABCD:0.LOW_BAT': false })
    sensors = firstAccessory(server).homeKitAccessory.services.filter(s => s.UUID === Service.TemperatureSensor.UUID)
  })

  after(() => stopServer(server))

  it('has three temperature sensors', () => {
    expect(sensors.length).to.be(3)
  })

  it('answers numbers before the first value arrived', async () => {
    for (const sensor of sensors) {
      expect(Number.isFinite(await rawGet(sensor.getCharacteristic(Characteristic.CurrentTemperature)))).to.be(true)
    }
  })

  it('reports the probe temperatures', async () => {
    server._ccu.fireEvent('HmIP.5123456789ABCD:2.ACTUAL_TEMPERATURE', 55.5)
    expect(await rawGet(sensors[1].getCharacteristic(Characteristic.CurrentTemperature))).to.be(55.5)
  })
})
