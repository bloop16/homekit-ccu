/*
 * File: HomeMaticCO2TrafficLightAccessory.js
 * Project: homekit-ccu
 * -----
 * HM-CC-SCD CO2 traffic light (channel 1 SENSOR_FOR_CARBON_DIOXIDE) as a HomeKit carbon dioxide
 * sensor (primary) and an air quality sensor. The device reports three levels, no ppm value:
 *   STATE ENUM LEVEL_NORMAL(0) LEVEL_ADDED(1) LEVEL_ADDED_STRONG(2)
 *   -> AirQuality GOOD / FAIR / POOR, CarbonDioxideDetected abnormal at LEVEL_ADDED_STRONG
 * ==========================================================================
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { Characteristic } = require('@homebridge/hap-nodejs')

const LEVEL_NORMAL = 0
const LEVEL_ADDED = 1
const LEVEL_ADDED_STRONG = 2

class HomeMaticCO2TrafficLightAccessory extends HomeMaticAccessory {
  publishServices (Service) {
    const self = this
    this.level = undefined

    const co2 = this.getService(Service.CarbonDioxideSensor)
    co2.setPrimaryService()
    this.detected = co2.getCharacteristic(Characteristic.CarbonDioxideDetected)
      .on('get', async (callback) => {
        await self.fetchLevel()
        callback(null, self.hkDetected())
      })

    const air = this.getService(Service.AirQualitySensor)
    this.airQuality = air.getCharacteristic(Characteristic.AirQuality)
      .on('get', async (callback) => {
        await self.fetchLevel()
        callback(null, self.hkAirQuality())
      })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('STATE'), (newValue) => {
      const level = self.parseLevel(newValue)
      if (level === undefined) {
        return
      }
      self.level = level
      self.updateCharacteristic(self.detected, self.hkDetected())
      self.updateCharacteristic(self.airQuality, self.hkAirQuality())
    })
  }

  // 0..2, or undefined for a value that says nothing
  parseLevel (value) {
    const names = ['LEVEL_NORMAL', 'LEVEL_ADDED', 'LEVEL_ADDED_STRONG']
    const level = names.includes(value) ? names.indexOf(value) : parseInt(value)
    return ((level >= LEVEL_NORMAL) && (level <= LEVEL_ADDED_STRONG)) ? level : undefined
  }

  async fetchLevel () {
    try {
      const level = this.parseLevel(await this.getValue('STATE', true))
      if (level !== undefined) {
        this.level = level
      }
    } catch (e) {
      this.debugLog('unable to read STATE: %s', e.message || e)
    }
    return this.level
  }

  hkDetected () {
    return (this.level === LEVEL_ADDED_STRONG)
      ? Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL
      : Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL
  }

  hkAirQuality () {
    switch (this.level) {
      case LEVEL_NORMAL:
        return Characteristic.AirQuality.GOOD
      case LEVEL_ADDED:
        return Characteristic.AirQuality.FAIR
      case LEVEL_ADDED_STRONG:
        return Characteristic.AirQuality.POOR
      default:
        return Characteristic.AirQuality.UNKNOWN
    }
  }

  static channelTypes () {
    return ['SENSOR_FOR_CARBON_DIOXIDE']
  }

  static serviceDescription () {
    return 'This service provides a carbon dioxide and air quality sensor in HomeKit for the CO2 traffic light'
  }
}

module.exports = HomeMaticCO2TrafficLightAccessory
