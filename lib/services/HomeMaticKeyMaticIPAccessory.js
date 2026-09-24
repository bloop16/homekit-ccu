/*
 * File: HomeMaticKeyMaticIPAccessory.js
 * Project: homekit-ccu
 * File Created: 14.04.2021 5:49:23 pm
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

// LOCK_STATE of the HmIP-DLD
const LOCK_STATE_UNKNOWN = 0
const LOCK_STATE_LOCKED = 1
const LOCK_STATE_UNLOCKED = 2
// ACTIVITY_STATE 3: the drive is not moving
const ACTIVITY_STABLE = 3
// a command the drive never confirms must not keep HomeKit waiting
const COMMAND_TIMEOUT = 30 * 1000

module.exports = class HomeMaticKeyMaticIPAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    this.Characteristic = Characteristic
    const service = this.addService(new Service.LockMechanism(this._name))
    const unlockMode = this.getDeviceSettings().unlockMode || 'unlock'
    const addDoorOpener = this.getDeviceSettings().addDoorOpener || false
    this.commandTimeout = COMMAND_TIMEOUT
    this.lockState = undefined // last LOCK_STATE of the CCU
    this.jammed = false
    this.pendingTarget = undefined // HomeKit target while a command runs

    this.lockCurrentState = service.getCharacteristic(Characteristic.LockCurrentState)
      .on('get', async (callback) => {
        self.debugLog('LockCurrentState get called')
        await self.fetchLockState()
        callback(null, self.hkCurrentState())
      })
      .on('set', (value, callback) => {
        self.debugLog('hk set lockCurrentState will be ignored')
        callback()
      })

    this.lockCurrentState.eventEnabled = true

    this.lockTargetState = service.getCharacteristic(Characteristic.LockTargetState)
      .on('get', async (callback) => {
        self.debugLog('LockTargetState get called ask LOCK_STATE')
        await self.fetchLockState()
        callback(null, self.hkTargetState())
      })

      .on('set', (value, callback) => {
        // check config settings what to do
        self.debugLog('hk set lockTargetState value is %s', value)
        if (value === Characteristic.LockTargetState.UNSECURED) {
          self.debugLog('unlock command')
          if (unlockMode === 'open') {
            self.debugLog('unlock mode is open send open command to ccu')
            self.setValue('LOCK_TARGET_LEVEL', 2)
          } else {
            self.debugLog('unlock mode is normal send state 0 command to ccu')
            self.setValue('LOCK_TARGET_LEVEL', 1)
          }
        } else if (value === Characteristic.LockTargetState.SECURED) {
          self.debugLog('lock command received send state 1 to ccu')
          self.setValue('LOCK_TARGET_LEVEL', 0)
        }
        self.startCommand(value)
        callback()
      })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('LOCK_STATE'), (newValue) => {
      const lockState = parseInt(newValue)
      if (isNaN(lockState)) {
        return
      }
      self.lockState = lockState
      self.debugLog('event for LOCK_STATE with value %s (command running: %s)', newValue, self.pendingTarget !== undefined)
      self.updateLockCharacteristics()
    })

    // Optional Open Switch
    if (addDoorOpener === true) {
      const openerService = self.addService(new Service.Switch(`${self._name} - Opener`, 'Opener'))
      const opchar = openerService.getCharacteristic(Characteristic.On)
      opchar.on('get', (callback) => {
        if (callback) {
          callback(null, false)
        }
      })

      opchar.on('set', (value, callback) => {
        if (self.isTrue(value)) {
          self.setValue('LOCK_TARGET_LEVEL', 2).then(() => { })
          clearTimeout(self.openTimer)
          self.openTimer = setTimeout(() => {
            self.debugLog('reset Opener Switch')
            self.updateCharacteristic(opchar, false)
            self.requeryTimer = setTimeout(() => {
              self.queryState()
            }, 10000)
          }, 2000)
        }
        callback()
      })
    }

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('ACTIVITY_STATE'), (newValue) => {
      const as = parseInt(newValue)
      if (as === ACTIVITY_STABLE) {
        self.finishCommand()
        self.queryState()
      }
    })

    this.addJammedState()
    this.addLowBatCharacteristic()
  }

  // a blocked drive (ERROR_JAMMED on the maintenance channel), only when the device has it
  async addJammedState () {
    const self = this
    try {
      if (await this._ccu.hazDatapoint(this.buildAddress('0.ERROR_JAMMED'))) {
        this.jammed = this.isTrue(await this.getValue('0.ERROR_JAMMED', false))
        this.registerAddressForEventProcessingAtAccessory(this.buildAddress('0.ERROR_JAMMED'), (newValue) => {
          self.jammed = self.isTrue(newValue)
          self.updateLockCharacteristics()
        })
      }
    } catch (e) {
      this.debugLog('unable to add the jammed state: %s', e.message || e)
    }
  }

  // reads LOCK_STATE from the CCU; keeps the last known state when the CCU has no answer
  async fetchLockState () {
    try {
      const lockState = parseInt(await this.getValue('LOCK_STATE', true))
      this.debugLog('hk get lock state result from ccu is %s', lockState)
      if (!isNaN(lockState)) {
        this.lockState = lockState
      }
    } catch (e) {
      this.debugLog('unable to read LOCK_STATE: %s', e.message || e)
    }
    return this.lockState
  }

  hkCurrentState () {
    const Characteristic = this.Characteristic
    if (this.jammed === true) {
      return Characteristic.LockCurrentState.JAMMED
    }
    switch (this.lockState) {
      case LOCK_STATE_LOCKED:
        return Characteristic.LockCurrentState.SECURED
      case LOCK_STATE_UNLOCKED:
        return Characteristic.LockCurrentState.UNSECURED
      default:
        return Characteristic.LockCurrentState.UNKNOWN
    }
  }

  hkTargetState () {
    const Characteristic = this.Characteristic
    if (this.pendingTarget !== undefined) {
      return this.pendingTarget
    }
    switch (this.lockState) {
      case LOCK_STATE_LOCKED:
        return Characteristic.LockTargetState.SECURED
      case LOCK_STATE_UNLOCKED:
        return Characteristic.LockTargetState.UNSECURED
      default:
        // LOCK_STATE_UNKNOWN says nothing about where the lock should be
        return this.lockTargetState.value
    }
  }

  updateLockCharacteristics () {
    this.updateCharacteristic(this.lockCurrentState, this.hkCurrentState())
    if ((this.pendingTarget === undefined) && (this.lockState !== LOCK_STATE_UNKNOWN)) {
      this.updateCharacteristic(this.lockTargetState, this.hkTargetState())
    }
  }

  startCommand (target) {
    this.pendingTarget = target
    clearTimeout(this.commandTimer)
    this.commandTimer = setTimeout(() => {
      this.debugLog('lock did not report the end of the command; follow the CCU again')
      this.finishCommand()
      this.queryState()
    }, this.commandTimeout)
  }

  finishCommand () {
    clearTimeout(this.commandTimer)
    this.pendingTarget = undefined
    this.updateLockCharacteristics()
  }

  queryState () {
    this.requeryValue('LOCK_STATE') // should trigger the registered events
  }

  shutdown () {
    clearTimeout(this.openTimer)
    clearTimeout(this.requeryTimer)
    clearTimeout(this.commandTimer)
    super.shutdown()
  }

  initServiceSettings () {
    return {
      // three AA cells
      '*': { voltage: 3.6 }
    }
  }

  static channelTypes () {
    return ['DOOR_LOCK_STATE_TRANSMITTER']
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
      addDoorOpener: {
        type: 'checkbox',
        default: false,
        label: 'Add a door opener switch',
        hint: ''
      }
    }
  }
}
