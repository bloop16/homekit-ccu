'use strict'

// A read of the low battery state that fails at Rega left HomeKit without any answer:
// the async handler rejected before it called back, so the device showed "No Response".

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const HomeMaticAccessory = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticAccessory.js'))

function accessoryWithFailingRega (datapoint) {
  const accessory = Object.create(HomeMaticAccessory.prototype)
  const battery = new Service.Battery('Battery')
  accessory.getService = () => battery
  accessory.debugLog = () => {}
  accessory.isTrue = (value) => value === true || value === 'true'
  accessory.buildAddress = (address) => address
  accessory.registerAddressForEventProcessingAtAccessory = () => {}
  accessory._ccu = { hazDatapoint: async (address) => address === '0.' + datapoint }
  accessory.getValue = () => Promise.reject(new Error('socket hang up'))
  return { accessory, battery }
}

describe('HomeKit-CCU low battery read', () => {
  ;['LOWBAT', 'LOW_BAT'].forEach(datapoint => {
    it('answers with the last known state when reading ' + datapoint + ' fails', async () => {
      const { accessory, battery } = accessoryWithFailingRega(datapoint)
      await accessory.addHMLowBatCharacteristic(0)
      const value = await battery.getCharacteristic(Characteristic.StatusLowBattery).handleGetRequest()
      expect(value).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
    })
  })
})
