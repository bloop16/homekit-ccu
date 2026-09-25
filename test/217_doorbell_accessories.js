'use strict'

// Doorbells without camera that Apple Home shows as doorbell: the service of a doorbell channel
// (HmIP-DSD-PCB, HmIP-DBB, HM-Sen-DB-PCB, keys) and the special device, which rings on any
// datapoint. The HmIP-DSD-PCB sends PRESS_SHORT as a key (factory setting) and STATE when its
// channel is switched to switch or contact mode in the CCU.

const path = require('path')
const os = require('os')
const fs = require('fs')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, findService, settle } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { orderedServicesForChannel } = require(path.join(__dirname, '..', 'lib', 'util', 'defaultServices.js'))

const SERVICES_DIR = path.join(__dirname, '..', 'lib', 'services')
const DSD = { type: 'HmIP-DSD-PCB', address: '0002DD89A1B2C3', channels: ['MAINTENANCE', 'MULTI_MODE_INPUT_TRANSMITTER'], channel: 1, service: 'HomeMaticContactSensorAccessory', values: { '0.LOW_BAT': false, '1.PRESS_SHORT': true, '1.PRESS_LONG': true, '1.STATE': false } }
// the channel operation modes as the CCU returns them (index into its value list)
const MODE = { KEY_BEHAVIOR: 1, SWITCH_BEHAVIOR: 2, BINARY_BEHAVIOR: 3 }

let devdb
before(() => {
  devdb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-217-')), 'DEVDB.tcl')
  fs.writeFileSync(devdb, 'array set DEV_PATHS {HmIP-DSD-PCB {{50 /config/img/devices/50/HmIP-DSD-PCB_thumb.png} {250 /config/img/devices/250/HmIP-DSD-PCB.png}}}\n')
  process.env.HOMEKIT_CCU_DEVDB = devdb
})
after(() => {
  delete process.env.HOMEKIT_CCU_DEVDB
  fs.rmSync(path.dirname(devdb), { recursive: true, force: true })
})

function ringsOf (accessory) {
  const rings = []
  const doorbell = findService(accessory, Service.Doorbell)
  doorbell.getCharacteristic(Characteristic.ProgrammableSwitchEvent).on('change', change => rings.push(change.newValue))
  return rings
}

async function simulated (mode) {
  const sim = await simulateDevice(DSD)
  const ccu = sim.server._ccu
  const send = ccu.sendInterfaceCommand.bind(ccu)
  ccu.paramsetRequests = []
  ccu.sendInterfaceCommand = (intf, command, params) => {
    if (command === 'getParamset') {
      ccu.paramsetRequests.push(params)
      return Promise.resolve((mode === undefined) ? {} : { CHANNEL_OPERATION_MODE: mode })
    }
    return send(intf, command, params)
  }
  return sim
}

