'use strict'

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic, HAPStatus } = require('@homebridge/hap-nodejs')
const { simulateDevice, read, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

// every HomeMatic device: while the CCU reports 0.UNREACH, Apple Home shows "No Response"
describe('HomeKit-CCU base class: unreachable devices', () => {
  let sim
  let contact

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-SWDO-PL-2',
      address: '0001D3C99C5678',
      channels: ['MAINTENANCE', 'SHUTTER_CONTACT_TRANSCEIVER'],
      channel: 1,
      service: 'HomeMaticContactSensorAccessory',
      values: { '0.LOW_BAT': false, '0.OPERATING_VOLTAGE': 3, '0.UNREACH': false, '1.STATE': 0 }
    })
    contact = findService(sim.accessory, Service.ContactSensor)
  })

  after(() => sim.shutdown())

  const readError = async (characteristic) => {
    try {
      await read(characteristic)
    } catch (e) {
      return e
    }
    return undefined
  }

  it('answers reads while the device is reachable', async () => {
    expect(await read(contact.getCharacteristic(Characteristic.ContactSensorState))).to.be(0)
  })

  it('answers every read with a communication failure while UNREACH is set', async () => {
    sim.fire('0.UNREACH', true)
    await settle()
    for (const characteristic of [contact.getCharacteristic(Characteristic.ContactSensorState),
      findService(sim.accessory, Service.Battery).getCharacteristic(Characteristic.BatteryLevel)]) {
      const error = await readError(characteristic)
      expect(error).to.be(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  })

  it('keeps the accessory information readable', async () => {
    const info = sim.accessory.homeKitAccessory.getService(Service.AccessoryInformation)
    expect(await read(info.getCharacteristic(Characteristic.Manufacturer))).to.be('eQ-3')
  })

  it('answers again once the device is back', async () => {
    sim.fire('0.UNREACH', false)
    await settle()
    expect(await read(contact.getCharacteristic(Characteristic.ContactSensorState))).to.be(0)
  })
})
