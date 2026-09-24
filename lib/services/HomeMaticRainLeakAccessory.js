/*
 * File: HomeMaticRainLeakAccessory.js
 * Project: homekit-ccu
 * -----
 * HM-Sen-RD-O rain sensor (channel 1 RAINDETECTOR) as a HomeKit leak sensor: rain is reported as
 * a detected leak, so Apple Home can notify and trigger automations like for water sensors.
 *   STATE ENUM DRY(0) RAIN(1) -> LeakDetected
 * HomeMaticRainDetectorAccessory keeps the older humidity sensor mapping (0 / 100 %) for
 * existing installations.
 * ==========================================================================
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { Characteristic } = require('@homebridge/hap-nodejs')

class HomeMaticRainLeakAccessory extends HomeMaticAccessory {
  publishServices (Service) {
    const self = this
    this.raining = false

    const sensor = this.getService(Service.LeakSensor)
    this.leak = sensor.getCharacteristic(Characteristic.LeakDetected)
      .on('get', async (callback) => {
        try {
          const rain = self.parseRain(await self.getValue('STATE', true))
          if (rain !== undefined) {
            self.raining = rain
          }
        } catch (e) {
          self.debugLog('unable to read STATE: %s', e.message || e)
        }
        callback(null, self.hkLeak())
      })

    sensor.getCharacteristic(Characteristic.StatusActive)
      .on('get', (callback) => callback(null, true))
      .updateValue(true)

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('STATE'), (newValue) => {
      const rain = self.parseRain(newValue)
      if (rain === undefined) {
        return
      }
      self.raining = rain
      self.updateCharacteristic(self.leak, self.hkLeak())
    })
  }

  // true for RAIN, false for DRY, undefined for a value that says nothing
  parseRain (value) {
    if ((value === undefined) || (value === null) || (value === '')) {
      return undefined
    }
    if ((value === 'RAIN') || (value === 'DRY')) {
      return value === 'RAIN'
    }
    return this.isTrue(value)
  }

  hkLeak () {
    return this.raining
      ? Characteristic.LeakDetected.LEAK_DETECTED
      : Characteristic.LeakDetected.LEAK_NOT_DETECTED
  }

  static channelTypes () {
    return ['RAINDETECTOR']
  }

  static serviceDescription () {
    return 'This service provides a leak sensor in HomeKit that reports rain'
  }
}

module.exports = HomeMaticRainLeakAccessory
