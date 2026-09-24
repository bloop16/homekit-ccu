/*
 * File: HomeMaticThermometerAccessory.js
 * Project: homekit-ccu
 * File Created: Sunday, 8th March 2020 3:14:23 pm
 * Author: Thomas Kluge (th.kluge@me.com)
 * -----
 * The MIT License (MIT)
 *
 * Copyright (c) Thomas Kluge <th.kluge@me.com> (https://github.com/thkl)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * ==========================================================================
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))

// the number in value or fallback when the CCU has no (valid) value yet
function numberOr (value, fallback) {
  const number = parseFloat(value)
  return Number.isFinite(number) ? number : fallback
}

class HomeMaticThermometerAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    this.debugLog('launching Service')
    this.temperatureSensor = this.getService(Service.TemperatureSensor)
    this.temperatureSensor.setPrimaryService(true)
    this.enableLoggingService('room')
    this.currentTemperature = -255
    this.currentHumidity = -255
    this.currentCO2 = 0
    const settings = this.getDeviceSettings()
    this.ignoreTemp = settings.IgnoreTempMeasurement || false
    this.ignoreHum = settings.IgnoreHumidiyMeasurement || false
    this.optionalCo2Sensor = settings.optionalCo2Sensor || ''

    const active = this.temperatureSensor.getCharacteristic(Characteristic.StatusActive)
      .on('get', (callback) => {
        callback(null, 1)
      })
    active.updateValue(true, null)

    if (this.ignoreTemp === false) {
      this.cctemp = this.temperatureSensor.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({
          minValue: -100
        })
        .on('get', async (callback) => {
          const value = await self.readDatapoint('Temperature')
          self.debugLog('get TEMPERATURE %s', value)
          const fval = numberOr(value, undefined)
          if (fval !== undefined) {
            self.currentTemperature = fval
            self.addHistory()
          }
          if (callback) callback(null, (fval === undefined) ? self.cctemp.value : fval)
        })

      this.cctemp.eventEnabled = true

      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('Temperature', null, (newValue) => {
        self.debugLog('TEMPERATURE event %s', newValue)
        const temperature = numberOr(newValue, undefined)
        if (temperature === undefined) {
          return
        }
        self.currentTemperature = temperature
        self.updateCharacteristic(self.cctemp, temperature)
        self.addHistory()
      })
    }

    if (this.ignoreHum === false) {
      this.humiditySensor = this.getService(Service.HumiditySensor)

      const hactive = this.humiditySensor.getCharacteristic(Characteristic.StatusActive)
        .on('get', (callback) => {
          callback(null, true)
        })
      hactive.updateValue(true, null)

      this.chum = this.humiditySensor.getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .on('get', async (callback) => {
          const humidity = numberOr(await self.readDatapoint('Humidity'), undefined)
          if (humidity !== undefined) {
            self.currentHumidity = humidity
            self.addHistory()
          }
          if (callback) callback(null, (humidity === undefined) ? self.chum.value : humidity)
        })

      this.chum.eventEnabled = true
      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('Humidity', null, (newValue) => {
        self.debugLog('HUMIDITY event %s', newValue)
        const humidity = numberOr(newValue, undefined)
        if (humidity === undefined) {
          return
        }
        self.currentHumidity = humidity
        self.updateCharacteristic(self.chum, humidity)
        self.addHistory()
      })
    }

    if (this.optionalCo2Sensor.length > 0) {
      const EveHomeKitRoomTypes = require(path.join(__dirname, 'EveRoom.js'))
      const eveRoom = new EveHomeKitRoomTypes(this.gatoHomeBridge.hap)

      this.debugLog('add optional CO2')
      const co2Sensor = this.getService(Service.AirQualitySensor)

      co2Sensor.addOptionalCharacteristic(Characteristic.CarbonDioxideLevel)
      co2Sensor.addOptionalCharacteristic(eveRoom.Characteristic.AQX1)
      co2Sensor.addOptionalCharacteristic(eveRoom.Characteristic.AQX2)

      co2Sensor.getCharacteristic(Characteristic.StatusActive)
        .on('get', (callback) => {
          callback(null, 1)
        })
        .updateValue(1, null)

      this.airQuality = co2Sensor.getCharacteristic(Characteristic.AirQuality)
        .on('get', (callback) => {
          callback(null, self.getAirQuality())
        })

      this.co2Level = co2Sensor.getCharacteristic(Characteristic.CarbonDioxideLevel)
        .on('get', async (callback) => {
          let newValue
          try {
            newValue = await self._ccu.getVariableValue(self.optionalCo2Sensor)
          } catch (e) {
            self.debugLog('unable to read variable %s: %s', self.optionalCo2Sensor, e.message || e)
          }
          self.debugLog('variable is %s value is %s', self.optionalCo2Sensor, newValue)
          self.currentCO2 = numberOr(parseInt(newValue), self.currentCO2)
          callback(null, self.currentCO2)
        })

      this.eveAQX1 = co2Sensor.getCharacteristic(eveRoom.Characteristic.AQX1)
        .on('get', (callback) => {
          callback(null, self.currentCO2)
        })
        .updateValue(self.currentCO2, null)

      this.eveAQX2 = co2Sensor.getCharacteristic(eveRoom.Characteristic.AQX2)
        .on('get', (callback) => {
          callback(null, '')
        })
        .updateValue('', null)
    }

    this.c = Characteristic.CarbonDioxideDetected
    this.addLowBatCharacteristic()
    this.addAirPressure()
    this.queryData()
  }

  // ELV-SH-CAP: AIR_PRESSURE (hPa) as the Eve air pressure of the temperature sensor; Apple Home has none
  async addAirPressure () {
    const dpn = this.getDataPointNameFromSettings('AirPressure', null)
    if ((!dpn) || (!await this._ccu.hazDatapoint(this.buildAddress(dpn)))) {
      return
    }
    const EveHomeKitWeatherTypes = require(path.join(__dirname, 'EveWeather.js'))
    const eveWeather = new EveHomeKitWeatherTypes(this.gatoHomeBridge.hap)
    this.temperatureSensor.addOptionalCharacteristic(eveWeather.Characteristic.AirPressure)
    const hPa = (value, fallback) => {
      const pressure = numberOr(value, undefined)
      return (pressure === undefined) ? fallback : Math.round(pressure)
    }
    this.airPressure = this.temperatureSensor.getCharacteristic(eveWeather.Characteristic.AirPressure)
      .on('get', async (callback) => {
        callback(null, hPa(await this.readDatapoint('AirPressure'), this.airPressure.value))
      })
    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('AirPressure', null, (newValue) => {
      const pressure = hPa(newValue, undefined)
      if (pressure !== undefined) {
        this.updateCharacteristic(this.airPressure, pressure)
      }
    })
  }

  getAirQuality () {
    let quality = this.c.AirQuality.UNKNOWN

    if (this.currentCO2 > 2100) quality = this.c.AirQuality.POOR
    else if (this.currentCO2 > 1600) quality = this.c.AirQuality.INFERIOR
    else if (this.currentCO2 > 1100) quality = this.c.AirQuality.FAIR
    else if (this.currentCO2 > 700) quality = this.c.AirQuality.GOOD
    else if (this.currentCO2 >= 300) quality = this.c.AirQuality.EXCELLENT
    return quality
  }

  addHistory () {
    if (
      ((this.currentHumidity > -255) || (this.ignoreHum === true)) &&
         ((this.currentTemperature > -255) || (this.ignoreTemp === true))
    ) {
      const entry = {
        temp: (((!this.ignoreTemp) && (!isNaN(this.currentTemperature))) ? this.currentTemperature : 0),
        ppm: (!isNaN(this.currentCO2)) ? this.currentCO2 : 0,
        humidity: (((!this.ignoreHum) && (!isNaN(this.currentHumidity))) ? this.currentHumidity : 0)
      }
      this.debugLog('adding History T:%s, H: %s, Co2: %s', entry.temp, entry.humidity, entry.ppm)
      this.addLogEntry(entry)
    }
  }

  async queryData () {
    clearTimeout(this.refreshTimer)
    const self = this
    this.debugLog('periodic measurement')
    if (this.optionalCo2Sensor.length > 0) {
      try {
        const newValue = await this._ccu.getVariableValue(this.optionalCo2Sensor)
        this.currentCO2 = numberOr(parseInt(newValue), this.currentCO2)
      } catch (e) {
        this.debugLog('unable to read variable %s: %s', this.optionalCo2Sensor, e.message || e)
      }
      this.updateCharacteristic(this.co2Level, this.currentCO2)
      this.updateCharacteristic(this.eveAQX1, this.currentCO2)
      this.updateCharacteristic(this.airQuality, this.getAirQuality())
    }
    this.readDatapoint('Temperature')
    this.readDatapoint('Humidity')
    this.refreshTimer = setTimeout(() => {
      self.queryData()
    }, 10 * 60 * 1000)
  }

  // reads a datapoint named in the service settings; undefined when the CCU does not answer
  async readDatapoint (settingsKey) {
    try {
      return await this.getValueForDataPointNameWithSettingsKey(settingsKey, null, false)
    } catch (e) {
      this.debugLog('unable to read %s: %s', settingsKey, e.message || e)
      return undefined
    }
  }

  shutdown () {
    this.debugLog('shutdown')
    super.shutdown()
    clearTimeout(this.refreshTimer)
  }

  static channelTypes () {
    return ['WEATHER',
      'CLIMATE_TRANSCEIVER',
      'HmIP-STH:HEATING_CLIMATECONTROL_TRANSCEIVER',
      'HmIP-STHD:HEATING_CLIMATECONTROL_TRANSCEIVER',
      'HmIP-WTH-2:HEATING_CLIMATECONTROL_TRANSCEIVER',
      'HmIP-WTH:HEATING_CLIMATECONTROL_TRANSCEIVER',
      'WEATHER_TRANSMIT'
    ]
  }

  initServiceSettings () {
    return {
      '*': {
        Temperature: { name: 'TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' }
      },
      CLIMATE_TRANSCEIVER: {
        voltage: 2.4,
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' },
        AirPressure: { name: 'AIR_PRESSURE' }
      },
      HEATING_CLIMATECONTROL_TRANSCEIVER: {
        voltage: 2.4,
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' }
      },
      // HmIP weather sensors (WEATHER_TRANSMIT) measure ACTUAL_TEMPERATURE
      'HmIP-SWO-B': {
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' }
      },
      'HmIP-SWO-PL': {
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' }
      },
      'HmIP-SWO-PR': {
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' }
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a temperature sensor HomeKit'
  }

  static configurationItems () {
    return {
      IgnoreTempMeasurement: {
        type: 'checkbox',
        default: false,
        label: 'Ignore temperature',
        hint: 'if your device only measures the humidity u should ignore the temperature measurements'
      },
      IgnoreHumidiyMeasurement: {
        type: 'checkbox',
        default: false,
        label: 'Ignore humidity',
        hint: 'if your device only measures the temperature u should ignore the humidity measurements'
      },
      optionalCo2Sensor: {
        type: 'text',
        label: 'opt. CO2 Sensor',
        selector: 'variables',
        hint: 'You can add an optional CO2 Sensor here. The value will be read from that variable.'
      }
    }
  }
}

module.exports = HomeMaticThermometerAccessory
