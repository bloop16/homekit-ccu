/*
 * File: HomeMaticIPWaterStopAccessory.js
 * Project: homekit-ccu
 * -----
 * HmIP-WSS / HmIP-WSS-GB water stop valve (channel 2 VALVE_ACTUATOR_RECEIVER) as a native HomeKit
 * valve (ValveType GENERIC_VALVE).
 *   LEVEL (0 closed .. 1 open) -> Active / InUse (open while LEVEL > 0); Active writes LEVEL 1 / 0
 * StatusFault from the error datapoints of the maintenance channel, battery from LOW_BAT.
 * ==========================================================================
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { numberOr, addFaultSources } = require(path.join(__dirname, 'NativeSupport.js'))

const FAULT_DATAPOINTS = ['0.ERROR_VALVE_FAILURE', '0.ERROR_POWER_FAILURE', '0.ERROR_MAX_WATER_FLOW', '0.ERROR_MAX_WATER_FLOW_DURATION']

class HomeMaticIPWaterStopAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    this.Characteristic = Characteristic
    this.isOpen = false

    const valve = this.getService(Service.Valve)
    valve.setPrimaryService()

    valve.getCharacteristic(Characteristic.ValveType)
      .on('get', (callback) => callback(null, Characteristic.ValveType.GENERIC_VALVE))
      .updateValue(Characteristic.ValveType.GENERIC_VALVE)

    this.active = valve.getCharacteristic(Characteristic.Active)
      .on('get', self.guardedGet(async (callback) => {
        await self.fetchLevel()
        callback(null, self.isOpen ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      }))
      .on('set', async (value, callback) => {
        const open = (parseInt(value) === Characteristic.Active.ACTIVE)
        self.debugLog('HomeKit %s the water stop', open ? 'opens' : 'closes')
        try {
          await self.setValue('LEVEL', open ? 1 : 0)
          callback()
        } catch (e) {
          self.debugLog('unable to set LEVEL: %s', e.message || e)
          callback(e)
        }
      })

    this.inUse = valve.getCharacteristic(Characteristic.InUse)
      .on('get', self.guardedGet(async (callback) => {
        await self.fetchLevel()
        callback(null, self.isOpen ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE)
      }))

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('LEVEL'), (newValue) => {
      const level = numberOr(newValue, undefined)
      if (level === undefined) {
        return
      }
      self.isOpen = level > 0
      self.updateCharacteristic(self.active, self.isOpen ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      self.updateCharacteristic(self.inUse, self.isOpen ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE)
    })

    addFaultSources(this, valve, FAULT_DATAPOINTS)
    this.addLowBatCharacteristic(0)
  }

  async fetchLevel () {
    try {
      const level = numberOr(await this.getValue('LEVEL', true), undefined)
      if (level !== undefined) {
        this.isOpen = level > 0
      }
    } catch (e) {
      this.debugLog('unable to read LEVEL: %s', e.message || e)
    }
    return this.isOpen
  }

  static channelTypes () {
    return ['VALVE_ACTUATOR_RECEIVER']
  }

  static serviceDescription () {
    return 'This service provides a water valve in HomeKit'
  }
}

module.exports = HomeMaticIPWaterStopAccessory
