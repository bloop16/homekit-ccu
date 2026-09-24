/*
 * File: HomeMaticGarageDoorOpenerAccessory.js
 * Project: homekit-ccu
 * File Created: Saturday, 28th March 2020 11:08:32 am
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

// DOOR_STATE of the HmIP door modules (HmIP-MOD-TM, HmIP-MOD-HO)
const DOOR_CLOSED = 0
const DOOR_OPEN = 1
const DOOR_VENTILATION = 2
const DOOR_POSITION_UNKNOWN = 3
// DOOR_COMMAND
const COMMAND_OPEN = 1
const COMMAND_CLOSE = 3
const COMMAND_PARTIAL_OPEN = 4
// a HomeKit command that never makes the door move must not keep HomeKit waiting
const COMMAND_TIMEOUT = 120 * 1000

class HomeMaticGarageDoorOpenerAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    const service = this.addService(new Service.GarageDoorOpener(this._name))
    const settings = this.getDeviceSettings()
    const ventilation = settings.addventilation || false
    this.Characteristic = Characteristic
    // this is for eve history
    this.timesOpened = (this.getPersistentValue('timesOpened', 0))
    this.timeOpen = this.getPersistentValue('timeOpen', 0)
    this.timeClosed = this.getPersistentValue('timeClosed', 0)
    this.timeStamp = nowUnix()
    this.initialQuery = true
    this.hkTrigger = false // a HomeKit command is running; the HomeKit target wins until the door settles
    this.working = false // PROCESS: the door is moving
    this.doorState = undefined // last DOOR_STATE of the CCU
    this.targetState = undefined // HomeKit target of the running command or the last movement

    const obstacle = service.getCharacteristic(Characteristic.ObstructionDetected)
      .on('get', (callback) => {
        if (callback) callback(null, false)
      })

    obstacle.eventEnabled = true

    this.currentDoorState = service.getCharacteristic(Characteristic.CurrentDoorState)
      .on('get', async (callback) => {
        await self.fetchDoorState()
        callback(null, self.hkCurrentDoorState())
      })
      .on('set', (value, callback) => {
        callback()
      })
    this.currentDoorState.eventEnabled = true

    this.targetDoorState = service.getCharacteristic(Characteristic.TargetDoorState)
      .on('set', (value, callback) => {
        self.debugLog('Homekit Door Command %s', value)
        self.sendDoorCommand(value)
        if (callback) {
          callback()
        }
      })
      .on('get', async (callback) => {
        await self.fetchDoorState()
        callback(null, self.hkTargetDoorState())
      })

    this.targetDoorState.eventEnabled = true

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('DOOR_STATE'), (newValue) => {
      const doorState = parseInt(newValue)
      if (isNaN(doorState)) {
        return
      }
      self.doorState = doorState
      if (self.hkTrigger === false) {
        self.targetState = undefined
        self.debugLog('send TargetDoorState %s to Homekit', self.hkTargetDoorState())
        self.targetDoorState.updateValue(self.hkTargetDoorState(), null)
      }
      clearTimeout(self.stateTimer)
      self.stateTimer = setTimeout(() => {
        self.updateCharacteristic(self.currentDoorState, self.hkCurrentDoorState())
        self.updateCharacteristic(self.ventOnCharacteristic, self.isVentilating())
      }, 100)
      self.logOpening(doorState !== DOOR_CLOSED)
    })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('PROCESS'), (newValue) => {
      const moving = self.isTrue(newValue) || (parseInt(newValue) === 1)
      self.debugLog('PROCESS event %s (door is moving %s)', newValue, moving)
      if (moving === self.working) {
        return
      }
      self.working = moving
      if (moving) {
        if (self.hkTrigger === false) {
          // moved by a remote or a wall switch; the direction is only clear from an end position
          if (self.doorState === DOOR_CLOSED) {
            self.targetState = Characteristic.TargetDoorState.OPEN
          } else if (self.doorState === DOOR_OPEN) {
            self.targetState = Characteristic.TargetDoorState.CLOSED
          }
          self.updateCharacteristic(self.targetDoorState, self.hkTargetDoorState())
        }
      } else {
        self.commandFinished()
      }
      self.updateCharacteristic(self.currentDoorState, self.hkCurrentDoorState())
      self.updateCharacteristic(self.ventOnCharacteristic, self.isVentilating())
    })

    if (ventilation === true) {
      self.debugLog('adding ventilation')
      const ventilationSwitch = this.addService(new Service.Switch(this._name + ' Ventilation', 'Ventilation'))
      this.ventOnCharacteristic = ventilationSwitch.getCharacteristic(Characteristic.On)
        .on('get', async (callback) => {
          await self.fetchDoorState()
          if (callback) callback(null, self.isVentilating())
        })
        .on('set', (value, callback) => {
          self.debugLog('HomeKit Vent Position command %s', value)
          if (value === true) {
            self.debugLog('sent 4 to ccu')
            self.setValue('DOOR_COMMAND', COMMAND_PARTIAL_OPEN)
          } else {
            self.debugLog('sent 3 to ccu')
            self.setValue('DOOR_COMMAND', COMMAND_CLOSE)
          }
          if (callback) {
            callback()
          }
        })
    }

    // Enable all Eve Logging Services for this device
    this.enableLoggingService('door', false)

    // enable the last Opened Service
    this.addLastActivationService(service)

    this.addResetStatistics(service, () => {
      self.debugLog('reset Stats')
      if (self.tOC !== undefined) {
        self.timesOpened = 0
        self.savePersistentValue('timesOpened', self.timesOpened)
        self.tOC.updateValue(self.timesOpened, null)
      }
    })

    this.tOC = this.addStateBasedCharacteristic(service, this.eve.Characteristic.TimesOpened, () => {
      return self.timesOpened
    })

    this.oDC = this.addStateBasedCharacteristic(service, this.eve.Characteristic.OpenDuration, () => {
      return self.timeOpen
    })

    this.cDC = this.addStateBasedCharacteristic(service, this.eve.Characteristic.ClosedDuration, () => {
      return self.timeClosed
    })
  }

  // reads DOOR_STATE from the CCU; keeps the last known state when the CCU has no answer
  async fetchDoorState () {
    try {
      const doorState = parseInt(await this.getValue('DOOR_STATE', true))
      this.debugLog('ccu says door is %s', doorState)
      if (!isNaN(doorState)) {
        this.doorState = doorState
      }
    } catch (e) {
      this.debugLog('unable to read DOOR_STATE: %s', e.message || e)
    }
    return this.doorState
  }

  isVentilating () {
    return this.doorState === DOOR_VENTILATION
  }

  hkTargetDoorState () {
    const Characteristic = this.Characteristic
    if (this.targetState !== undefined) {
      return this.targetState
    }
    if (this.doorState === undefined) {
      return this.targetDoorState.value
    }
    return (this.doorState === DOOR_CLOSED) ? Characteristic.TargetDoorState.CLOSED : Characteristic.TargetDoorState.OPEN
  }

  hkCurrentDoorState () {
    const Characteristic = this.Characteristic
    const moving = this.working || this.hkTrigger
    if (moving && (this.targetState !== undefined)) {
      return (this.targetState === Characteristic.TargetDoorState.OPEN) ? Characteristic.CurrentDoorState.OPENING : Characteristic.CurrentDoorState.CLOSING
    }
    switch (this.doorState) {
      case DOOR_CLOSED:
        return Characteristic.CurrentDoorState.CLOSED
      case DOOR_OPEN:
      case DOOR_VENTILATION:
        return Characteristic.CurrentDoorState.OPEN
      case DOOR_POSITION_UNKNOWN:
        // stopped between the end positions
        return Characteristic.CurrentDoorState.STOPPED
      default:
        return this.currentDoorState.value
    }
  }

  sendDoorCommand (value) {
    const Characteristic = this.Characteristic
    const command = (value === Characteristic.TargetDoorState.OPEN) ? COMMAND_OPEN : COMMAND_CLOSE
    const alreadyThere = ((command === COMMAND_OPEN) && (this.doorState === DOOR_OPEN)) ||
      ((command === COMMAND_CLOSE) && (this.doorState === DOOR_CLOSED))
    this.debugLog('sent %s to ccu', command)
    this.setValue('DOOR_COMMAND', command)
    if (alreadyThere && !this.working) {
      this.targetState = undefined
      return
    }
    this.hkTrigger = true
    this.targetState = value
    this.updateCharacteristic(this.currentDoorState, this.hkCurrentDoorState())
    clearTimeout(this.commandTimer)
    this.commandTimer = setTimeout(async () => {
      this.debugLog('door did not report the end of the movement; asking the CCU')
      this.commandFinished()
      await this.fetchDoorState()
      this.updateCharacteristic(this.targetDoorState, this.hkTargetDoorState())
      this.updateCharacteristic(this.currentDoorState, this.hkCurrentDoorState())
    }, COMMAND_TIMEOUT)
  }

  commandFinished () {
    clearTimeout(this.commandTimer)
    this.hkTrigger = false
    this.working = false
    this.targetState = undefined
    if (this.doorState !== undefined) {
      this.updateCharacteristic(this.targetDoorState, this.hkTargetDoorState())
    }
  }

  // Eve statistics: count openings and add the time spent in the previous state
  logOpening (isOpen) {
    if ((this.initialQuery === false) && (this.lastValue !== isOpen)) {
      const now = nowUnix()
      const elapsed = Math.max(0, now - this.timeStamp)
      this.timeStamp = now
      if (isOpen === true) {
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
    this.addLogEntry({
      status: isOpen ? 1 : 0
    })
    this.lastValue = isOpen
    this.initialQuery = false
  }

  shutdown () {
    clearTimeout(this.stateTimer)
    clearTimeout(this.commandTimer)
    super.shutdown()
  }

  static channelTypes () {
    return ['DOOR_RECEIVER']
  }

  static configurationItems () {
    return {
      addventilation: {
        type: 'checkbox',
        default: false,
        label: 'Add ventilation',
        hint: 'Adds a button to set the gate to ventilation mode'
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a garage door opener in HomeKit'
  }

  static validate (configurationItem) {
    return false
  }
}

module.exports = HomeMaticGarageDoorOpenerAccessory
