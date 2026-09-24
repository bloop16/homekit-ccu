/*
 * File: HomeMaticIPCO2Accessory.js
 * Project: homekit-ccu
 * File Created: Tuesday, 2nd March 2021 8:46:09 pm
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

// Apple Home reports "CO2 abnormal" above this concentration (ppm)
const DEFAULT_CO2_ABNORMAL_LEVEL = 2000

module.exports = class HomeMaticIPCO2Accessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    this.debugLog('launching Service')
    this.temperatureSensor = this.getService(Service.TemperatureSensor)
    this.enableLoggingService('room')
    this.currentTemperature = -255
    this.currentHumidity = -255
    this.currentCO2 = 0

    const active = this.temperatureSensor.getCharacteristic(Characteristic.StatusActive)
      .on('get', (callback) => {
        callback(null, 1)
      })
    active.updateValue(true, null)

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

    const EveHomeKitRoomTypes = require(path.join(__dirname, 'EveRoom.js'))
    const eveRoom = new EveHomeKitRoomTypes(this.gatoHomeBridge.hap)

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
        self.currentCO2 = numberOr(parseInt(await self.readDatapoint('CO2')), self.currentCO2)
        callback(null, self.currentCO2)
      })

    // Apple Home shows the concentration only for a carbon dioxide sensor
    const abnormalLevel = parseFloat(this.getDeviceSettings().co2AbnormalLevel)
    this.co2AbnormalLevel = (abnormalLevel > 0) ? abnormalLevel : DEFAULT_CO2_ABNORMAL_LEVEL
    this.carbonDioxideSensor = this.getService(Service.CarbonDioxideSensor, this._name + ' CO2', false, 'CO2')
    this.carbonDioxideSensor.setPrimaryService(true)
    this.co2Detected = this.carbonDioxideSensor.getCharacteristic(Characteristic.CarbonDioxideDetected)
      .on('get', async (callback) => {
        self.currentCO2 = numberOr(parseInt(await self.readDatapoint('CO2')), self.currentCO2)
        callback(null, self.getCO2Detected())
      })
    this.co2SensorLevel = this.carbonDioxideSensor.getCharacteristic(Characteristic.CarbonDioxideLevel)
      .on('get', async (callback) => {
        self.currentCO2 = numberOr(parseInt(await self.readDatapoint('CO2')), self.currentCO2)
        callback(null, self.currentCO2)
      })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('CO2', null, (newValue) => {
      self.debugLog('CO2 event %s', newValue)
      const co2 = numberOr(parseInt(newValue), undefined)
      if (co2 === undefined) {
        return
      }
      self.currentCO2 = co2
      self.updateCharacteristic(self.co2Level, self.currentCO2)
      self.updateCharacteristic(self.eveAQX1, self.currentCO2)
      self.updateCharacteristic(self.airQuality, self.getAirQuality())
      self.updateCharacteristic(self.co2SensorLevel, self.currentCO2)
      self.updateCharacteristic(self.co2Detected, self.getCO2Detected())
      self.addHistory()
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

    this.c = Characteristic.CarbonDioxideDetected
    this.Characteristic = Characteristic
    this.addLowBatCharacteristic()
    this.queryData()
  }

  getCO2Detected () {
    return (this.currentCO2 > this.co2AbnormalLevel)
      ? this.Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL
      : this.Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL
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
    this.readDatapoint('Temperature')
    this.readDatapoint('Humidity')
    this.readDatapoint('CO2')
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
    return ['CARBON_DIOXIDE_RECEIVER']
  }

  initServiceSettings () {
    return {
      CARBON_DIOXIDE_RECEIVER: {
        Temperature: { name: '4.ACTUAL_TEMPERATURE' },
        Humidity: { name: '4.HUMIDITY' },
        CO2: { name: '1.CONCENTRATION' }
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a temperature and a co2 sensor in HomeKit'
  }

  // co2AbnormalLevel (ppm) is read from the settings but not offered in the UI yet (it needs a localization)
  static configurationItems () {
    return {}
  }
}