describe('HomeKit-CCU doorbell without camera', () => {
  describe('service of a doorbell channel', () => {
    const DoorBell = require(path.join(SERVICES_DIR, 'HomeMaticDoorBellAccessory.js'))

    async function doorbellIn (mode, settings = {}) {
      const sim = await simulated(mode)
      const accessory = new DoorBell({ name: 'Klingel', address: DSD.address + ':1', type: 'MULTI_MODE_INPUT_TRANSMITTER', dtype: DSD.type }, 'HmIP', sim.server, { Service: 'HomeMaticDoorBellAccessory', settings })
      accessory.init()
      await settle(30)
      return { sim, accessory }
    }

    it('is a doorbell of a camera, so Apple Home shows it as doorbell', async () => {
      const { sim, accessory } = await doorbellIn(MODE.KEY_BEHAVIOR)
      try {
        const doorbell = findService(accessory, Service.Doorbell)
        expect(doorbell.isPrimaryService).to.be(true)
        expect(findService(accessory, Service.CameraRTPStreamManagement)).to.be.ok()
        expect(accessory.isBridgedAccessory()).to.be(true)
      } finally {
        accessory.shutdown()
        sim.shutdown()
      }
    })

    it('rings on PRESS_SHORT in key mode (factory setting), not on STATE', async () => {
      const { sim, accessory } = await doorbellIn(MODE.KEY_BEHAVIOR)
      try {
        expect(sim.server._ccu.paramsetRequests).to.eql([[DSD.address + ':1', 'MASTER']])
        const rings = ringsOf(accessory)
        sim.fire('1.STATE', true)
        sim.fire('1.PRESS_SHORT', true)
        await settle()
        expect(rings).to.eql([Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS])
      } finally {
        accessory.shutdown()
        sim.shutdown()
      }
    })

    Object.entries({ switch: MODE.SWITCH_BEHAVIOR, contact: MODE.BINARY_BEHAVIOR, 'contact (by name)': 'BINARY_BEHAVIOR' }).forEach(([name, mode]) => {
      it(`rings when STATE becomes active in ${name} mode, not on key events`, async () => {
        const { sim, accessory } = await doorbellIn(mode)
        try {
          const rings = ringsOf(accessory)
          sim.fire('1.STATE', false) // start value
          sim.fire('1.PRESS_SHORT', true)
          sim.fire('1.STATE', true)
          await settle()
          expect(rings).to.eql([Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS])
        } finally {
          accessory.shutdown()
          sim.shutdown()
        }
      })
    })

    it('takes key events when the CCU does not tell the mode', async () => {
      const { sim, accessory } = await doorbellIn(undefined)
      try {
        const rings = ringsOf(accessory)
        sim.fire('1.PRESS_SHORT', true)
        await settle()
        expect(rings.length).to.be(1)
      } finally {
        accessory.shutdown()
        sim.shutdown()
      }
    })

    it('shows the picture of the device in the CCU, or the configured one first', async () => {
      const first = await doorbellIn(MODE.KEY_BEHAVIOR)
      const configured = await doorbellIn(MODE.KEY_BEHAVIOR, { imageSource: 'URL', image: 'http://camera/still.jpg' })
      try {
        expect(first.accessory.stillImage.sources).to.eql([{ kind: 'ccu', value: '/config/img/devices/250/HmIP-DSD-PCB.png' }])
        expect(configured.accessory.stillImage.sources).to.eql([
          { kind: 'url', value: 'http://camera/still.jpg' },
          { kind: 'ccu', value: '/config/img/devices/250/HmIP-DSD-PCB.png' }
        ])
      } finally {
        [first, configured].forEach(t => { t.accessory.shutdown(); t.sim.shutdown() })
      }
    })
  })

  describe('special device', () => {
    const SPDoorBell = require(path.join(SERVICES_DIR, 'HomeMaticSPDoorBellAccessory.js'))

    async function specialDoorbell (settings) {
      const sim = await simulated(MODE.KEY_BEHAVIOR)
      const accessory = new SPDoorBell({ name: 'Haustür', address: 'SPBELL:0' }, 'Special', sim.server, { Service: 'HomeMaticSPDoorBellAccessory', settings })
      accessory.init()
      await settle(30)
      return { sim, accessory }
    }

    it('rings on the chosen key datapoint and shows the picture of its device', async () => {
      const { sim, accessory } = await specialDoorbell({ address_door_bell_key: 'HmIP.' + DSD.address + ':1.PRESS_SHORT' })
      try {
        expect(findService(accessory, Service.Doorbell).isPrimaryService).to.be(true)
        expect(accessory.isBridgedAccessory()).to.be(true)
        const rings = ringsOf(accessory)
        sim.fire('1.PRESS_SHORT', true)
        await settle()
        expect(rings.length).to.be(1)
        expect(accessory.stillImage.sources).to.eql([{ kind: 'ccu', value: '/config/img/devices/250/HmIP-DSD-PCB.png' }])
      } finally {
        accessory.shutdown()
        sim.shutdown()
      }
    })

    it('rings when a chosen state datapoint becomes active', async () => {
      const { sim, accessory } = await specialDoorbell({ address_door_bell_key: 'HmIP.' + DSD.address + ':1.STATE', imageSource: 'File on the CCU', image: '/usr/local/etc/config/addons/homekit-ccu/bell.jpg' })
      try {
        const rings = ringsOf(accessory)
        sim.fire('1.STATE', false)
        sim.fire('1.STATE', true)
        await settle()
        expect(rings.length).to.be(1)
        expect(accessory.stillImage.sources[0]).to.eql({ kind: 'file', value: '/usr/local/etc/config/addons/homekit-ccu/bell.jpg' })
      } finally {
        accessory.shutdown()
        sim.shutdown()
      }
    })

    it('offers the datapoints of keys, doorbell sensors and contacts', () => {
      const { filterChannels } = SPDoorBell.configurationItems().address_door_bell_key.options
      ;['KEY', 'KEY_TRANSCEIVER', 'VIRTUAL_KEY', 'MULTI_MODE_INPUT_TRANSMITTER', 'SWITCH_INTERFACE', 'SHUTTER_CONTACT', 'SHUTTER_CONTACT_TRANSCEIVER']
        .forEach(type => expect(filterChannels).to.contain(type))
    })
  })

  describe('services offered for doorbell devices', () => {
    const table = {
      MULTI_MODE_INPUT_TRANSMITTER: ['HomeMaticKeyAccessory', 'HomeMaticDoorBellAccessory', 'HomeMaticContactSensorAccessory', 'HomeMaticDoorAccessory', 'HomeMaticWindowAccessory'].map(serviceClazz => ({ serviceClazz, priority: 0 })),
      KEY_TRANSCEIVER: ['HomeMaticRemoteAccessory', 'HomeMaticKeyAccessory', 'HomeMaticDoorBellAccessory', 'HomeMaticPushTheButtonAccessory'].map(serviceClazz => ({ serviceClazz, priority: 0 })),
      KEY: ['HomeMaticRemoteAccessory', 'HomeMaticKeyAccessory', 'HomeMaticDoorBellAccessory'].map(serviceClazz => ({ serviceClazz, priority: 0 }))
    }
    const offered = (deviceType, channelType) => orderedServicesForChannel(table, deviceType, channelType).map(entry => entry.serviceClazz)

    it('offers only doorbell and key for the doorbell devices, doorbell first', () => {
      expect(offered('HmIP-DSD-PCB', 'MULTI_MODE_INPUT_TRANSMITTER')).to.eql(['HomeMaticDoorBellAccessory', 'HomeMaticKeyAccessory'])
      expect(offered('HmIP-DBB', 'KEY_TRANSCEIVER')).to.eql(['HomeMaticDoorBellAccessory', 'HomeMaticKeyAccessory'])
      expect(offered('HM-Sen-DB-PCB', 'KEY')).to.eql(['HomeMaticDoorBellAccessory', 'HomeMaticKeyAccessory'])
    })

    it('still offers the stored service of a doorbell channel mapped before as something else', () => {
      const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))
      const service = Object.create(ConfigurationService.prototype)
      service.services = table
      service.compatibleDevices = [{ type: 'HmIP-DSD-PCB', address: DSD.address, channels: [{ address: DSD.address + ':1', type: 'MULTI_MODE_INPUT_TRANSMITTER' }] }]
      service.storedMappingFor = () => ({ Service: 'HomeMaticContactSensorAccessory' })
      const listed = service.serviceSettingsFor(DSD.address + ':1').service.map(entry => entry.serviceClazz)
      expect(listed).to.eql(['HomeMaticDoorBellAccessory', 'HomeMaticKeyAccessory', 'HomeMaticContactSensorAccessory'])
    })

    it('keeps every service for other devices with these channel types', () => {
      expect(offered('HmIP-FCI1', 'MULTI_MODE_INPUT_TRANSMITTER')).to.contain('HomeMaticDoorBellAccessory')
      expect(offered('HmIP-FCI1', 'MULTI_MODE_INPUT_TRANSMITTER')).to.contain('HomeMaticContactSensorAccessory')
      expect(offered('HmIP-FCI1', 'MULTI_MODE_INPUT_TRANSMITTER')[0]).to.be('HomeMaticContactSensorAccessory')
    })
  })
})
