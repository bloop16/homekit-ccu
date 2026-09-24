/*
 * File: HomeMaticMotionAccessory.js
 * Project: homekit-ccu
 * File Created: Friday, 13th March 2020 5:18:43 pm
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

// HAP CurrentAmbientLightLevel accepts 0.0001 to 100000 lx; darkness (0 lx) is reported as the minimum
const MIN_LUX = 0.0001
const MAX_LUX = 100000

function lightLevel (value) {
  const lux = parseFloat(value)
  if (!Number.isFinite(lux)) {
    return MIN_LUX
  }
  return Math.min(MAX_LUX, Math.max(MIN_LUX, lux))
}

class HomeMaticMotionAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    const settings = this.getDeviceSettings()
    this.ignoreLightSensor = settings.ignore_lightsensor || false

    if (this.getDataPointNameFromSettings('motion', null)) {
      this.motionSensor = this.addService(new Service.MotionSensor(this._name, 'Motion'))

      this.addStatusActive(this.motionSensor, Characteristic)

      this.motionDetected = this.motionSensor.getCharacteristic(Characteristic.MotionDetected)
        .on('get', (callback) => {
          self.getValueForDataPointNameWithSettingsKey('motion', null, false).then((value) => {
            if (callback) callback(null, self.isTrue(value))
          }).catch(() => {
            if (callback) callback(null, self.motionDetected.value === true)
          })
        })

      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('motion', null, (newValue) => {
        self.motionDetected.updateValue(self.isTrue(newValue), null)
        self.addLogEntry({
          status: self.isTrue(newValue) ? 1 : 0
        })

        if (self.isTrue(newValue)) {
          self.updateLastActivation()
        }

        self.initialQuery = false
        self.lastValue = newValue
      })

      // Enable all Eve Logging Services for this device
      this.enableLoggingService('motion', false)
    }

    // Add a Brightness Sensor if the device haze one
    if ((this.getDataPointNameFromSettings('illumination', null) !== undefined) && (!this.ignoreLightSensor)) {
      this.illuminationSensor = this.addService(new Service.LightSensor(this._name + ' Illumination', 'Illumination'))

      this.illuminationLevel = this.illuminationSensor.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
        .on('get', (callback) => {
          self.getValueForDataPointNameWithSettingsKey('illumination', null, false).then((value) => {
            if (callback) callback(null, lightLevel(value))
          }).catch(() => {
            if (callback) callback(null, self.illuminationLevel.value)
          })
        })
      this.illuminationLevel.updateValue(MIN_LUX, null)

      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('illumination', null, (newValue) => {
        self.illuminationLevel.updateValue(lightLevel(newValue), null)
      })
      if (this.motionSensor) {
        this.motionSensor.addLinkedService(this.illuminationSensor)
      }
    }
    if (this.motionSensor) {
      this.motionSensor.setPrimaryService()
    }
    // enable the last Opened Service
    this.addLastActivationService(this.motionSensor)
    this.addTamperedCharacteristic(this.motionSensor)
    // adds the battery service only if the device reports LOWBAT / LOW_BAT
    this.addLowBatCharacteristic()
  }

  // StatusActive follows the detection switch of the device (MOTION_DETECTION_ACTIVE) where there is one
  addStatusActive (service, Characteristic) {
    const self = this
    const activeDatapoint = this.getDataPointNameFromSettings('active', null)
    const isActive = (value) => ((value === undefined) || (value === null) || (value === '')) ? true : self.isTrue(value)
    const active = service.getCharacteristic(Characteristic.StatusActive)
      .on('get', (callback) => {
        if (!activeDatapoint) {
          callback(null, true)
          return
        }
        self.getValueForDataPointNameWithSettingsKey('active', null, false)
          .then(value => callback(null, isActive(value)))
          .catch(() => callback(null, true))
      })
    active.updateValue(true, null)
    if (activeDatapoint) {
      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('active', null, (newValue) => {
        active.updateValue(isActive(newValue), null)
      })
    }
  }

  initServiceSettings () {
    return {
      '*': {
        motion: 'MOTION',
        illumination: 'BRIGHTNESS'
      },
      TILT_SENSOR: {
        motion: 'STATE'
      }
    }
  }

  static channelTypes () {
    return ['MOTION_DETECTOR', 'TILT_SENSOR']
  }

  static configurationItems () {
    return {
      ignore_lightsensor: {
        type: 'checkbox',
        default: false,
        label: 'No Illumination sensor',
        hint: ''
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a motion sensor in HomeKit'
  }
}

module.exports = HomeMaticMotionAccessory
