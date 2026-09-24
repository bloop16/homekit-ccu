/*
 * File: HomeMaticKeyMaticAccessory.js
 * Project: homekit-ccu
 * File Created: Saturday, 28th March 2020 4:56:55 pm
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

// the momentary switch that opens the latch turns itself off after this time (ms)
const OPEN_RESET_DELAY = 1000
// the subtype keeps the open switch of paired users
const OPEN_SWITCH_SUBTYPE = 'Open'

class HomeMaticKeyMaticAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    const service = this.addService(new Service.LockMechanism(this._name))
    service.setPrimaryService(true)
    const settings = this.getDeviceSettings()
    const unlockMode = settings.unlockMode || 'unlock'
    this.openResetDelay = OPEN_RESET_DELAY
    this.lockState = { state: undefined, error: 0, uncertain: false }

    this.lockCurrentState = service.getCharacteristic(Characteristic.LockCurrentState)
      .on('get', async (callback) => {
        await self.refreshLockState()
        self.debugLog('hk get lockCurrentState %s', JSON.stringify(self.lockState))
        if (callback) callback(null, self.currentLockState(Characteristic))
      })
      .on('set', (value, callback) => {
        self.debugLog('hk set lockCurrentState will be ignored')
        callback()
      })

    this.lockCurrentState.eventEnabled = true

    this.lockTargetState = service.getCharacteristic(Characteristic.LockTargetState)
      .on('get', (callback) => {
        self.readDatapoint('STATE').then((value) => {
          self.debugLog('hk get lockTargetState result from ccu is %s', value)
          if (callback) callback(null, self.isTrue(value) ? Characteristic.LockTargetState.UNSECURED : Characteristic.LockTargetState.SECURED)
        })
      })

      .on('set', (value, callback) => {
        // check config settings what to do
        self.lockEvents = true // disable events
        self.debugLog('hk set lockTargetState value is %s', value)
        if (value === Characteristic.LockTargetState.UNSECURED) {
          self.debugLog('unlock command')
          if (unlockMode === 'open') {
            self.debugLog('unlock mode is open send open command to ccu')
            self.setValue('OPEN', true)
          } else {
            self.debugLog('unlock mode is normal send state 1 command to ccu')
            self.setValue('STATE', 1)
          }
          self.debugLog('will push UNSECURED to lockCurrentState')
          self.updateCharacteristic(self.lockCurrentState, Characteristic.LockCurrentState.UNSECURED)
        } else if (value === Characteristic.LockTargetState.SECURED) {
          self.debugLog('lock command received send state 0 to ccu')
          self.setValue('STATE', 0)
          self.debugLog('will push SECURED to lockCurrentState')
          self.updateCharacteristic(self.lockCurrentState, Characteristic.LockCurrentState.SECURED)
        }

        clearTimeout(self.requeryTimer)
        self.requeryTimer = setTimeout(() => {
          // enable events and query the door again
          self.lockEvents = false
          self.getValue('STATE', true)
        }, 15000) // requery the door in about 15 seconds

        callback()
      })

    if (this.useOpenSwitch(settings, unlockMode)) {
      this.addOpenSwitch(Service, Characteristic)
    }

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('STATE'), (newValue) => {
      if (self.lockEvents === true) {
        self.debugLog('event for STATE with value %s but events are locked due to recent homekit command', newValue)
        return
      }
      self.lockState = { ...self.lockState, state: newValue }
      const lts = self.isTrue(newValue) ? Characteristic.LockTargetState.UNSECURED : Characteristic.LockTargetState.SECURED
      self.debugLog('event for STATE with value %s will update lockTargetState (%s)', newValue, lts)
      self.updateCharacteristic(self.lockCurrentState, self.currentLockState(Characteristic))
      self.updateCharacteristic(self.lockTargetState, lts)
    })

    // a failed motor run (ERROR) and a lock turned by hand (STATE_UNCERTAIN) change the current state only
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('ERROR'), (newValue) => {
      self.lockState = { ...self.lockState, error: newValue }
      self.updateCharacteristic(self.lockCurrentState, self.currentLockState(Characteristic))
    })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('STATE_UNCERTAIN'), (newValue) => {
      self.lockState = { ...self.lockState, uncertain: newValue }
      self.updateCharacteristic(self.lockCurrentState, self.currentLockState(Characteristic))
    })

    this.addLowBatCharacteristic()
  }

  // an explicit setting wins; without one the switch is added when unlocking does not open the door
  useOpenSwitch (settings, unlockMode) {
    if ((settings.addOpenSwitch !== undefined) && (settings.addOpenSwitch !== null)) {
      return this.isTrue(settings.addOpenSwitch)
    }
    return (unlockMode !== 'open')
  }

  // a momentary switch '<name> Open' that sends OPEN (opens the latch) and turns itself off
  addOpenSwitch (Service, Characteristic) {
    const openService = this.getService(Service.Switch, this._name + ' Open', false, OPEN_SWITCH_SUBTYPE)
    this.openCharacteristic = openService.getCharacteristic(Characteristic.On)
      .on('get', (callback) => callback(null, false))
      .on('set', (value, callback) => {
        if (value === true) {
          this.debugLog('hk open switch will send OPEN to the ccu')
          Promise.resolve(this.setValue('OPEN', true))
            .catch((e) => this.errorLog('unable to send OPEN: %s', e && e.message))
          clearTimeout(this.openTimer)
          this.openTimer = setTimeout(() => {
            this.openCharacteristic.updateValue(false, null)
          }, this.openResetDelay)
        }
        callback()
      })
  }

  // reads STATE, ERROR and STATE_UNCERTAIN; keeps the last known value when the CCU does not answer
  async refreshLockState () {
    const [state, error, uncertain] = await Promise.all(['STATE', 'ERROR', 'STATE_UNCERTAIN'].map((dp) => this.readDatapoint(dp)))
    this.lockState = {
      state: (state !== undefined) ? state : this.lockState.state,
      error: (error !== undefined) ? error : this.lockState.error,
      uncertain: (uncertain !== undefined) ? uncertain : this.lockState.uncertain
    }
  }

  // ERROR (CLUTCH_FAILURE, MOTOR_ABORTED) = jammed, STATE_UNCERTAIN = unknown, STATE true = unlocked
  currentLockState (Characteristic) {
    const State = Characteristic.LockCurrentState
    const error = parseInt(this.lockState.error)
    if (Number.isFinite(error) && (error !== 0)) {
      return State.JAMMED
    }
    if (this.isTrue(this.lockState.uncertain)) {
      return State.UNKNOWN
    }
    return this.isTrue(this.lockState.state) ? State.UNSECURED : State.SECURED
  }

  async readDatapoint (dp) {
    try {
      return await this.getValue(dp, true)
    } catch (e) {
      this.debugLog('unable to read %s: %s', dp, e && e.message)
      return undefined
    }
  }

  queryState () {
    this.getValue('STATE', true) // should trigger the registered events
  }

  shutdown () {
    clearTimeout(this.openTimer)
    clearTimeout(this.requeryTimer)
    super.shutdown()
  }

  static channelTypes () {
    return ['KEYMATIC', 'DIGITAL_OUTPUT', 'DIGITAL_ANALOG_OUTPUT']
  }

  static getPriority () {
    return 2
  }

  static serviceDescription () {
    return 'This service provides a locking system in HomeKit connected to your Keymatic'
  }

  static configurationItems () {
    return {
      unlockMode: {
        type: 'option',
        array: ['unlock', 'open'],
        default: 'unlock',
        label: 'Unlock mode',
        hint: 'What to do when HomeKit will unlock the door'
      },
      addOpenSwitch: {
        type: 'checkbox',
        default: true,
        label: 'Add a door opener switch',
        hint: 'adds a switch that opens the latch (not needed when the unlock mode is open)'
      }
    }
  }
}

module.exports = HomeMaticKeyMaticAccessory
