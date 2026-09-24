/*
 * File: HomeMaticBlindIPAccessory.js
 * Project: homekit-ccu
 * File Created: Tuesday, 21st April 2020 7:00:43 pm
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
// ms after a HomeKit command in which the blind is expected to start moving
const HOMEKIT_TARGET_GRACE = 5000

class HomeMaticBlindIPAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    const blind = this.getService(Service.WindowCovering)

    this.observeInhibit = false // make this configurable
    this.inhibit = false
    const settings = this.getDeviceSettings()
    this.debugLog('init Blind with settings %s', JSON.stringify(settings))
    this.minValueForClose = (settings.MinForClose) ? parseInt(settings.MinForClose) : 0
    this.maxValueForOpen = (settings.MaxForOpen) ? parseInt(settings.MaxForOpen) : 100

    this.minValueClose = (settings.MinClose) ? parseInt(settings.MinClose) : 0
    this.maxValueOpen = (settings.MaxOpen) ? parseInt(settings.MaxOpen) : 100
    this.observeInhibit = (settings.observeInhibit !== undefined) ? this.isTrue(settings.observeInhibit) : true
    this.useSlats = (settings.useSlats !== undefined) ? this.isTrue(settings.useSlats) : false

    this.hazSlats = (this.getDataPointNameFromSettings('slats', null))

    this.hazCurrentLevel = (this.getDataPointNameFromSettings('getlevel', null))

    this.ignoreWorking = true
    this.currentLevel = 0
    this.targetLevel = undefined
    this.targetLevelSlat = 1.01
    this.isWorking = false
    this.delayOnSet = 1500
    this.reverse = settings.reverse

    this.currentPos = blind.getCharacteristic(Characteristic.CurrentPosition)
      .on('get', self.guardedGet(async (callback) => {
        const value = await self.readBlindLevel()
        self.debugLog('getCurrent Position %s', value)
        if (callback) callback(null, value)
      }))

    this.currentPos.eventEnabled = true

    this.targetPos = blind.getCharacteristic(Characteristic.TargetPosition)
      .on('get', self.guardedGet(async (callback) => {
        // while the blind runs to a HomeKit target, HomeKit must keep seeing that target
        const value = self.isMovingToHomeKitTarget() ? self.hkTargetLevel : await self.readBlindLevel()
        if (callback) {
          self.debugLog('return %s as TargetPosition', value)
          callback(null, value)
        }
      }))
      .on('set', (value, callback) => {
        self.debugLog('set target position %s with delay %s', value, self.delayOnSet)
        // if obstruction has been detected
        if ((self.observeInhibit === true) && (self.inhibit === true)) {
          // wait one second to resync data
          self.debugLog('inhibit is true wait to resync')
          clearTimeout(self.timer)
          self.timer = setTimeout(() => {
            self.queryData()
          }, 1000)
        } else {
          if (parseFloat(value) < self.minValueClose) {
            value = parseFloat(self.minValueClose)
          }

          if (parseFloat(value) > self.maxValueOpen) {
            value = parseFloat(self.maxValueOpen)
          }
          self.hkTargetLevel = value
          self.hkTargetTime = Date.now()

          if (self.reverse === true) {
            value = 100 - value
          }
          const sValue = parseFloat(value) / 100

          self.targetLevel = sValue
          self.eventupdate = false // whaat?
          clearTimeout(self.setTimer)
          self.setTimer = setTimeout(() => {
            self.setHomeMaticLevels()
          }, self.delayOnSet)
        }
        callback()
      })

    this.pstate = blind.getCharacteristic(Characteristic.PositionState)
      .on('get', self.guardedGet(async (callback) => {
        let value
        try {
          value = await self.getValueForDataPointNameWithSettingsKey('activity', null, true)
        } catch (e) {
          self.debugLog('unable to read the activity: %s', e.message || e)
        }
        if (callback) callback(null, self.positionStateFor(parseInt(value)))
      }))

    // STOP lives on the channel of the level the blind is driven with
    const stopDatapoint = String(this.getDataPointNameFromSettings('level', null) || 'LEVEL').replace(/LEVEL$/, 'STOP')
    this.hold = blind.getCharacteristic(Characteristic.HoldPosition)
      .on('set', (value, callback) => {
        if (self.isTrue(value)) {
          self.debugLog('stop the blind')
          clearTimeout(self.setTimer)
          self.hkTargetLevel = undefined
          self.setValue(stopDatapoint, true)
        }
        callback()
      })

    // this.pstate.eventEnabled = true

    if (this.observeInhibit === true) {
      this.obstruction = blind.getCharacteristic(Characteristic.ObstructionDetected)
        .on('get', (callback) => {
          callback(null, this.inhibit)
        })
      this.obstruction.eventEnabled = true
      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('inhibit', null, (newValue) => {
        self.debugLog('set Obstructions to %s', newValue)
        self.inhibit = self.isTrue(newValue)
        if (self.obstruction !== undefined) {
          self.obstruction.updateValue(self.isTrue(newValue), null)
        }
      })
    }

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('activity', null, (newValue) => {
      self.updatePosition(parseInt(newValue))
    })

    if (this.hazCurrentLevel) {
      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('getlevel', null, (newValue) => {
        if (self.isWorking === false) {
          self.debugLog('set final HomeKitValue to %s', newValue)
          self.setFinalBlindLevel(newValue)
          self.realLevel = parseFloat(newValue * 100)
        } else {
          const lvl = self.processBlindLevel(newValue)
          self.realLevel = parseFloat(newValue * 100)
          self.debugLog('set currentPos HomeKitValue to %s', lvl)
          self.currentLevel = lvl
          self.updateCharacteristic(self.currentPos, self.currentLevel)
        }
      })
    } else {
      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('level', null, (newValue) => {
        if (self.isWorking === false) {
          self.debugLog('set final HomeKitValue to %s', newValue)
          self.setFinalBlindLevel(newValue)
          self.realLevel = parseFloat(newValue * 100)
        } else {
          const lvl = self.processBlindLevel(newValue)
          self.realLevel = parseFloat(newValue * 100)
          self.debugLog('set HomeKitValue to %s', lvl)
          self.currentLevel = lvl
          self.updateCharacteristic(self.currentPos, self.currentLevel)
        }
      })
    }
    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('process', null, (newValue) => {
      // Working false will trigger a new remote query
      if (parseInt(newValue) === 0) {
        self.debugLog('Blind has settled')
        self.isWorking = false
        let lvlKey = 'level'
        if (self.hazCurrentLevel) {
          lvlKey = 'getlevel'
        }

        self.hkTargetLevel = undefined
        self.requeryValueForDataPointNameWithSettingsKey(lvlKey, null).then(result => {
          self.debugLog('Blind has settled here is the new position %s', result)
          self.setFinalBlindLevel(result)
          self.realLevel = parseFloat(result * 100)
        }).catch(e => self.debugLog('unable to read the level: %s', e.message || e))
      } else {
        self.debugLog('Blind start moving')
        self.isWorking = true
      }
    })

    // Check slats

    if ((this.hazSlats) && (this.useSlats)) {
      self.debugLog('adding slats')

      this.currentSlatPos = blind.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle)
        .on('get', self.guardedGet(async (callback) => {
          const sLevel = await self.getValueForDataPointNameWithSettingsKey('slats', null, true)
          callback(null, self.slatAngle(sLevel, self.currentSlatPos))
        }))

      this.targetSlatPos = blind.getCharacteristic(Characteristic.TargetHorizontalTiltAngle)
        .on('get', self.guardedGet(async (callback) => {
          const sLevel = await self.getValueForDataPointNameWithSettingsKey('slats', null, true)
          callback(null, self.slatAngle(sLevel, self.targetSlatPos))
        }))
        .on('set', (value, callback) => {
          self.targetLevelSlat = (parseFloat(value) + 90) / 180
          self.debugLog('%s event set slats to %s', self._serial, self.targetLevelSlat)
          clearTimeout(self.setTimer)

          self.setTimer = setTimeout(() => {
            self.setHomeMaticLevels()
          }, self.delayOnSet)

          callback()
        })

      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('slats', null, (newValue) => {
        const hkLevel = -90 + (180 * parseFloat(newValue))
        self.debugLog('event on slats %s will be %s', newValue, hkLevel)
        self.updateCharacteristic(self.currentSlatPos, hkLevel)
        self.updateCharacteristic(self.targetSlatPos, hkLevel)
      })
    }

    this.queryData()
  }

  setHomeMaticLevels () {
    // set the level to 1.01 to prevent moving //https://github.com/thkl/hap-homematic/issues/96#issuecomment-640172561
    if (this.targetLevel !== undefined) {
      this.debugLog('%s setHomeMaticLevels  Level %s', this._serial, this.targetLevel)
      this.setValueForDataPointNameWithSettingsKey('level', null, this.targetLevel)
    }
    if (this.targetLevelSlat !== undefined) {
      this.debugLog('%s setHomeMaticLevels Level_2 %s', this._serial, this.targetLevelSlat)
      this.setValueForDataPointNameWithSettingsKey('slats', null, this.targetLevelSlat)
    }
  }

  async queryData () {
    // trigger new event (datapointEvent)
    // kill the cache first
    const self = this
    const value = await self.readBlindLevel()
    self.updateCharacteristic(self.currentPos, value)
    self.updateCharacteristic(self.targetPos, value)

    if (this.observeInhibit === true) {
      const iValue = await self.getValueForDataPointNameWithSettingsKey('inhibit', null, true)
      self.updateObstruction(self.isTrue(iValue)) // not sure why value (true/false) is currently a string? - but lets convert it if it is
    }
  }

  processBlindLevel (newValue) {
    let value = parseFloat(newValue)
    value = value * 100
    this.realLevel = value
    if (value <= this.minValueForClose) {
      value = 0
    }
    if (value >= this.maxValueForOpen) {
      value = 100
    }
    if (this.reverse === true) {
      value = 100 - value
    }
    this.debugLog('processLevel input:%s min:%s max:%s reverse:%s output:%s', newValue, this.minValueForClose, this.maxValueForOpen, this.reverse, value)
    this.reportedLevel = value
    return value
  }

  // https://github.com/thkl/homebridge-homematic/issues/208
  // if there is a custom close level and the real level is below homekit will get the 0% ... and visevera for max level

  setFinalBlindLevel (value) {
    value = this.processBlindLevel(value)
    if (!Number.isFinite(value)) {
      return
    }
    this.debugLog('Updating Final blind level %s', value)
    this.updateCharacteristic(this.currentPos, value)
    this.updateCharacteristic(this.targetPos, value)
    this.updateCharacteristic(this.pstate, 2) // STOPPED
  }

  updatePosition (value) {
    this.updateCharacteristic(this.pstate, this.positionStateFor(value))
  }

  // ACTIVITY_STATE 0 = UNKNOWN, 1 = UP (opening), 2 = DOWN (closing), 3 = STABLE
  positionStateFor (activity) {
    const up = (this.reverse === true) ? 0 : 1 // DECREASING : INCREASING
    switch (activity) {
      case 1:
        return up
      case 2:
        return 1 - up
      default:
        return 2 // STOPPED
    }
  }

  // a HomeKit target counts while the blind moves, or shortly after it was sent and the blind did not start yet
  isMovingToHomeKitTarget () {
    if (this.hkTargetLevel === undefined) {
      return false
    }
    return (this.isWorking === true) || ((Date.now() - this.hkTargetTime) < this.delayOnSet + HOMEKIT_TARGET_GRACE)
  }

  // HomeKit position of the blind from the CCU; keeps the last known position when the CCU has none
  async readBlindLevel () {
    let value
    try {
      const key = this.hazCurrentLevel ? 'getlevel' : 'level'
      value = this.processBlindLevel(await this.getValueForDataPointNameWithSettingsKey(key, null, true))
    } catch (e) {
      this.debugLog('unable to read the level: %s', e.message || e)
    }
    if (!Number.isFinite(value)) {
      value = Number.isFinite(this.currentPos.value) ? this.currentPos.value : 0
    }
    return value
  }

  // HomeKit slat angle (-90..90) for LEVEL_2 (0..1); keeps the last known angle when the value tells nothing
  slatAngle (level, characteristic) {
    const angle = -90 + (180 * parseFloat(level))
    if (Number.isFinite(angle)) {
      return Math.min(90, Math.max(-90, angle))
    }
    return Number.isFinite(characteristic.value) ? characteristic.value : -90
  }

  updateObstruction (value) {
    this.inhibit = value
    this.obstruction.updateValue(value, null)
  }

  shutdown () {
    this.debugLog('shutdown')
    super.shutdown()
    clearTimeout(this.timer)
    clearTimeout(this.setTimer)
  }

  initServiceSettings () {
    return {
      SHUTTER_VIRTUAL_RECEIVER: {
        inhibit: { name: '4.INHIBIT' },
        activity: { name: '3.ACTIVITY_STATE' },
        level: { name: '4.LEVEL' },
        getlevel: { name: '3.LEVEL' },
        process: { name: '3.PROCESS' }
      },
      BLIND_VIRTUAL_RECEIVER: {
        inhibit: { name: '4.INHIBIT' },
        activity: { name: '4.ACTIVITY_STATE' },
        level: { name: '4.LEVEL' },
        process: { name: '4.PROCESS' },
        slats: { name: '4.LEVEL_2' }
      },
      'HmIPW-DRBL4:BLIND_VIRTUAL_RECEIVER': {
        inhibit: { name: 'INHIBIT' },
        activity: { name: 'ACTIVITY_STATE' },
        level: { name: 'LEVEL' },
        process: { name: 'PROCESS' },
        slats: { name: 'LEVEL_2' }
      },
      'HmIP-HDM1:SHADING_RECEIVER': {
        inhibit: { name: 'INHIBIT' },
        activity: { name: 'ACTIVITY_STATE' },
        level: { name: 'LEVEL' },
        process: { name: 'PROCESS' }
      },
      'HmIP-DRBLI4:BLIND_VIRTUAL_RECEIVER': {
        inhibit: { name: 'INHIBIT' },
        activity: { name: 'ACTIVITY_STATE' },
        level: { name: 'LEVEL' },
        process: { name: 'PROCESS' },
        slats: { name: 'LEVEL_2' }
      }
    }
  }

  static channelTypes () {
    return ['SHUTTER_VIRTUAL_RECEIVER', 'BLIND_VIRTUAL_RECEIVER', 'SHADING_RECEIVER']
  }

  static serviceDescription () {
    return 'You can control your blinds with this service'
  }

  static configurationItems () {
    return {
      MinForClose: {
        type: 'number',
        default: 0,
        label: 'min value for close',
        hint: 'set homkit to close if the blind is below this value'
      },
      MaxForOpen: {
        type: 'number',
        default: 100,
        label: 'max value for open',
        hint: 'set homkit to open if the blind is above this value'
      },
      MinClose: {
        type: 'number',
        default: 0,
        label: 'min value',
        hint: 'do not close the blind below this level'
      },
      MaxOpen: {
        type: 'number',
        default: 100,
        label: 'max value',
        hint: 'do not open the blind above this level'
      },
      observeInhibit: {
        type: 'checkbox',
        default: true,
        label: 'Observe Inhibit',
        hint: 'when checked the blind will not move when inhbit is set'
      },
      useSlats: {
        type: 'checkbox',
        default: true,
        label: 'Add Slats',
        hint: 'when available a control to manipulate the slats will be added'
      },
      reverse: {
        type: 'checkbox',
        default: false,
        label: 'reverse values',
        hint: '0 is 100 and 100 is 0'
      }
    }
  }
}
module.exports = HomeMaticBlindIPAccessory
