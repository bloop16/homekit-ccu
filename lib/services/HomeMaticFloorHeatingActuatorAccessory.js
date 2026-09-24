/*
 * File: HomeMaticFloorHeatingActuatorAccessory.js
 * Project: homekit-ccu
 * File Created: Tuesday, 16th June 2020 8:08:42 pm
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
const EveHomeKitValveTypes = require(path.join(__dirname, 'EveValve.js'))

// LEVEL is the valve opening 0..1; anything else (no value yet, text) is not a level
function levelToPercent (value) {
  const level = (typeof value === 'number') ? value : parseFloat(value)
  return Number.isFinite(level) ? Math.round(Math.min(1, Math.max(0, level)) * 1000) / 10 : undefined
}

class HomeMaticFloorHeatingActuatorAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    const eveValve = new EveHomeKitValveTypes(this.gatoHomeBridge.hap)
    const service = this.getService(eveValve.Service.ValveService)
    const valveCharacteristic = service.getCharacteristic(eveValve.Characteristic.CurrentValveState)
      .on('get', (callback) => {
        Promise.resolve(self.getValueForDataPointNameWithSettingsKey('ValveState', null, false)).then((value) => {
          const percent = levelToPercent(value)
          callback(null, (percent !== undefined) ? percent : valveCharacteristic.value)
        }, (error) => {
          self.errorLog('unable to read the valve state: %s', error && error.message)
          callback(error)
        })
      })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('ValveState', null, (newValue) => {
      const percent = levelToPercent(newValue)
      if (percent !== undefined) {
        self.updateCharacteristic(valveCharacteristic, percent)
      }
    })
  }

  static channelTypes () {
    return ['CLIMATECONTROL_FLOOR_TRANSCEIVER']
  }

  initServiceSettings () {
    return {
      '*': {
        ValveState: { name: 'LEVEL' }
      }
    }
  }

  static configurationItems () {
    return {}
  }

  static validate (configurationItem) {
    return false
  }
}

module.exports = HomeMaticFloorHeatingActuatorAccessory
