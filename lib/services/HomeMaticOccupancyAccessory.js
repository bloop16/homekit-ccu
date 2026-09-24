/*
 * File: HomeMaticOccupancyAccessory.js
 * Project: homekit-ccu
 * -----
 * HmIP-SPI / HmIPW-SPI presence detector (PRESENCEDETECTOR_TRANSCEIVER) as a native HomeKit
 * occupancy sensor (primary) with a light sensor.
 *   PRESENCE_DETECTION_STATE (BOOL)                 -> OccupancyDetected
 *   PRESENCE_DETECTION_ACTIVE (BOOL)                -> StatusActive of the occupancy sensor
 *   CURRENT_ILLUMINATION, else ILLUMINATION (lux)   -> CurrentAmbientLightLevel (0.0001..100000)
 * Tamper from SABOTAGE, battery from LOW_BAT of the maintenance channel when the device has them.
 * HomeMaticPresenceAccessory keeps the older motion sensor mapping for existing installations.
 * ==========================================================================
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { Characteristic } = require('@homebridge/hap-nodejs')
const { numberOr, clamp, addTamperIfPresent } = require(path.join(__dirname, 'NativeSupport.js'))

const MIN_LUX = 0.0001
const MAX_LUX = 100000

function luxValue (value) {
  const lux = numberOr(value, undefined)
  return (lux === undefined) ? undefined : clamp(lux, MIN_LUX, MAX_LUX)
}

class HomeMaticOccupancyAccessory extends HomeMaticAccessory {
  publishServices (Service) {
    const self = this
    this.occupied = false
    this.detectionActive = true
    this.hasCurrentIllumination = false

    const occupancy = this.getService(Service.OccupancySensor)
    occupancy.setPrimaryService()

    this.occupancy = occupancy.getCharacteristic(Characteristic.OccupancyDetected)
      .on('get', async (callback) => {
        const value = await self.read('PRESENCE_DETECTION_STATE')
        if (value !== undefined) {
          self.occupied = self.isTrue(value)
        }
        callback(null, self.hkOccupancy())
      })

    this.active = occupancy.getCharacteristic(Characteristic.StatusActive)
      .on('get', async (callback) => {
        const value = await self.read('PRESENCE_DETECTION_ACTIVE')
        if (value !== undefined) {
          self.detectionActive = self.isTrue(value)
        }
        callback(null, self.detectionActive)
      })
    this.active.updateValue(true)

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('PRESENCE_DETECTION_STATE'), (newValue) => {
      self.occupied = self.isTrue(newValue)
      self.updateCharacteristic(self.occupancy, self.hkOccupancy())
    })
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('PRESENCE_DETECTION_ACTIVE'), (newValue) => {
      self.detectionActive = self.isTrue(newValue)
      self.updateCharacteristic(self.active, self.detectionActive)
    })

    const light = this.getService(Service.LightSensor)
    this.lightLevel = light.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
      .on('get', async (callback) => {
        let lux = luxValue(await self.read('CURRENT_ILLUMINATION'))
        if (lux === undefined) {
          lux = luxValue(await self.read('ILLUMINATION'))
        }
        callback(null, (lux === undefined) ? self.lightLevel.value : lux)
      })
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('CURRENT_ILLUMINATION'), (newValue) => {
      const lux = luxValue(newValue)
      if (lux !== undefined) {
        self.hasCurrentIllumination = true
        self.updateCharacteristic(self.lightLevel, lux)
      }
    })
    // the average illumination only while the detector sends no current value
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('ILLUMINATION'), (newValue) => {
      const lux = luxValue(newValue)
      if ((lux !== undefined) && !self.hasCurrentIllumination) {
        self.updateCharacteristic(self.lightLevel, lux)
      }
    })

    addTamperIfPresent(this, occupancy)
    this.addLowBatCharacteristic(0)
  }

  hkOccupancy () {
    return this.occupied
      ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
      : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
  }

  // a datapoint value, undefined when the CCU has none
  async read (datapoint) {
    try {
      const value = await this.getValue(datapoint, true)
      return ((value === undefined) || (value === null) || (value === '')) ? undefined : value
    } catch (e) {
      this.debugLog('unable to read %s: %s', datapoint, e.message || e)
      return undefined
    }
  }

  static channelTypes () {
    return ['PRESENCEDETECTOR_TRANSCEIVER']
  }

  static serviceDescription () {
    return 'This service provides an occupancy sensor with a light sensor in HomeKit based on a ccu presence detector'
  }
}

module.exports = HomeMaticOccupancyAccessory
