/*
 * File: HomeMaticWeatherStationAccessory.js
 * Project: homekit-ccu
 * File Created: Sunday, 5th April 2020 6:55:06 pm
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
const EveHomeKitWeatherTypes = require(path.join(__dirname, 'EveWeather.js'))
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))

// HAP CurrentAmbientLightLevel accepts 0.0001 to 100000 lx; darkness (0 lx) is reported as the minimum
const MIN_LUX = 0.0001
const MAX_LUX = 100000

// the number in value or fallback when the CCU has no (valid) value yet
function numberOr (value, fallback) {
  const number = parseFloat(value)
  return Number.isFinite(number) ? number : fallback
}

function lightLevel (value, fallback = MIN_LUX) {
  return Math.min(MAX_LUX, Math.max(MIN_LUX, numberOr(value, fallback)))
}

class HomeMaticWeatherStationAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    // create characteristics
    const self = this
    let weatherStation
    this.applHome = (this._server.getConfig('disableHistory') === true)
    this.eveWeatherProg = new EveHomeKitWeatherTypes(this.gatoHomeBridge.hap)
    // create all optinal Characteristics
    if (!this.applHome) {
      this.debugLog('Using Eve Mode')
      weatherStation = this.getService(this.eveWeatherProg.Service.EveWeather)
      this.enableLoggingService('weather', false)
    } else {
      this.debugLog('Using AppleHome Mode')
      weatherStation = this.getService(new Service.TemperatureSensor(this._name))
      weatherStation.addOptionalCharacteristic(Characteristic.CurrentRelativeHumidity)
    }

    this.currentTemperature = -255
    this.currentHumidity = -255
    this.currentPressure = -255
    // temperature sensor
    if (this.getDataPointNameFromSettings('Temperature', null)) {
      this.currentTemperatureCharacteristic = weatherStation.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -100 })
        .on('get', async (callback) => {
          const value = await self.readDatapoint('Temperature')
          self.debugLog('getCurrentTemperature result %s', value)
          if (callback) callback(null, numberOr(value, self.currentTemperatureCharacteristic.value))
        })

      this.currentTemperatureCharacteristic.eventEnabled = true

      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('Temperature', null, (newValue) => {
        const temperature = numberOr(newValue, undefined)
        if (temperature === undefined) {
          return
        }
        self.currentTemperature = temperature
        self.currentTemperatureCharacteristic.updateValue(temperature, null)
        if (!self.applHome) {
          self.addLogginEntry()
        }
      })
    } else {
      this.debugLog('no temp sensor %s')
      this.currentTemperature = 0
    }

    // humidity sensor
    if (this.getDataPointNameFromSettings('Humidity', null)) {
      if (!this.applHome) {
        this.currentHumidityCharacteristic = weatherStation.getCharacteristic(Characteristic.CurrentRelativeHumidity)
      } else {
        // Create a new Sensor
        const humSensor = this.addService(new Service.HumiditySensor(this._name))
        this.currentHumidityCharacteristic = humSensor.getCharacteristic(Characteristic.CurrentRelativeHumidity)
      }

      this.currentHumidityCharacteristic.on('get', async (callback) => {
        const value = await self.readDatapoint('Humidity')
        self.debugLog('getCurrentRelativeHumidity result %s', value)
        const humidity = numberOr(value, self.currentHumidityCharacteristic.value)
        if (callback) callback(null, humidity)
      })

      this.currentHumidityCharacteristic.eventEnabled = true

      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('Humidity', null, (newValue) => {
        const humidity = numberOr(newValue, undefined)
        if (humidity === undefined) {
          return
        }
        self.currentHumidity = humidity
        self.currentHumidityCharacteristic.updateValue(humidity, null)
        if (!self.applHome) {
          self.addLogginEntry()
        }
      })
    } else {
      this.currentHumidity = 0
    }

    if (!this.applHome) {
      this.debugLog('adding Brightness sensor to eve weather station')
      this.addSensor('Brightness', weatherStation, 'Brightness', Characteristic.CurrentAmbientLightLevel, null, (vl, last) => lightLevel(vl, last))
    } else {
      this.debugLog('adding Brightness sensor to Home LightSensor')
      const lightSensor = this.addService(new Service.LightSensor(this._name))
      this.addSensor('Brightness', lightSensor, 'Brightness', Characteristic.CurrentAmbientLightLevel, null, (vl, last) => lightLevel(vl, last))
      lightSensor.getCharacteristic(Characteristic.StatusActive).on('get', callback => { callback(null, true) })
    }

    // use all the optional stuff if the user not wants an appl home device
    if (!this.applHome) {
      // pressure sensor
      if (this.getDataPointNameFromSettings('AirPressure', null)) {
        this.currentPressureCharacteristic = weatherStation.getCharacteristic(this.eveWeatherProg.Characteristic.AirPressure)
          .on('get', async (callback) => {
            const value = await self.readDatapoint('AirPressure')
            if (callback) callback(null, numberOr(value, self.currentPressureCharacteristic.value))
          })

        this.currentPressureCharacteristic.eventEnabled = true

        this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('AirPressure', null, (newValue) => {
          const pressure = numberOr(newValue, undefined)
          if (pressure === undefined) {
            return
          }
          self.currentPressure = pressure
          self.currentPressureCharacteristic.updateValue(pressure, null)
          self.addLogginEntry()
        })
      } else {
        this.currentPressure = 0
      }

      // SunShineDuration sensor
      if (this.getDataPointNameFromSettings('SunShineDuration', null)) {
        const setg = self.deviceServiceSettings('SunShineDuration', null)
        this.currentSunshineCharacteristic = weatherStation.getCharacteristic(this.eveWeatherProg.Characteristic.SunShineDuration)
          .on('get', async (callback) => {
            const minutes = await self.readSettingsValue('SunShineDuration', setg)
            // the CCU counts minutes, Eve shows hours
            const duration = numberOr(minutes, undefined)
            if (callback) callback(null, (duration === undefined) ? self.currentSunshineCharacteristic.value : parseFloat((duration / 60).toFixed(2)))
          })

        this.currentSunshineCharacteristic.eventEnabled = true
      }

      if (this.getDataPointNameFromSettings('Raincount', null)) {
        const setg = self.deviceServiceSettings('Raincount', null)
        this.currentRainCountCharacteristic = weatherStation.getCharacteristic(this.eveWeatherProg.Characteristic.RainDay)
          .on('get', async (callback) => {
            const rCount = numberOr(await self.readSettingsValue('Raincount', setg), undefined)
            if (callback) callback(null, (rCount === undefined) ? self.currentRainCountCharacteristic.value : parseFloat(rCount.toFixed(2)))
          })

        this.currentRainCountCharacteristic.eventEnabled = true

        // a system variable (HmIP) is read on request; a datapoint also sends events
        if (!((setg) && (setg.type === 'Variable'))) {
          this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('Raincount', null, (newValue) => {
            const rCount = numberOr(newValue, undefined)
            if (rCount !== undefined) {
              self.updateCharacteristic(self.currentRainCountCharacteristic, rCount)
            }
          })
        }
      }

      this.addSensor('Rain', weatherStation, 'RainBool', this.eveWeatherProg.Characteristic.RainBool, null, (vl) => { return self.isTrue(vl) })
      this.addSensor('Windspeed', weatherStation, '', this.eveWeatherProg.Characteristic.WindSpeed, null, (vl, last) => numberOr(parseInt(vl), last))
      this.addSensor('Winddirection', weatherStation, 'Wind direction', this.eveWeatherProg.Characteristic.WindDirection, null, (degree) => {
        return self.getWindDirection(degree)
      })
      this.addSensor('Windrange', weatherStation, 'Wind range', this.eveWeatherProg.Characteristic.Windrange, null, (vl, last) => numberOr(parseInt(vl), last))
    }

    // SWO-B, SWO-PL and SWO-PR run on batteries (LOW_BAT); nothing is added for devices without
    this.addLowBatCharacteristic()
  }

  // reads a datapoint named in the service settings; undefined when the CCU does not answer
  async readDatapoint (settingsKey) {
    try {
      return await this.getValueForDataPointNameWithSettingsKey(settingsKey, null, true)
    } catch (e) {
      this.debugLog('unable to read %s: %s', settingsKey, e.message || e)
      return undefined
    }
  }

  // HmIP weather sensors keep daily counters in system variables named <prefix><channel id>
  async readSettingsValue (settingsKey, setting) {
    if ((setting) && (setting.type === 'Variable')) {
      const varName = this.getDataPointNameFromSettings(settingsKey, null) + this._ccuChannelId
      try {
        return await this._ccu.getVariableValue(varName)
      } catch (e) {
        this.debugLog('unable to read variable %s: %s', varName, e.message || e)
        return undefined
      }
    }
    return this.readDatapoint(settingsKey)
  }

  addSensor (configName, service, ServiceName, ServiceCharacteristics, remoteValueCallBack, converter) {
    const self = this
    this.debugLog('adding %s Sensor', configName)
    if (this.getDataPointNameFromSettings(configName, null)) {
      const currentCharacteristic = service.getCharacteristic(ServiceCharacteristics)
        .on('get', async (callback) => {
          self.debugLog('homekit get %s', configName)
          let value = await self.readDatapoint(configName)
          self.debugLog('homekit get %s result is %s', configName, value)
          if (converter) {
            value = converter(value, currentCharacteristic.value)
          } else {
            value = numberOr(value, currentCharacteristic.value)
          }
          self.debugLog('get %s converged value is % this will be sent to homekit', configName, value)
          if (callback) {
            callback(null, value)
          }
        })

      currentCharacteristic.eventEnabled = true

      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory(configName, null, (newValue) => {
        self.debugLog('homekit event for %s with value %s', configName, newValue)
        if (converter) {
          newValue = converter(newValue, currentCharacteristic.value)
        } else {
          newValue = numberOr(newValue, currentCharacteristic.value)
        }
        self.debugLog('homekit event for %s converged value is %s', configName, newValue)
        self.updateCharacteristic(currentCharacteristic, newValue)
        if (remoteValueCallBack) {
          remoteValueCallBack(parseFloat(newValue))
        }
      })
    }
  }

  getWindDirection (degree) {
    this.log.debug('[WST] convert %s', degree)
    if (degree === undefined) {
      return 'Unknown'
    }

    if (typeof degree !== 'string') {
      degree = parseInt(degree)
    }

    const cat = Math.round(degree % 360 / 22.5)
    let dir

    // TODO multilanguage
    switch (cat) {
      case 0:
        dir = 'N'
        break
      case 1:
        dir = 'NNE'
        break
      case 2:
        dir = 'NE'
        break
      case 3:
        dir = 'ENE'
        break
      case 4:
        dir = 'E'
        break
      case 5:
        dir = 'ESE'
        break
      case 6:
        dir = 'SE'
        break
      case 7:
        dir = 'SSE'
        break
      case 8:
        dir = 'S'
        break
      case 9:
        dir = 'SSW'
        break
      case 10:
        dir = 'SW'
        break
      case 11:
        dir = 'WSW'
        break
      case 12:
        dir = 'W'
        break
      case 13:
        dir = 'WNW'
        break
      case 14:
        dir = 'NW'
        break
      case 15:
        dir = 'NNW'
        break
      case 16:
        dir = 'N'
        break
      default:
        dir = 'Variable'
    }
    return dir
  }

  addLogginEntry () {
    if ((this.currentTemperature > -255) && (this.currentHumidity > -255) && (this.currentPressure > -255)) {
      this.log.debug('[WST] write log %s %s %s', this.currentTemperature, this.currentPressure, this.currentHumidity)
      this.addLogEntry({ temp: this.currentTemperature, pressure: this.currentPressure, humidity: this.currentHumidity })
    } else {
      this.log.debug('[WST] ignore log %s %s %s', this.currentTemperature, this.currentPressure, this.currentHumidity)
    }
  }

  static channelTypes () {
    return ['HB-UNI-Sen-WEA:WEATHER',
      'KS550:WEATHER',
      'HmIP-SWO-B:WEATHER_TRANSMIT',
      'HmIP-SWO-PR:WEATHER_TRANSMIT',
      'HmIP-SWO-PL:WEATHER_TRANSMIT'
    ]
  }

  initServiceSettings () {
    return {
      'HB-UNI-Sen-WEA': {
        Temperature: { name: 'TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' },
        AirPressure: { name: 'AIR_PRESSURE' },
        Brightness: { name: 'LUX' },
        Raincount: { name: 'RAIN_COUNTER' },
        Windspeed: { name: 'WIND_SPEED' },
        Winddirection: { name: 'WIND_DIRECTION' },
        Windrange: { name: 'WIND_DIRECTION_RANGE' }
      },
      KS550: {
        Temperature: { name: 'TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' },
        Brightness: { name: 'BRIGHTNESS' },
        Raincount: { name: 'RAIN_COUNTER' },
        Rain: { name: 'RAINING' },
        Windspeed: { name: 'WIND_SPEED' },
        Winddirection: { name: 'WIND_DIRECTION' },
        Windrange: { name: 'WIND_DIRECTION_RANGE' }
      },
      'HmIP-SWO-B': {
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' },
        Brightness: { name: 'ILLUMINATION' },
        SunShineDuration: { name: 'svHmIPSunshineCounterToday_', type: 'Variable' },
        Windspeed: { name: 'WIND_SPEED' }
      },
      'HmIP-SWO-PR': {
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' },
        Brightness: { name: 'ILLUMINATION' },
        Raincount: { name: 'svHmIPRainCounterToday_', type: 'Variable' },
        Rain: { name: 'RAINING' },
        SunShineDuration: { name: 'svHmIPSunshineCounterToday_', type: 'Variable' },
        Winddirection: { name: 'WIND_DIR' },
        Windspeed: { name: 'WIND_SPEED' },
        Windrange: { name: 'WIND_DIR_RANGE' }
      },
      'HmIP-SWO-PL': {
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' },
        Brightness: { name: 'ILLUMINATION' },
        Raincount: { name: 'svHmIPRainCounterToday_', type: 'Variable' },
        Rain: { name: 'RAINING' },
        SunShineDuration: { name: 'svHmIPSunshineCounterToday_', type: 'Variable' },
        Winddirection: { name: 'WIND_DIR' },
        Windspeed: { name: 'WIND_SPEED' }
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a weather station for HomeKit'
  }

  static validate (configurationItem) {
    return false
  }
}

module.exports = HomeMaticWeatherStationAccessory
