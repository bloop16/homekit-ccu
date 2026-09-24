/*
 * File: HomeMaticBatteryAccessory.js
 * Project: homekit-ccu
 * File Created: Saturday, 28th March 2020 7:40:28 pm
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

class HomeMaticBatteryAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    this.Characteristic = Characteristic
    const service = this.addService(new Service.Battery(this._name))
    const settings = this.getDeviceSettings()
    this.lowLevelValue = ((settings.lowLevelValue !== undefined) && (settings.lowLevelValue > 0)) ? parseFloat(settings.lowLevelValue) : undefined
    // without a maximum the datapoint already holds percent
    this.maxLevelValue = ((settings.maxLevelValue !== undefined) && (settings.maxLevelValue > 0)) ? parseFloat(settings.maxLevelValue) : 100
    this.datapoint = settings.datapoint
    this.levelCharacteristic = service.getCharacteristic(Characteristic.BatteryLevel)
      .on('get', self.guardedGet((callback) => {
        return self.readBatteryValue().then(value => {
          callback(null, (value === undefined) ? self.levelCharacteristic.value : self.levelFor(value))
        })
      }))

    service.getCharacteristic(Characteristic.ChargingState)
      .on('get', (callback) => {
        if (callback) callback(null, Characteristic.ChargingState.NOT_CHARGING)
      })

    if (this.lowLevelValue) {
      this.lowLevelCharacteristic = service.getCharacteristic(Characteristic.StatusLowBattery)
        .on('get', self.guardedGet((callback) => {
          return self.readBatteryValue().then(value => {
            callback(null, (value === undefined) ? self.lowLevelCharacteristic.value : self.lowStatusFor(value))
          })
        }))
    }
    this.updateChannel()
  }

  // the value of the configured datapoint as number, undefined when there is none
  async readBatteryValue () {
    if (!this.datapoint) {
      return undefined
    }
    try {
      const value = parseFloat(await this.getValue(this.datapoint, true))
      return Number.isFinite(value) ? value : undefined
    } catch (e) {
      this.debugLog('unable to read %s: %s', this.datapoint, e.message || e)
      return undefined
    }
  }

  levelFor (value) {
    const level = Math.round(value / (this.maxLevelValue / 100))
    return Math.min(100, Math.max(0, level))
  }

  lowStatusFor (value) {
    return (value < this.lowLevelValue)
      ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
  }

  async updateChannel () {
    const value = await this.readBatteryValue()
    if (value === undefined) {
      return
    }
    this.levelCharacteristic.updateValue(this.levelFor(value), null)
    if (this.lowLevelValue) {
      this.lowLevelCharacteristic.updateValue(this.lowStatusFor(value), null)
    }
  }

  static channelTypes () {
    return ['SPECIAL']
  }

  static serviceDescription () {
    return 'This service provides a battery indicator based on a HomeMatic Device Datapoint'
  }

  static configurationItems () {
    return {
      datapoint: {
        type: 'text',
        default: '',
        hint: 'Datapoint which contains the battery level',
        label: 'Datapoint'
      },
      lowLevelValue: {
        type: 'number',
        default: 0,
        label: 'LowLevel Value',
        hint: 'Battery level below this will trigger a LowLevel message'
      },
      maxLevelValue: {
        type: 'number',
        default: 0,
        label: 'Max Level Value'
      }
    }
  }
}

module.exports = HomeMaticBatteryAccessory
