const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, read, watchWarnings } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

const SMO = '0001D3C99C1A2B'
const BATTERY_VALUES = {
  ['HmIP.' + SMO + ':0.LOW_BAT']: false,
  ['HmIP.' + SMO + ':0.OPERATING_VOLTAGE']: 3.0
}

describe('HomeKit-CCU sensors: HmIP-SMO-A-2 outdoor motion detector', () => {
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HmIP-SMO-A-2.json', { values: BATTERY_VALUES }))
    accessory = accessoryAt(server, SMO + ':1')
  })

  after(() => shutdown(server))

  let warnings
  beforeEach(() => { warnings = watchWarnings(accessory) })
  afterEach(function () {
    warnings.stop()
    if (this.currentTest.state === 'passed') expect(warnings.list).to.eql([])
  })

  it('is mapped to HomeMaticIPMotionAccessory', () => {
    expect(accessory.serviceClass).to.be('HomeMaticIPMotionAccessory')
  })

  it('answers every read with a valid value before the CCU sent any event', async () => {
    const problems = await readAll(accessory)
    expect(problems).to.eql([])
  })

  it('keeps the motion sensor primary and the light sensor subtype', () => {
    const motion = findService(accessory, Service.MotionSensor, 'Motion')
    expect(motion).to.be.ok()
    expect(motion.isPrimaryService).to.be(true)
    expect(findService(accessory, Service.LightSensor, 'Illumination')).to.be.ok()
  })

  it('names the light sensor like the accessory', () => {
    const light = findService(accessory, Service.LightSensor, 'Illumination')
    expect(light.getCharacteristic(Characteristic.Name).value).to.be(accessory.getName() + ' Illumination')
  })

  it('maps ILLUMINATION 0 (night) to the HAP minimum 0.0001 lx', async () => {
    const light = findService(accessory, Service.LightSensor, 'Illumination')
    const level = light.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
    server._ccu.fireEvent('HmIP.' + SMO + ':1.ILLUMINATION', 0)
    expect(level.value).to.be(0.0001)
    expect(await read(level)).to.be(0.0001)
  })

  it('caps ILLUMINATION above 100000 lx', async () => {
    const light = findService(accessory, Service.LightSensor, 'Illumination')
    const level = light.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
    server._ccu.fireEvent('HmIP.' + SMO + ':1.ILLUMINATION', 120000)
    expect(level.value).to.be(100000)
    expect(await read(level)).to.be(100000)
  })

  it('passes a normal ILLUMINATION through', async () => {
    const light = findService(accessory, Service.LightSensor, 'Illumination')
    const level = light.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
    server._ccu.fireEvent('HmIP.' + SMO + ':1.ILLUMINATION', 1234.5)
    expect(level.value).to.be(1234.5)
    expect(await read(level)).to.be(1234.5)
  })

  it('reports StatusActive from MOTION_DETECTION_ACTIVE', async () => {
    const motion = findService(accessory, Service.MotionSensor, 'Motion')
    const active = motion.getCharacteristic(Characteristic.StatusActive)
    server._ccu.fireEvent('HmIP.' + SMO + ':1.MOTION_DETECTION_ACTIVE', false)
    expect(active.value).to.be(false)
    expect(await read(active)).to.be(false)
    server._ccu.fireEvent('HmIP.' + SMO + ':1.MOTION_DETECTION_ACTIVE', true)
    expect(active.value).to.be(true)
    expect(await read(active)).to.be(true)
  })

  it('reports motion', async () => {
    const motion = findService(accessory, Service.MotionSensor, 'Motion')
    server._ccu.fireEvent('HmIP.' + SMO + ':1.MOTION', true)
    expect(await read(motion.getCharacteristic(Characteristic.MotionDetected))).to.be(true)
    server._ccu.fireEvent('HmIP.' + SMO + ':1.MOTION', false)
    expect(await read(motion.getCharacteristic(Characteristic.MotionDetected))).to.be(false)
  })

  it('has a battery service with low battery state', async () => {
    const battery = findService(accessory, Service.Battery)
    expect(battery).to.be.ok()
    server._ccu.fireEvent('HmIP.' + SMO + ':0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
  })
})

describe('HomeKit-CCU sensors: HmIP-SMO-A-2 without MOTION_DETECTION_ACTIVE value', () => {
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HmIP-SMO-A-2.json'))
    accessory = accessoryAt(server, SMO + ':1')
  })

  after(() => shutdown(server))

  it('treats an unknown MOTION_DETECTION_ACTIVE as active', async () => {
    const motion = findService(accessory, Service.MotionSensor, 'Motion')
    expect(await read(motion.getCharacteristic(Characteristic.StatusActive))).to.be(true)
  })

  it('has no battery service when the device reports no LOW_BAT', () => {
    expect(findService(accessory, Service.Battery)).to.be(undefined)
  })
})
