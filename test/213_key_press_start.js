'use strict'

// A key press is an action, not a state: a press read again later is no new press.
// Since the start values are read in bulk (0.1.1-rc.4) key presses get no start value while the
// add-on starts, but the key classes still dropped the first event after registering as "the answer
// to the start query": the first real press of every key after a start was lost (also the first
// ring of a doorbell). Classes that did not drop it sent a phantom press when they were created
// after the start (saving the configuration): registering replayed the last press from the cache.
// Now registering an action datapoint never delivers a value, and every event is a press.

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const HomeMaticCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticCCU.js'))
const { isActionDatapoint } = require(path.join(__dirname, '..', 'lib', 'util', 'regaBulkRead.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))
const { simulateDevice, findService, settle } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { simulateFixture } = require(path.join(__dirname, 'helpers', 'nativeHarness.js'))

const { SINGLE_PRESS } = Characteristic.ProgrammableSwitchEvent

describe('HomeKit-CCU key presses after a start', () => {
  describe('registering a datapoint', () => {
    function ccu () {
      const instance = new HomeMaticCCU(recordingLog(), { storagePath: '/tmp' })
      instance.regaReads = []
      instance.readValue = (address) => { instance.regaReads.push(address); return Promise.resolve('x') }
      return instance
    }

    it('knows the action datapoints', () => {
      expect(['HmIP-RF.A:1.PRESS_SHORT', 'BidCos-RF.B:1.PRESS_LONG', 'HmIP-RF.A:1.PRESS_LONG_RELEASE', 'BidCos-RF.B:0.INSTALL_TEST'].every(isActionDatapoint)).to.be(true)
      expect(['HmIP-RF.A:1.STATE', 'HmIP-RF.A:0.LOW_BAT', 'HmIP-RF.A:1.PRESS_COUNT_X'.replace('PRESS_COUNT_X', 'LEVEL')].some(isActionDatapoint)).to.be(false)
    })

    it('delivers no value for a key press after the start, neither from the cache nor from Rega', () => {
      const instance = ccu()
      instance.startValuesPending = false
      instance.setCache('HmIP-RF.A:1.PRESS_SHORT', 'true')
      const received = []
      instance.registerAddressForEventProcessingAtAccessory('HmIP-RF.A:1.PRESS_SHORT', value => received.push(value))
      instance.registerAddressForEventProcessingAtAccessory('HmIP-RF.A:1.PRESS_LONG', value => received.push(value))
      expect(received).to.eql([])
      expect(instance.regaReads).to.eql([])
      // a real press still arrives
      instance.fireEvent('HmIP-RF.A:1.PRESS_SHORT', true)
      expect(received).to.eql([true])
    })

    it('still delivers the known value of a state', () => {
      const instance = ccu()
      instance.startValuesPending = false
      instance.setCache('HmIP-RF.A:1.STATE', 'true')
      const received = []
      instance.registerAddressForEventProcessingAtAccessory('HmIP-RF.A:1.STATE', value => received.push(value))
      instance.registerAddressForEventProcessingAtAccessory('HmIP-RF.A:1.LEVEL', value => received.push(value))
      expect(received).to.eql(['true'])
      expect(instance.regaReads).to.eql(['HmIP-RF.A:1.LEVEL'])
    })
  })

  describe('key accessories', () => {
    const PHASES = {
      // the add-on starts: start values are read in bulk later, key presses are not among them
      start: (ccu) => { ccu.startValuesPending = true },
      // a mapping saved later: the cache holds the last press of this key
      later: (ccu, dp) => { ccu.startValuesPending = false; ccu.setCache(dp, true) }
    }

    // the values HomeKit is notified about for the key characteristics, from the creation on
    const WATCHED = [Characteristic.ProgrammableSwitchEvent.UUID, Characteristic.MotionDetected.UUID]
    let events
    let restore
    beforeEach(() => {
      events = []
      const { updateValue, sendEventNotification } = Characteristic.prototype
      const record = (original) => function (value, ...rest) {
        if (WATCHED.includes(this.UUID)) events.push(value)
        return original.call(this, value, ...rest)
      }
      Characteristic.prototype.updateValue = record(updateValue)
      Characteristic.prototype.sendEventNotification = record(sendEventNotification)
      restore = () => Object.assign(Characteristic.prototype, { updateValue, sendEventNotification })
    })
    afterEach(() => restore())

    async function accessoryIn (phase, service, spec) {
      // the accessory of the simulation itself listens to no key (simChannel), only the one created here
      const simSpec = (spec.simChannel !== undefined) ? { ...spec, channel: spec.simChannel } : spec
      const sim = spec.fixture ? await simulateFixture(spec.fixture, simSpec) : await simulateDevice(simSpec)
      const ccu = sim.server._ccu
      PHASES[phase](ccu, sim.dp(spec.channel + '.PRESS_SHORT'))
      const Appliance = require(path.join(__dirname, '..', 'lib', 'services', service + '.js'))
      const address = spec.address + ':' + spec.channel
      const accessory = new Appliance({ name: 'Key', address, type: spec.channels[spec.channel], dtype: spec.type }, spec.intf || 'HmIP', sim.server, { Service: service, settings: {} })
      accessory.runsInTestMode = false // like on the CCU
      accessory.init()
      await settle(30)
      return { sim, ccu, accessory }
    }

    const DSD = { type: 'HmIP-DSD-PCB', address: '0002DD89A1B2C3', channels: ['MAINTENANCE', 'MULTI_MODE_INPUT_TRANSMITTER'], channel: 1, service: 'HomeMaticContactSensorAccessory', values: { '0.LOW_BAT': false, '1.PRESS_SHORT': true, '1.PRESS_LONG': true } }
    const KRC4 = { fixture: 'HmIP-KRC4.json', type: 'HmIP-KRC4', address: '000B1BE9A1B2C3', channels: ['MAINTENANCE', 'KEY_TRANSCEIVER', 'KEY_TRANSCEIVER', 'KEY_TRANSCEIVER', 'KEY_TRANSCEIVER'], channel: 1, simChannel: 2, service: 'HomeMaticPushTheButtonAccessory', values: { '0.LOW_BAT': false, '1.PRESS_SHORT': true, '1.PRESS_LONG': true } }

    const CASES = [
      ['HomeMaticKeyAccessory', DSD, (a) => findService(a, Service.StatelessProgrammableSwitch).getCharacteristic(Characteristic.ProgrammableSwitchEvent)],
      ['HomeMaticDoorBellAccessory', DSD, (a) => findService(a, Service.Doorbell).getCharacteristic(Characteristic.ProgrammableSwitchEvent)],
      ['HomeMaticKeyTriggeredMotionAccessory', DSD, (a) => findService(a, Service.MotionSensor).getCharacteristic(Characteristic.MotionDetected)]
    ]

    CASES.forEach(([service, spec, characteristicOf]) => {
      Object.keys(PHASES).forEach(phase => {
        it(`${service}: no event when created (${phase}), the first press reaches HomeKit`, async () => {
          const { sim, ccu, accessory } = await accessoryIn(phase, service, spec)
          try {
            expect(characteristicOf(accessory)).to.be.ok()
            // nothing happened yet: registering must not look like a press
            expect(events).to.eql([])
            ccu.fireEvent(sim.dp(spec.channel + '.PRESS_SHORT'), true)
            await settle()
            expect(events.length).to.be.greaterThan(0)
            expect(events[0]).to.be(service === 'HomeMaticKeyTriggeredMotionAccessory' ? true : SINGLE_PRESS)
          } finally {
            accessory.shutdown()
            sim.shutdown()
          }
        })
      })
    })

    Object.keys(PHASES).forEach(phase => {
      it(`HomeMaticRemoteAccessory: the first press of a button reaches HomeKit (${phase})`, async () => {
        const { sim, ccu, accessory } = await accessoryIn(phase, 'HomeMaticRemoteAccessory', KRC4)
        try {
          const buttons = accessory.homeKitAccessory.services.filter(s => s.UUID === Service.StatelessProgrammableSwitch.UUID)
          expect(buttons.length).to.be.greaterThan(0)
          expect(events).to.eql([])
          ccu.fireEvent(sim.dp('1.PRESS_SHORT'), true)
          await settle()
          expect(events).to.eql([SINGLE_PRESS])
        } finally {
          accessory.shutdown()
          sim.shutdown()
        }
      })
    })
  })

  describe('video doorbell', () => {
    const VideoDoorBell = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticSPVideoDoorBellAccessory.js'))

    // the doorbell part of a video doorbell, without camera and ffmpeg
    function doorbellWith (datapoint) {
      const doorbell = Object.create(VideoDoorBell.prototype)
      const callbacks = []
      doorbell._name = 'Door'
      doorbell.debugLog = () => {}
      doorbell.homeKitAccessory = { addService: () => {} }
      doorbell.getDeviceSettings = (key) => (key === 'address_door_bell_key') ? datapoint : undefined
      doorbell.buildAddress = (address) => address
      doorbell.registerAddressForEventProcessingAtAccessory = (address, callback) => callbacks.push(callback)
      doorbell.addDoorbellService(Service, Characteristic)
      return { listeners: callbacks }
    }

    it('rings at the first press of a key datapoint', () => {
      const { listeners } = doorbellWith('HmIP-RF.0002DD89A1B2C3:1.PRESS_SHORT')
      const rings = []
      const original = Characteristic.prototype.sendEventNotification
      Characteristic.prototype.sendEventNotification = function (value) { rings.push(value) }
      try {
        listeners.forEach(listener => listener(true))
        expect(rings).to.eql([SINGLE_PRESS])
      } finally {
        Characteristic.prototype.sendEventNotification = original
      }
    })

    it('takes the first value of a state datapoint as its start value, no ring', () => {
      const { listeners } = doorbellWith('HmIP-RF.0001D3C99C1234:1.STATE')
      const rings = []
      const original = Characteristic.prototype.sendEventNotification
      Characteristic.prototype.sendEventNotification = function (value) { rings.push(value) }
      try {
        listeners.forEach(listener => listener(false))
        expect(rings).to.eql([])
        listeners.forEach(listener => listener(true))
        expect(rings).to.eql([SINGLE_PRESS])
      } finally {
        Characteristic.prototype.sendEventNotification = original
      }
    })
  })
})
