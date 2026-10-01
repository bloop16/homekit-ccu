'use strict'

// HmIP-SPDR passage detector (hap-homematic #564): CURRENT_PASSAGE_DIRECTION tells the direction
// of a passage, Apple Home gets a motion sensor per direction that detects motion for one second.

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, read, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { orderedServicesForChannel } = require(path.join(__dirname, '..', 'lib', 'util', 'defaultServices.js'))
const { buildDeviceCatalog } = require(path.join(__dirname, '..', 'lib', 'util', 'newDeviceCatalog.js'))
const fixture = require(path.join(__dirname, 'devices', 'HmIP-SPDR.json'))

const MotionDetected = Characteristic.MotionDetected
const CHANNELS = fixture.devices[0].channels.map(channel => channel.type)

const simulate = (channel, settings) => simulateDevice({
  type: 'HmIP-SPDR',
  address: fixture.devices[0].address,
  channels: CHANNELS,
  channel,
  service: 'HomeMaticPassageSensorAccessory',
  settings: settings || {},
  values: { '0.LOW_BAT': false }
})

const sensors = (sim) => sim.accessory.homeKitAccessory.services.filter(service => service.UUID === Service.MotionSensor.UUID)

describe('HomeKit-CCU passage detector HmIP-SPDR', () => {
  it('is the default service of the direction channels', () => {
    const table = { PASSAGE_DETECTOR_DIRECTION_TRANSMITTER: [{ serviceClazz: 'HomeMaticPassageSensorAccessory' }] }
    expect(orderedServicesForChannel(table, 'HmIP-SPDR', 'PASSAGE_DETECTOR_DIRECTION_TRANSMITTER')[0].serviceClazz).to.be('HomeMaticPassageSensorAccessory')
    expect(require(path.join(__dirname, '..', 'lib', 'util', 'defaultServices.js')).DEFAULT_SERVICES.PASSAGE_DETECTOR_DIRECTION_TRANSMITTER).to.eql(['HomeMaticPassageSensorAccessory'])
  })

  it('offers only the first of the two direction channels, as a motion sensor accessory', () => {
    const devices = fixture.devices.map(device => ({
      ...device,
      channels: device.channels.map(channel => ({ ...channel, isSuported: channel.type === 'PASSAGE_DETECTOR_DIRECTION_TRANSMITTER' }))
    }))
    const serviceTable = { PASSAGE_DETECTOR_DIRECTION_TRANSMITTER: [{ serviceClazz: 'HomeMaticPassageSensorAccessory', description: 'passage' }] }
    const channels = buildDeviceCatalog(devices, {}, { serviceTable, rooms: [], functions: [], icons: {} })[0].channels
    expect(channels.map(channel => [channel.number, channel.secondary])).to.eql([[2, false], [3, true]])
    expect(buildDeviceCatalog(devices, {}, { serviceTable, rooms: [], functions: [], icons: {} })[0].category).to.be('sensor')
  })

  describe('as a service', function () {
    this.timeout(10000)
    let sim
    beforeEach(async () => { sim = await simulate(2) })
    afterEach(() => sim.shutdown())

    it('publishes one motion sensor per direction, quiet at the start', async () => {
      const [first, second] = sensors(sim)
      expect(sensors(sim).length).to.be(2)
      expect(first.displayName).not.to.be(second.displayName)
      expect(await read(first.getCharacteristic(MotionDetected))).to.be(false)
      expect(await read(second.getCharacteristic(MotionDetected))).to.be(false)
      expect(sim.warnings).to.eql([])
    })

    it('true is the first direction for one second, false the second', async () => {
      const [first, second] = sensors(sim)
      sim.fire('2.CURRENT_PASSAGE_DIRECTION', true)
      expect(first.getCharacteristic(MotionDetected).value).to.be(true)
      expect(second.getCharacteristic(MotionDetected).value).to.be(false)
      await settle(1200)
      expect(first.getCharacteristic(MotionDetected).value).to.be(false)
      sim.fire('2.CURRENT_PASSAGE_DIRECTION', false)
      expect(first.getCharacteristic(MotionDetected).value).to.be(false)
      expect(second.getCharacteristic(MotionDetected).value).to.be(true)
      await settle(1200)
      expect(second.getCharacteristic(MotionDetected).value).to.be(false)
    })

    it('a second passage in the same direction while it is on keeps it on for another second', async () => {
      const [first] = sensors(sim)
      sim.fire('2.CURRENT_PASSAGE_DIRECTION', true)
      await settle(700)
      sim.fire('2.CURRENT_PASSAGE_DIRECTION', true)
      await settle(700)
      expect(first.getCharacteristic(MotionDetected).value).to.be(true)
      await settle(500)
      expect(first.getCharacteristic(MotionDetected).value).to.be(false)
    })

    it('ignores events without a value and events of the other channel', async () => {
      const [first, second] = sensors(sim)
      sim.fire('2.CURRENT_PASSAGE_DIRECTION', '')
      sim.fire('3.CURRENT_PASSAGE_DIRECTION', true)
      expect(first.getCharacteristic(MotionDetected).value).to.be(false)
      expect(second.getCharacteristic(MotionDetected).value).to.be(false)
    })
  })

  it('swaps the directions with the setting', async () => {
    const sim = await simulate(3, { reverse: true })
    try {
      const [first, second] = sensors(sim)
      sim.fire('3.CURRENT_PASSAGE_DIRECTION', true)
      expect(first.getCharacteristic(MotionDetected).value).to.be(false)
      expect(second.getCharacteristic(MotionDetected).value).to.be(true)
    } finally {
      sim.shutdown()
    }
  })

  it('has no pending timer after shutdown', async () => {
    const sim = await simulate(2)
    sim.fire('2.CURRENT_PASSAGE_DIRECTION', true)
    sim.shutdown()
    const motion = findService(sim.accessory, Service.MotionSensor).getCharacteristic(MotionDetected)
    const before = motion.value
    await settle(1200)
    expect(motion.value).to.be(before)
  })
})
