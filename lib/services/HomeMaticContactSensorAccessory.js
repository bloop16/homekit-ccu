/*
 * File: HomeMaticContactSensorAccessory.js
 * Project: homekit-ccu
 * File Created: Monday, 9th March 2020 5:18:01 pm
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
const { nowUnix } = require(path.join(__dirname, '..', 'util', 'time.js'))

class HomeMaticContactSensorAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this

    this.timesOpened = (this.getPersistentValue('timesOpened', 0))
    this.timeOpen = this.getPersistentValue('timeOpen', 0)
    this.timeClosed = this.getPersistentValue('timeClosed', 0)
    this.timeStamp = nowUnix()
    const settings = this.getDeviceSettings()
    // reverse only turns the contact around; battery, sabotage and reachability keep their meaning
    this.reverse = (settings.reverse !== undefined) ? settings.reverse : false

    this.contact = this.getService(Service.ContactSensor)

    const active = this.contact.getCharacteristic(Characteristic.StatusActive)
      .on('get', (callback) => {
        callback(null, true)
      })
    active.updateValue(true, null)

    // Enable all Eve Logging Services for this device
    this.enableLoggingService('door', false)

    // enable the last Opened Service
    this.addLastActivationService(this.contact)

    this.addResetStatistics(this.contact, () => {
      self.log.debug('[Contact] reset Stats')
      if (self.tOC !== undefined) {
        self.timesOpened = 0
        self.savePersistentValue('timesOpened', self.timesOpened)
        self.tOC.updateValue(self.timesOpened, null)
      }
    })

    this.tOC = this.addStateBasedCharacteristic(this.contact, this.eve.Characteristic.TimesOpened, () => {
      return self.timesOpened
    })

    this.oDC = this.addStateBasedCharacteristic(this.contact, this.eve.Characteristic.OpenDuration, () => {
      return self.timeOpen
    })

    this.cDC = this.addStateBasedCharacteristic(this.contact, this.eve.Characteristic.ClosedDuration, () => {
      return self.timeClosed
    })

    this.state = this.contact.getCharacteristic(Characteristic.ContactSensorState)
      .on('get', async (callback) => {
        try {
          // Ask CCU for datepoint value
          const value = await self.getValueForDataPointNameWithSettingsKey('state', null, false)
          callback(null, self.contactState(value))
        } catch (e) {
          self.debugLog('unable to read the contact state: %s', e.message || e)
          callback(null, self.state.value)
        }
      })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('state', null, (newValue) => {
      const mappedValue = self.contactState(newValue)
      const historyValue = self.contactState(newValue, 'history')
      self.log.debug('[Contact] state Event %s -  mapped %s', newValue, mappedValue)
      if ((self.initialQuery === false) && (self.lastValue !== mappedValue)) {
        self.countContactChange(mappedValue === Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
      }
      self.log.debug('[Contact] will save %s to history', historyValue)

      self.addLogEntry({
        status: historyValue
      })
      self.initialQuery = false
      self.lastValue = mappedValue
      self.state.updateValue(mappedValue, null)
    })

    this.addContactStatus(this.contact)
    this.addLowBatCharacteristic()
  }

  /**
   * HomeKit ContactSensorState (0 closed, 1 open) for a CCU value. HmIP contacts send an enum
   * (0 closed, 1 tilted or open, 2 open), BidCos contacts a boolean and the CCU script interface
   * strings; a value that says nothing keeps the last known state.
   */
  contactState (value, table = 'mapping') {
    const settings = this.deviceServiceSettings('state') || {}
    let result
    if (settings.boolean === true) {
      const open = this.isOpenValue(value)
      if (open !== undefined) {
        result = settings[table][((this.reverse === true) ? !open : open) ? 'true' : 'false']
      }
    } else if (!this.isEmptyValue(value)) {
      result = this.getDataPointResultMapping('state', null, value, table)
    }
    if (typeof result === 'boolean') {
      result = result ? 1 : 0
    }
    const numeric = parseInt(result)
    if ((numeric === 0) || (numeric === 1)) {
      return numeric
    }
    const last = (this.state !== undefined) ? parseInt(this.state.value) : NaN
    return ((table === 'mapping') && ((last === 0) || (last === 1))) ? last : 0
  }

  isEmptyValue (value) {
    return (value === undefined) || (value === null) || (value === '')
  }

  // true for open, false for closed, undefined when the value tells nothing
  isOpenValue (value) {
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value > 0 : undefined
    }
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase()
      if (text === 'true') return true
      if (text === 'false') return false
      const number = parseFloat(text)
      return Number.isFinite(number) ? number > 0 : undefined
    }
    return undefined
  }

  // Eve statistics: count openings and add the time spent in the previous state
  countContactChange (isOpen) {
    const now = nowUnix()
    const elapsed = Math.max(0, now - this.timeStamp)
    this.timeStamp = now
    if (isOpen) {
      this.timeClosed = this.timeClosed + elapsed
      this.timesOpened = this.timesOpened + 1
      this.tOC.updateValue(this.timesOpened, null)
      this.savePersistentValue('timesOpened', this.timesOpened)
      this.updateLastActivation()
      this.cDC.updateValue(this.timeClosed, null)
    } else {
      this.timeOpen = this.timeOpen + elapsed
      this.oDC.updateValue(this.timeOpen, null)
    }
  }

  // sabotage and reachability of the device (maintenance channel), only when the device has them
  async addContactStatus (service) {
    try {
      const hasSabotage = await this._ccu.hazDatapoint(this.buildAddress('0.SABOTAGE')) ||
        await this._ccu.hazDatapoint(this.buildAddress('0.ERROR_SABOTAGE'))
      if (hasSabotage) {
        await this.addTamperedCharacteristic(service, 0)
      }
      if (await this._ccu.hazDatapoint(this.buildAddress('0.UNREACH'))) {
        this.addFaultCharacteristic(service, '0.UNREACH')
      }
    } catch (e) {
      this.debugLog('unable to add the contact status: %s', e.message || e)
    }
  }

  initServiceSettings () {
    return {
      '*': {
        state: {
          name: 'STATE',
          boolean: true,
          mapping: { true: 1, false: 0 },
          history: { true: 1, false: 0 }
        }
      },
      SHUTTER_CONTACT_TRANSCEIVER: {
        voltage: 2.4,
        state: {
          name: 'STATE',
          boolean: true,
          mapping: { true: 1, false: 0 },
          history: { true: 1, false: 0 }
        }
      },
      ACCELERATION_TRANSCEIVER: {
        voltage: 2.4,
        state: {
          name: 'MOTION',
          boolean: true,
          mapping: { true: 1, false: 0 },
          history: { true: 1, false: 0 }
        }
      },
      SENSOR: {
        state: {
          name: 'SENSOR',
          boolean: true,
          mapping: { true: 1, false: 0 },
          history: { true: 1, false: 0 }
        }
      },
      MULTI_MODE_INPUT_TRANSMITTER: {
        voltage: 2.4,
        state: {
          name: 'STATE',
          boolean: true,
          mapping: { true: 1, false: 0 },
          history: { true: 1, false: 0 }
        }
      }
    }
  }

  static channelTypes () {
    return ['CONTACT',
      'SHUTTER_CONTACT',
      'TILT_SENSOR',
      'HmIP-SAM:ACCELERATION_TRANSCEIVER',
      'SHUTTER_CONTACT_TRANSCEIVER',
      'HMW-Sen-SC-12-DR:SENSOR',
      'MULTI_MODE_INPUT_TRANSMITTER',
      'WRAPPER'
    ]
  }

  static serviceDescription () {
    return 'This service provides a Contact in HomeKit'
  }

  static configurationItems () {
    return {
      reverse: {
        type: 'checkbox',
        default: false,
        label: 'Reverse the values',
        hint: 'on is off and off is on'
      }
    }
  }
}
module.exports = HomeMaticContactSensorAccessory
