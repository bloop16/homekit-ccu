/*
 * File: HomeMaticPowerMeterAccessory.js
 * Project: homekit-ccu
 * File Created: Monday, 9th March 2020 7:09:33 pm
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

// CCU values -> Eve units: POWER W, CURRENT mA -> A, VOLTAGE V, ENERGY_COUNTER Wh -> kWh
const toPower = (value, fallback) => Math.max(0, numberOr(value, fallback))
const toCurrent = (value, fallback) => {
  const milliAmps = numberOr(value, undefined)
  return (milliAmps === undefined) ? fallback : milliAmps / 1000
}
const toVoltage = (value, fallback) => numberOr(value, fallback)
const toKiloWattHours = (value, fallback) => {
  const wattHours = numberOr(value, undefined)
  return (wattHours === undefined) ? fallback : parseFloat((wattHours / 1000).toFixed(2))
}

class HomeMaticPowerMeterAccessory extends HomeMaticAccessory {
  initAccessoryService (Service) {
    this.service = this.getService(this.eve.Service.PowerMeterService)
    this.service.addOptionalCharacteristic(this.eve.Characteristic.FirmwareInfo)
    this.enableLoggingService('energy', false)
  }

  publishServices (Service, Characteristic) {
    const self = this

    this.refreshTime = 10 * 60 * 1000
    this.currentPower = 0
    this.service.getCharacteristic(this.eve.Characteristic.FirmwareInfo)
      .updateValue(Buffer.from('1F00010E2400B8040A00F473069A430F8ADD', 'hex').toString('base64')) // Eve Energy FirmwareString

    if (this.getDataPointNameFromSettings('power', null)) {
      this.power = this.service.getCharacteristic(this.eve.Characteristic.ElectricPower)
        .on('get', (callback) => {
          // logging will be done by the event handler
          self.readMeasurement('power', true, toPower, self.power, callback)
        })

      this.power.eventEnabled = true
    }

    if (this.getDataPointNameFromSettings('energyCounter', null)) {
      this.energyCounter = this.service.getCharacteristic(this.eve.Characteristic.TotalConsumption)
        .on('get', (callback) => {
          // CCU sends wH -- homekit haz kwh - so calculate /1000
          self.readMeasurement('energyCounter', true, toKiloWattHours, self.energyCounter, callback)
        })

      this.energyCounter.eventEnabled = true
    }

    if (this.getDataPointNameFromSettings('current', null)) {
      this.currentCharacteristic = this.service.getCharacteristic(this.eve.Characteristic.ElectricCurrent)
        .on('get', (callback) => {
          self.readMeasurement('current', false, toCurrent, self.currentCharacteristic, callback)
        })

      this.currentCharacteristic.eventEnabled = true
    }

    if (this.getDataPointNameFromSettings('voltage', null)) {
      this.voltageCharacteristic = this.service.getCharacteristic(this.eve.Characteristic.Voltage)
        .on('get', (callback) => {
          self.readMeasurement('voltage', false, toVoltage, self.voltageCharacteristic, callback)
        })

      this.voltageCharacteristic.eventEnabled = true
    }

    this.addResetStatistics(this.service, () => {
      self.log.debug('[PMS] reset Stats')
    })

    if (this.power) {
      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('power', null, (newValue) => {
        const power = toPower(newValue, undefined)
        if (power === undefined) {
          return
        }
        self.currentPower = power
        self.updateLog()
        self.power.updateValue(power, null)
        self.powerChanged(power)
      })
    }

    if (this.energyCounter) {
      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('energyCounter', null, (newValue) => {
      // CCU sends wH -- homekit haz kwh - so calculate /1000
        const value = toKiloWattHours(newValue, undefined)
        if (value !== undefined) {
          self.energyCounter.updateValue(value, null)
        }
      })
    }

    if (this.currentCharacteristic) {
      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('current', null, (newValue) => {
        // CCU reports Milli Amps / Homekit Amps
        const value = toCurrent(newValue, undefined)
        if (value !== undefined) {
          self.currentCharacteristic.updateValue(value, null)
        }
      })
    }

    if (this.voltageCharacteristic) {
      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('voltage', null, (newValue) => {
        const value = toVoltage(newValue, undefined)
        if (value !== undefined) {
          self.voltageCharacteristic.updateValue(value, null)
        }
      })
    }

    this.initialQueryTimer = setTimeout(() => {
      self.queryData()
    }, self.refreshTime)
  }

  // answers a HomeKit read of a measurement; keeps the last value when the CCU has none
  readMeasurement (settingsKey, ignoreCache, convert, characteristic, callback) {
    this.getValueForDataPointNameWithSettingsKey(settingsKey, null, ignoreCache).then(value => {
      if (callback) callback(null, convert(value, characteristic.value))
    }).catch(e => {
      this.debugLog('unable to read %s: %s', settingsKey, e.message || e)
      if (callback) callback(null, characteristic.value)
    })
  }

  // hook for subclasses that act on the power drawn
  powerChanged (power) {
  }

  updateLog () {
    this.addLogEntry({ power: this.currentPower })
  }

  queryData () {
    const self = this
    if (this.power) { this.getValueForDataPointNameWithSettingsKey('power', null, false) }
    if (this.energyCounter) { this.getValueForDataPointNameWithSettingsKey('energyCounter', null, false) }
    if (this.currentCharacteristic) { this.getValueForDataPointNameWithSettingsKey('current', null, false) }
    if (this.voltageCharacteristic) { this.getValueForDataPointNameWithSettingsKey('voltage', null, false) }
    // create timer to query device every 10 minutes
    this.refreshTimer = setTimeout(() => { self.queryData() }, self.refreshTime)
  }

  shutdown () {
    super.shutdown()
    clearTimeout(this.refreshTimer)
    clearTimeout(this.initialQueryTimer)
  }

  initServiceSettings () {
    return {
      '*': {
        power: 'POWER',
        energyCounter: 'ENERGY_COUNTER'
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a enery counter in HomeKit (this only works in eve)'
  }

  static channelTypes () {
    return ['POWERMETER_IGL', 'POWERMETER_IEC1']
  }
}
module.exports = HomeMaticPowerMeterAccessory
