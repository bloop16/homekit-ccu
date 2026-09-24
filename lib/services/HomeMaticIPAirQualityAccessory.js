/*
 * File: HomeMaticIPAirQualityAccessory.js
 * Project: homekit-ccu
 * -----
 * HmIP-SFD particulate matter sensor (channel 1 TEMP_HUMIDITY_PARTICULATE_MATTER_TRANSMITTER) as
 * one HomeKit accessory with an air quality sensor (primary), a thermometer and a hygrometer.
 *   MASS_CONCENTRATION_PM_2_5 (µg/m³) -> PM2_5Density and AirQuality
 *   MASS_CONCENTRATION_PM_10  (µg/m³) -> PM10Density
 *   ACTUAL_TEMPERATURE (°C)          -> CurrentTemperature
 *   HUMIDITY (%)                     -> CurrentRelativeHumidity
 * AirQuality follows the PM2.5 bands of the European Air Quality Index (WHO based):
 *   <= 10 excellent, <= 20 good, <= 25 fair, <= 50 inferior, above poor.
 * StatusFault from the sensor errors of the maintenance channel.
 * ==========================================================================
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { Characteristic } = require('@homebridge/hap-nodejs')
const { numberOr, clamp, addFaultSources } = require(path.join(__dirname, 'NativeSupport.js'))

// upper PM2.5 limits (µg/m³) of EXCELLENT, GOOD, FAIR and INFERIOR; above is POOR
const PM25_BANDS = [
  [10, Characteristic.AirQuality.EXCELLENT],
  [20, Characteristic.AirQuality.GOOD],
  [25, Characteristic.AirQuality.FAIR],
  [50, Characteristic.AirQuality.INFERIOR]
]
// HomeKit density range
const MAX_DENSITY = 1000
const PM_FAULTS = ['0.ERROR_PARTICULATE_MATTER_MEASUREMENT', '0.ERROR_COMMUNICATION_PARTICULATE_MATTER_SENSOR']
const CLIMATE_FAULTS = ['0.ERROR_TEMP_OR_HUMIDITY_MEASUREMENT', '0.ERROR_COMMUNICATION_TEMP_AND_HUMIDITY_SENSOR']

/** HomeKit AirQuality for a PM2.5 concentration; UNKNOWN without a valid value */
function airQualityForPM25 (pm25) {
  if ((pm25 === undefined) || (pm25 < 0)) {
    return Characteristic.AirQuality.UNKNOWN
  }
  const band = PM25_BANDS.find(([limit]) => pm25 <= limit)
  return band ? band[1] : Characteristic.AirQuality.POOR
}

class HomeMaticIPAirQualityAccessory extends HomeMaticAccessory {
  publishServices (Service) {
    const self = this
    this.pm25 = undefined

    const air = this.getService(Service.AirQualitySensor)
    air.setPrimaryService()

    this.airQuality = air.getCharacteristic(Characteristic.AirQuality)
      .on('get', async (callback) => {
        const pm25 = await self.readNumber('MASS_CONCENTRATION_PM_2_5')
        if (pm25 !== undefined) {
          self.pm25 = pm25
        }
        callback(null, airQualityForPM25(self.pm25))
      })

    this.pm25Density = this.addDensity(air, Characteristic.PM2_5Density, 'MASS_CONCENTRATION_PM_2_5', (value) => {
      self.pm25 = value
      self.updateCharacteristic(self.airQuality, airQualityForPM25(value))
    })
    this.pm10Density = this.addDensity(air, Characteristic.PM10Density, 'MASS_CONCENTRATION_PM_10')

    const thermometer = this.getService(Service.TemperatureSensor)
    this.temperature = this.addReading(thermometer.getCharacteristic(Characteristic.CurrentTemperature), 'ACTUAL_TEMPERATURE')
    const hygrometer = this.getService(Service.HumiditySensor)
    this.humidity = this.addReading(hygrometer.getCharacteristic(Characteristic.CurrentRelativeHumidity), 'HUMIDITY')

    addFaultSources(this, air, PM_FAULTS)
    addFaultSources(this, thermometer, CLIMATE_FAULTS)
    addFaultSources(this, hygrometer, CLIMATE_FAULTS)
  }

  async readNumber (datapoint) {
    try {
      return numberOr(await this.getValue(datapoint, true), undefined)
    } catch (e) {
      this.debugLog('unable to read %s: %s', datapoint, e.message || e)
      return undefined
    }
  }

  // a PM density characteristic (0..1000 µg/m³) fed by datapoint
  addDensity (service, type, datapoint, onValue) {
    const self = this
    const characteristic = service.getCharacteristic(type)
      .on('get', async (callback) => {
        const value = await self.readNumber(datapoint)
        callback(null, (value === undefined) ? characteristic.value : clamp(value, 0, MAX_DENSITY))
      })
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress(datapoint), (newValue) => {
      const value = numberOr(newValue, undefined)
      if (value === undefined) {
        return
      }
      self.updateCharacteristic(characteristic, clamp(value, 0, MAX_DENSITY))
      if (onValue) {
        onValue(value)
      }
    })
    return characteristic
  }

  // a temperature or humidity characteristic fed by datapoint, kept inside its HomeKit range
  addReading (characteristic, datapoint) {
    const self = this
    const limit = (value) => clamp(value, characteristic.props.minValue, characteristic.props.maxValue)
    characteristic.on('get', async (callback) => {
      const value = await self.readNumber(datapoint)
      callback(null, (value === undefined) ? characteristic.value : limit(value))
    })
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress(datapoint), (newValue) => {
      const value = numberOr(newValue, undefined)
      if (value !== undefined) {
        self.updateCharacteristic(characteristic, limit(value))
      }
    })
    return characteristic
  }

  static channelTypes () {
    return ['TEMP_HUMIDITY_PARTICULATE_MATTER_TRANSMITTER']
  }

  static serviceDescription () {
    return 'This service provides an air quality sensor with temperature and humidity in HomeKit'
  }
}

HomeMaticIPAirQualityAccessory.airQualityForPM25 = airQualityForPM25

module.exports = HomeMaticIPAirQualityAccessory
