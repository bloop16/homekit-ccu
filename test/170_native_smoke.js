const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { read, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { readAll } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { simulateFixture } = require(path.join(__dirname, 'helpers', 'nativeHarness.js'))
const HomeMaticIPSmokeDetectorAccessory = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticIPSmokeDetectorAccessory.js'))

const Smoke = Characteristic.SmokeDetected
const Fault = Characteristic.StatusFault
const Battery = Characteristic.StatusLowBattery

describe('Native: HmIP smoke detectors by channel type', () => {
  it('supports every HmIP SMOKE_DETECTOR channel, not only the HmIP-SWSD', () => {
    expect(HomeMaticIPSmokeDetectorAccessory.channelTypes()).to.contain('SMOKE_DETECTOR')
  })

  it('leaves the BidCos smoke detectors to their own class', () => {
    expect(HomeMaticIPSmokeDetectorAccessory.filterDevice()).to.contain('HM-Sec-SD')
    expect(HomeMaticIPSmokeDetectorAccessory.filterDevice()).to.contain('HM-Sec-SD-2')
  })
})

describe('Native: HmIP-SWSD-2 smoke detector', () => {
  let sim
  let sensor
  let smoke

  before(async () => {
    sim = await simulateFixture('HmIP-SWSD-2.json', {
      channel: 1,
      service: 'HomeMaticIPSmokeDetectorAccessory',
      omit: ['1.SMOKE_DETECTOR_ALARM_STATUS']
    })
    sensor = findService(sim.accessory, Service.SmokeSensor)
    smoke = sensor.getCharacteristic(Smoke)
  })

  after(() => sim.shutdown())

  it('is published as smoke sensor', () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticIPSmokeDetectorAccessory')
    expect(sensor).to.be.ok()
  })

  it('answers every read before the CCU sent an alarm status', async () => {
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(smoke)).to.be(Smoke.SMOKE_NOT_DETECTED)
    expect(sim.warnings).to.eql([])
  })

  it('shows the primary alarm and the end of it', async () => {
    sim.fire('1.SMOKE_DETECTOR_ALARM_STATUS', 1)
    expect(smoke.value).to.be(Smoke.SMOKE_DETECTED)
    expect(await read(smoke)).to.be(Smoke.SMOKE_DETECTED)
    sim.fire('1.SMOKE_DETECTOR_ALARM_STATUS', 0)
    expect(smoke.value).to.be(Smoke.SMOKE_NOT_DETECTED)
  })

  it('is not disturbed by SMOKE_LEVEL and DIRT_LEVEL events', async () => {
    sim.fire('1.SMOKE_LEVEL', 0.37)
    sim.fire('1.DIRT_LEVEL', 1.01)
    expect(smoke.value).to.be(Smoke.SMOKE_NOT_DETECTED)
    expect(await readAll(sim.accessory)).to.eql([])
    expect(sim.warnings).to.eql([])
  })

  it('reports a degraded smoke chamber as fault', async () => {
    const fault = sensor.getCharacteristic(Fault)
    sim.fire('0.ERROR_DEGRADED_CHAMBER', true)
    expect(fault.value).to.be(Fault.GENERAL_FAULT)
    sim.fire('0.ERROR_DEGRADED_CHAMBER', false)
    expect(await read(fault)).to.be(Fault.NO_FAULT)
  })

  it('reports the battery of the maintenance channel', async () => {
    const battery = findService(sim.accessory, Service.Battery)
    expect(battery).to.be.ok()
    sim.fire('0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Battery))).to.be(Battery.BATTERY_LEVEL_LOW)
    sim.fire('0.LOW_BAT', false)
    expect(await read(battery.getCharacteristic(Battery))).to.be(Battery.BATTERY_LEVEL_NORMAL)
    expect(sim.warnings).to.eql([])
  })
})
