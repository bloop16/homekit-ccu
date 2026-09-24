'use strict'

/*
 * Wall thermostats with HUMIDITY: Apple Home shows the humidity of a room only from a humidity
 * sensor. Without a stored setting the thermostat gets one next to its own humidity reading;
 * a stored choice is kept.
 */

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, findService, read, settle } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

const WTH = {
  type: 'HmIP-WTH-2',
  address: '0001A0A9B18501',
  channels: ['MAINTENANCE', 'HEATING_CLIMATECONTROL_TRANSCEIVER'],
  channel: 1,
  service: 'HomeMaticRadiatorThermostatAccessory',
  values: { '1.HUMIDITY': 45, '1.ACTUAL_TEMPERATURE': 21, '0.LOW_BAT': false }
}

const TC = {
  intf: 'BidCos-RF',
  type: 'HM-TC-IT-WM-W-EU',
  address: 'NEQ0185002',
  channels: ['MAINTENANCE', 'WEATHER_TRANSMIT', 'THERMALCONTROL_TRANSMIT'],
  channel: 2,
  service: 'HomeMaticProgrammableThermostatAccessory',
  values: { '1.HUMIDITY': 40, '2.ACTUAL_HUMIDITY': 40, '0.LOWBAT': false }
}

async function start (spec, settings) {
  const sim = await simulateDevice({ ...spec, settings })
  await settle(20)
  return sim
}

describe('Refine: HmIP-WTH-2 humidity sensor (no stored setting)', () => {
  let sim

  before(async () => { sim = await start(WTH, {}) })
  after(() => sim.shutdown())

  it('adds a humidity sensor and keeps the humidity of the thermostat', async () => {
    const sensor = findService(sim.accessory, Service.HumiditySensor)
    expect(sensor).to.be.ok()
    expect(sensor.isPrimaryService).to.not.be(true)
    expect(await read(sensor.getCharacteristic(Characteristic.CurrentRelativeHumidity))).to.be(45)
    const thermostat = findService(sim.accessory, Service.Thermostat)
    expect(thermostat.testCharacteristic(Characteristic.CurrentRelativeHumidity)).to.be(true)
    expect(thermostat.isPrimaryService).to.be(true)
  })

  it('updates both on a HUMIDITY event', () => {
    sim.fire('1.HUMIDITY', 52)
    expect(findService(sim.accessory, Service.HumiditySensor).getCharacteristic(Characteristic.CurrentRelativeHumidity).value).to.be(52)
    expect(findService(sim.accessory, Service.Thermostat).getCharacteristic(Characteristic.CurrentRelativeHumidity).value).to.be(52)
    expect(sim.warnings).to.eql([])
  })
})

describe('Refine: HmIP-WTH-2 humidity sensor switched off', () => {
  let sim

  before(async () => { sim = await start(WTH, { showSepHumidityTile: false }) })
  after(() => sim.shutdown())

  it('keeps the stored choice', () => {
    expect(findService(sim.accessory, Service.HumiditySensor)).to.be(undefined)
    expect(findService(sim.accessory, Service.Thermostat).testCharacteristic(Characteristic.CurrentRelativeHumidity)).to.be(true)
  })
})

describe('Refine: HmIP-eTRV without HUMIDITY', () => {
  let sim

  before(async () => {
    sim = await start({ ...WTH, type: 'HmIP-eTRV-2', address: '0001A0A9B18503', values: { '1.LEVEL': 0.2, '0.LOW_BAT': false } }, {})
  })
  after(() => sim.shutdown())

  it('adds no humidity sensor', () => {
    expect(findService(sim.accessory, Service.HumiditySensor)).to.be(undefined)
  })
})

describe('Refine: HM-TC-IT-WM-W-EU humidity sensor (no stored setting)', () => {
  let sim

  before(async () => { sim = await start(TC, {}) })
  after(() => sim.shutdown())

  it('adds a humidity sensor and keeps the humidity of the thermostat', async () => {
    const sensor = findService(sim.accessory, Service.HumiditySensor)
    expect(sensor).to.be.ok()
    expect(await read(sensor.getCharacteristic(Characteristic.CurrentRelativeHumidity))).to.be(40)
    expect(findService(sim.accessory, Service.Thermostat).testCharacteristic(Characteristic.CurrentRelativeHumidity)).to.be(true)
  })
})

describe('Refine: HM-TC-IT-WM-W-EU humidity sensor switched off', () => {
  let sim

  before(async () => { sim = await start(TC, { showSepHumidityTile: false }) })
  after(() => sim.shutdown())

  it('keeps the stored choice', () => {
    expect(findService(sim.accessory, Service.HumiditySensor)).to.be(undefined)
    expect(findService(sim.accessory, Service.Thermostat).testCharacteristic(Characteristic.CurrentRelativeHumidity)).to.be(true)
  })
})

describe('Refine: HM-TC-IT-WM-W-EU humidity sensor switched on', () => {
  let sim

  before(async () => { sim = await start(TC, { showSepHumidityTile: true }) })
  after(() => sim.shutdown())

  it('shows the humidity in the sensor and in the thermostat', async () => {
    const sensor = findService(sim.accessory, Service.HumiditySensor)
    expect(sensor).to.be.ok()
    const thermostat = findService(sim.accessory, Service.Thermostat)
    expect(thermostat.testCharacteristic(Characteristic.CurrentRelativeHumidity)).to.be(true)
    expect(await read(thermostat.getCharacteristic(Characteristic.CurrentRelativeHumidity))).to.be(40)
  })
})
