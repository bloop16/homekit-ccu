/*
 * File: HomeMaticDoorAccessory.js
 * Project: homekit-ccu
 * File Created: Sunday, 15th March 2020 11:07:36 am
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

class HomeMaticDoorAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this

    this.timesOpened = (this.getPersistentValue('timesOpened', 0))
    this.timeOpen = this.getPersistentValue('timeOpen', 0)
    this.timeClosed = this.getPersistentValue('timeClosed', 0)
    this.timeStamp = nowUnix()
    const settings = this.getDeviceSettings()
    // reverse only turns the contact around; the battery keeps its meaning
    this.reverse = (settings.reverse !== undefined) ? settings.reverse : false

    this.initAccessoryService(Service)

    // Enable all Eve Logging Services for this device
    this.enableLoggingService('door', false)

    // enable the last Opened Service
    this.addLastActivationService(this.service)

    this.addResetStatistics(this.service, () => {
      self.log.debug('[Door] reset Stats')
      if (self.tOC !== undefined) {
        self.timesOpened = 0
        self.savePersistentValue('timesOpened', self.timesOpened)
        self.tOC.updateValue(self.timesOpened, null)
      }
    })

    this.tOC = this.addStateBasedCharacteristic(this.service, this.eve.Characteristic.TimesOpened, () => {
      return self.timesOpened
    })

    this.oDC = this.addStateBasedCharacteristic(this.service, this.eve.Characteristic.OpenDuration, () => {
      return self.timeOpen
    })

    this.cDC = this.addStateBasedCharacteristic(this.service, this.eve.Characteristic.ClosedDuration, () => {
      return self.timeClosed
    })

    const getPosition = async (callback, name) => {
      try {
        const value = await self.getValueForDataPointNameWithSettingsKey('state', null, false)
        const hmresult = self.positionFor(value)
        self.log.debug('[Door] get%s HM is %s', name, hmresult)
        callback(null, hmresult)
      } catch (e) {
        self.debugLog('unable to read the position: %s', e.message || e)
        callback(null, self.positionFor(undefined))
      }
    }

    this.currentPosition = this.service.getCharacteristic(Characteristic.CurrentPosition)
      .on('get', (callback) => getPosition(callback, 'CurrentPosition'))

    this.targetPosition = this.service.getCharacteristic(Characteristic.TargetPosition)
      .on('get', (callback) => getPosition(callback, 'TargetPosition'))
      .on('set', (value, callback) => {
        // This is just a sensor so reset homekit data to ccu value after 1 second playtime
        clearTimeout(self.resetTimer)
        self.resetTimer = setTimeout(() => {
          self.getValueForDataPointNameWithSettingsKey('state', null, true).then(value => {
            const hmresult = self.positionFor(value)
            self.log.debug('[Door] reset the door cause read only HM is %s', hmresult)
            self.processPositionState(hmresult)
          }).catch(e => self.debugLog('unable to read the position: %s', e.message || e))
        }, 500)

        if (callback) {
          callback()
        }
      })

    this.positionState = this.service.getCharacteristic(Characteristic.PositionState)
    this.positionState.on('get', (callback) => {
      if (callback) callback(null, Characteristic.PositionState.STOPPED)
    })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('state', null, (newValue) => {
      const mappedResult = self.positionFor(newValue)
      const historyResult = self.positionFor(newValue, 'history')
      self.log.debug('[Door] state Event %s -  mapped %s', newValue, mappedResult)
      if ((self.initialQuery === false) && (self.lastValue !== mappedResult) && ((self.lastValue > 0) !== (mappedResult > 0))) {
        self.countOpeningChange(mappedResult > 0)
      }
      self.log.debug('[Door] will save %s to history', historyResult)
      self.addLogEntry({
        status: historyResult
      })

      self.initialQuery = false
      self.lastValue = mappedResult
      self.processPositionState(mappedResult)
    })

    this.addLowBatCharacteristic()
  }

  /**
   * HomeKit position (0..100, or the Eve history value) for a CCU value. Contacts send a boolean,
   * HmIP contacts an enum (0 closed, 1 or 2 open) and the CCU script interface strings; a value that
   * says nothing keeps the last known position.
   */
  positionFor (value, table = 'mapping') {
    const settings = this.deviceServiceSettings('state') || {}
    const empty = (value === undefined) || (value === null) || (value === '')
    let result
    if (settings.boolean === true) {
      const open = this.isOpenValue(value)
      if (open !== undefined) {
        result = settings[table][((this.reverse === true) ? !open : open) ? 'true' : 'false']
      }
    } else if (!empty) {
      result = this.getDataPointResultMapping('state', null, value, table)
    }
    const numeric = parseFloat(result)
    const max = (table === 'mapping') ? 100 : 1
    if (Number.isFinite(numeric) && (numeric >= 0) && (numeric <= max)) {
      return numeric
    }
    if (table !== 'mapping') {
      return 0
    }
    const last = (this.currentPosition !== undefined) ? parseFloat(this.currentPosition.value) : NaN
    return (Number.isFinite(last) && (last >= 0) && (last <= 100)) ? last : 0
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
  countOpeningChange (isOpen) {
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

  processPositionState (isOpen) {
    const self = this
    this.log.debug('[Door] processing State %s', isOpen)
    if ((this.currentPosition !== undefined) && (this.targetPosition !== undefined) && (this.positionState !== undefined)) {
      this.log.debug('[Door] set to %s', isOpen)
      this.targetPosition.updateValue(isOpen, null)
      clearTimeout(this.positionTimer)
      this.positionTimer = setTimeout(() => {
        self.currentPosition.updateValue(isOpen, null)
      }, 100)
      this.positionState.updateValue(2, null)
    }
  }

  shutdown () {
    clearTimeout(this.resetTimer)
    clearTimeout(this.positionTimer)
    super.shutdown()
  }

  initAccessoryService (Service) {
    this.service = this.getService(Service.Door)
  }

  initServiceSettings () {
    return {
      '*': {
        state: { name: 'STATE', boolean: true, mapping: { true: 100, false: 0 }, history: { true: 1, false: 0 } }
      }
    }
  }

  static channelTypes () {
    return ['CONTACT', 'SHUTTER_CONTACT', 'MULTI_MODE_INPUT_TRANSMITTER']
  }

  static serviceDescription () {
    return 'This service provides a door based on a ccu contact in HomeKit'
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
module.exports = HomeMaticDoorAccessory
