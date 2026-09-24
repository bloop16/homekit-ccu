const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { read, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { readAll } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { simulateFixture } = require(path.join(__dirname, 'helpers', 'nativeHarness.js'))

const Occupancy = Characteristic.OccupancyDetected
const Leak = Characteristic.LeakDetected

describe('Native: HmIP-SPI presence detector as occupancy sensor', () => {
  let sim
  let occupancy
  let light

  before(async () => {
    sim = await simulateFixture('HmIP-SPI.json', {
      channel: 1,
      service: 'HomeMaticOccupancyAccessory',
      omit: ['1.PRESENCE_DETECTION_STATE', '1.PRESENCE_DETECTION_ACTIVE', '1.ILLUMINATION', '1.CURRENT_ILLUMINATION']
    })
    occupancy = findService(sim.accessory, Service.OccupancySensor)
    light = findService(sim.accessory, Service.LightSensor)
  })

  after(() => sim.shutdown())

  it('has the occupancy sensor as primary service and a light sensor', () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticOccupancyAccessory')
    expect(occupancy.isPrimaryService).to.be(true)
    expect(light).to.be.ok()
    expect(findService(sim.accessory, Service.MotionSensor)).to.be(undefined)
  })

  it('answers every read before the CCU sent a value', async () => {
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(occupancy.getCharacteristic(Occupancy))).to.be(Occupancy.OCCUPANCY_NOT_DETECTED)
    expect(await read(occupancy.getCharacteristic(Characteristic.StatusActive))).to.be(true)
    const lux = await read(light.getCharacteristic(Characteristic.CurrentAmbientLightLevel))
    expect(lux >= 0.0001 && lux <= 100000).to.be(true)
    expect(sim.warnings).to.eql([])
  })

  it('shows PRESENCE_DETECTION_STATE as occupancy', async () => {
    const ch = occupancy.getCharacteristic(Occupancy)
    sim.fire('1.PRESENCE_DETECTION_STATE', true)
    expect(ch.value).to.be(Occupancy.OCCUPANCY_DETECTED)
    expect(await read(ch)).to.be(Occupancy.OCCUPANCY_DETECTED)
    sim.fire('1.PRESENCE_DETECTION_STATE', false)
    expect(ch.value).to.be(Occupancy.OCCUPANCY_NOT_DETECTED)
  })

  it('shows PRESENCE_DETECTION_ACTIVE as StatusActive', async () => {
    const ch = occupancy.getCharacteristic(Characteristic.StatusActive)
    sim.fire('1.PRESENCE_DETECTION_ACTIVE', false)
    expect(ch.value).to.be(false)
    sim.fire('1.PRESENCE_DETECTION_ACTIVE', true)
    expect(await read(ch)).to.be(true)
  })

  it('shows the illumination, clamped to the HomeKit range', async () => {
    const ch = light.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
    sim.fire('1.ILLUMINATION', 120)
    expect(ch.value).to.be(120)
    sim.fire('1.CURRENT_ILLUMINATION', 0)
    expect(ch.value).to.be(0.0001)
    // the average no longer overrides the current illumination
    sim.fire('1.ILLUMINATION', 80)
    expect(ch.value).to.be(0.0001)
    sim.fire('1.CURRENT_ILLUMINATION', 163830)
    expect(await read(ch)).to.be(100000)
    expect(sim.warnings).to.eql([])
  })

  it('reports SABOTAGE as tampered and the battery', async () => {
    const tampered = occupancy.getCharacteristic(Characteristic.StatusTampered)
    sim.fire('0.SABOTAGE', true)
    expect(tampered.value).to.be(Characteristic.StatusTampered.TAMPERED)
    sim.fire('0.SABOTAGE', false)
    expect(await read(tampered)).to.be(Characteristic.StatusTampered.NOT_TAMPERED)
    const battery = findService(sim.accessory, Service.Battery)
    sim.fire('0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
    expect(sim.warnings).to.eql([])
  })
})

describe('Native: HmIPW-SPI wired presence detector', () => {
  let sim

  before(async () => {
    sim = await simulateFixture('HmIPW-SPI.json', {
      channel: 1,
      service: 'HomeMaticOccupancyAccessory'
    })
  })

  after(() => sim.shutdown())

  it('has neither battery nor tamper state without the datapoints', async () => {
    const occupancy = findService(sim.accessory, Service.OccupancySensor)
    expect(findService(sim.accessory, Service.Battery)).to.be(undefined)
    expect(occupancy.testCharacteristic(Characteristic.StatusTampered)).to.be(false)
    expect(await readAll(sim.accessory)).to.eql([])
  })
})

describe('Native: HM-Sen-RD-O rain sensor as leak sensor', () => {
  let sim
  let leak

  before(async () => {
    sim = await simulateFixture('HM-Sen-RD-O.json', {
      channel: 1,
      service: 'HomeMaticRainLeakAccessory',
      omit: ['1.STATE']
    })
    leak = findService(sim.accessory, Service.LeakSensor).getCharacteristic(Leak)
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a value', async () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticRainLeakAccessory')
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(leak)).to.be(Leak.LEAK_NOT_DETECTED)
    expect(sim.warnings).to.eql([])
  })

  it('shows RAIN (1) as leak and DRY (0) as no leak', async () => {
    sim.fire('1.STATE', 1)
    expect(leak.value).to.be(Leak.LEAK_DETECTED)
    expect(await read(leak)).to.be(Leak.LEAK_DETECTED)
    sim.fire('1.STATE', 0)
    expect(leak.value).to.be(Leak.LEAK_NOT_DETECTED)
    sim.fire('1.STATE', 'RAIN')
    expect(leak.value).to.be(Leak.LEAK_DETECTED)
    sim.fire('1.STATE', '')
    expect(leak.value).to.be(Leak.LEAK_DETECTED)
    sim.fire('1.STATE', false)
    expect(await read(leak)).to.be(Leak.LEAK_NOT_DETECTED)
    expect(sim.warnings).to.eql([])
  })
})
