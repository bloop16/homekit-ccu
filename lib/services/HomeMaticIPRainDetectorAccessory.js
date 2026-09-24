/*
 * File: HomeMaticIPRainDetectorAccessory.js
 * Project: homekit-ccu
 * File Created: Thursday, 7th January 2021 4:55:57 pm
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

class HomeMaticIPRainDetectorAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    const leakSensor = this.getService(Service.LeakSensor)
    const settings = this.getDeviceSettings()
    const ignoreTemp = settings.IgnoreTempMeasurement || false

    const active = leakSensor.getCharacteristic(Characteristic.StatusActive)
      .on('get', (callback) => {
        callback(null, true)
      })
    this.updateCharacteristic(active, true)

    this.state = leakSensor.getCharacteristic(Characteristic.LeakDetected)
      .on('get', (callback) => {
        self.getValue('RAINING', false).then(value => {
          if (callback) {
            self.debugLog('return status')
            callback(null, (self.isTrue(value) ? 1 : 0))
          }
        })
      })

    this.state.eventEnabled = true

    this.enableLoggingService('motion')
    this.addLastActivationService(leakSensor)

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('RAINING'), (newValue) => {
      self.debugLog('Rain State event %s', newValue)
      const rainDetected = (self.isTrue(newValue))
      if (rainDetected) {
        self.updateCharacteristic(self.state, 1)
        self.updateLastActivation()
        self.addLogEntry({ status: rainDetected ? 1 : 0 })
      } else {
        self.updateCharacteristic(self.state, 0)
      }
    })

    // #395
    if (ignoreTemp === false) {
      const tempSensor = this.getService(new Service.TemperatureSensor(this._name))
      this.currentTemperatureCharacteristic = tempSensor.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -100 })
        .on('get', self.guardedGet(async (callback) => {
          let value
          try {
            value = parseFloat(await self.getValue('ACTUAL_TEMPERATURE', false))
          } catch (e) {
            self.debugLog('unable to read ACTUAL_TEMPERATURE: %s', e.message || e)
          }
          self.debugLog('getCurrentTemperature result %s', value)
          // keep the last known temperature when the CCU has none
          if (callback) callback(null, Number.isFinite(value) ? value : self.currentTemperatureCharacteristic.value)
        }))

      this.registerAddressForEventProcessingAtAccessory(this.buildAddress('ACTUAL_TEMPERATURE'), (newValue) => {
        const temperature = parseFloat(newValue)
        if (Number.isFinite(temperature)) {
          self.currentTemperature = temperature
          self.updateCharacteristic(self.currentTemperatureCharacteristic, self.currentTemperature)
        }
      })
    }
  }

  static serviceDescription () {
    return 'This service provides a leak sensor in HomeKit which connects to a CCU Rain Detector'
  }

  static channelTypes () {
    return ['RAIN_DETECTION_TRANSMITTER']
  }

  static configurationItems () {
    return {
      IgnoreTempMeasurement: {
        type: 'checkbox',
        default: false,
        label: 'Ignore temperature',
        hint: ''
      }
    }
  }
}
module.exports = HomeMaticIPRainDetectorAccessory
