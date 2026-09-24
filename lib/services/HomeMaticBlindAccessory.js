/*
 * File: HomeMaticBlindAccessory.js
 * Project: homekit-ccu
 * File Created: Sunday, 8th March 2020 6:20:55 pm
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

// HomeKit horizontal tilt of the slats (degrees) for LEVEL_SLATS 0..1 (0 = closed, 1 = open)
const MIN_TILT = -90
const MAX_TILT = 90

function slatLevelToAngle (level) {
  const value = parseFloat(level)
  if (!Number.isFinite(value)) {
    return undefined
  }
  // 1.01 means "no change" when written; clamp whatever the CCU reports
  const clamped = Math.min(1, Math.max(0, value))
  return Math.round(MIN_TILT + (MAX_TILT - MIN_TILT) * clamped)
}

function slatAngleToLevel (angle) {
  const value = Math.min(MAX_TILT, Math.max(MIN_TILT, parseFloat(angle)))
  return Math.round(((value - MIN_TILT) / (MAX_TILT - MIN_TILT)) * 100) / 100
}

class HomeMaticBlindAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    const blind = this.getService(Service.WindowCovering)
    blind.setPrimaryService(true)
    this.delayOnSet = 750

    this.inhibit = false
    const settings = this.getDeviceSettings()
    this.debugLog('init Blind with settings %s', JSON.stringify(settings))
    this.minValueForClose = (settings.MinForClose) ? parseInt(settings.MinForClose) : 0
    this.maxValueForOpen = (settings.MaxForOpen) ? parseInt(settings.MaxForOpen) : 100

    this.minValueClose = (settings.MinClose) ? parseInt(settings.MinClose) : 0
    this.maxValueOpen = (settings.MaxOpen) ? parseInt(settings.MaxOpen) : 100
    this.observeInhibit = (settings.observeInhibit !== undefined) ? this.isTrue(settings.observeInhibit) : true
    this.ignoreWorking = true
    this.currentLevel = 0
    this.targetLevel = undefined
    this.isWorking = false
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
        self.debugLog('get TargetPosition (working %s)', self.isWorking)
        if ((self.isWorking === false) || (self.targetLevel === undefined)) {
          self.debugLog('not working query ccu and sent value back')
          const value = await self.readBlindLevel()
          if (callback) {
            self.debugLog('return %s as TargetPosition', value)
            callback(null, value)
          }
        } else {
          self.debugLog('return previously selected target position %s', self.targetLevel)
          callback(null, self.targetLevel)
        }
      }))

      .on('set', (value, callback) => {
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
          self.targetLevel = value
          self.debugLog('send new targetlevel %s', self.targetLevel)
          self.eventupdate = false // whaat?
          clearTimeout(self.setTime)
          self.isWorking = true
          self.setTime = setTimeout(() => {
            if (self.reverse === true) {
              value = 100 - value
            }
            const sValue = parseFloat(value) / 100
            self.debugLog('send new level %s', sValue)
            self.setValueForDataPointNameWithSettingsKey('level', null, sValue)
          }, self.delayOnSet)
        }
        callback()
      })

    this.hold = blind.getCharacteristic(Characteristic.HoldPosition)
      .on('set', (value, callback) => {
        if (self.isTrue(value)) {
          self.setValue('STOP', true)
        }
        callback()
      })

    this.pstate = blind.getCharacteristic(Characteristic.PositionState)
      .on('get', self.guardedGet(async (callback) => {
        let value
        try {
          value = await self.getValueForDataPointNameWithSettingsKey('direction', null, true)
        } catch (e) {
          self.debugLog('unable to read the direction: %s', e.message || e)
        }
        if (callback) callback(null, self.positionStateFor(parseInt(value)))
      }))

    // this.pstate.eventEnabled = true

    if (this.observeInhibit === true) {
      this.obstruction = blind.getCharacteristic(Characteristic.ObstructionDetected)
        .on('get', self.guardedGet(async (callback) => {
          try {
            const value = await self.getValueForDataPointNameWithSettingsKey('inhibit', null, true)
            self.inhibit = self.isTrue(value)
          } catch (e) {
            self.debugLog('unable to read INHIBIT: %s', e.message || e)
          }
          self.debugLog('set Obstructions to %s', self.inhibit)
          callback(null, self.inhibit)
        }))
      this.obstruction.eventEnabled = true

      this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('inhibit', null, (newValue) => {
        self.debugLog('inhibit event set Obstructions to %s', newValue)
        self.inhibit = self.isTrue(newValue)
        if (self.obstruction !== undefined) {
          self.updateCharacteristic(self.obstruction, self.isTrue(newValue))
        }
      })
    } else {
      self.debugLog('we will ignore INHIBIT')
    }

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('direction', null, (newValue) => {
      self.updatePosition(parseInt(newValue))
    })

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

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('working', null, (newValue) => {
    // Working false will trigger a new remote query
      self.debugLog('working event %s', newValue)
      if (!self.isTrue(newValue)) {
        self.debugLog('working ended')
        self.isWorking = false
        self.requeryValueForDataPointNameWithSettingsKey('level', null)
        self.targetLevel = undefined
      } else {
        self.debugLog('working started')
        self.isWorking = true
      }
    })

    // JALOUSIE: the slats are the horizontal tilt; BLIND channels have none
    const useSlats = (settings.useSlats !== undefined) ? this.isTrue(settings.useSlats) : true
    if ((useSlats) && (this.getDataPointNameFromSettings('slats', null))) {
      this.addSlats(blind, Characteristic)
    }

    this.queryData()
    // fetch the current possition every 2 minutes // this is just for testing
    this.updateInterval = setInterval(() => {
      self.queryData()
    }, 30 * 60 * 1000) // Query every 30 minutes
  }

  addSlats (blind, Characteristic) {
    this.debugLog('adding slats')
    this.isWorkingSlats = false
    this.currentSlats = blind.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle)
      .on('get', this.guardedGet(async (callback) => callback(null, await this.readSlatAngle(this.currentSlats))))

    this.targetSlats = blind.getCharacteristic(Characteristic.TargetHorizontalTiltAngle)
      .on('get', this.guardedGet(async (callback) => {
        if ((this.isWorkingSlats) && (this.targetSlatAngle !== undefined)) {
          callback(null, this.targetSlatAngle)
          return
        }
        callback(null, await this.readSlatAngle(this.targetSlats))
      }))
      .on('set', (value, callback) => {
        this.targetSlatAngle = value
        clearTimeout(this.slatTimer)
        this.slatTimer = setTimeout(() => {
          const level = slatAngleToLevel(value)
          this.debugLog('send new slat level %s', level)
          this.setValueForDataPointNameWithSettingsKey('slats', null, level)
        }, this.delayOnSet)
        callback()
      })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('slats', null, (newValue) => {
      const angle = slatLevelToAngle(newValue)
      if (angle === undefined) {
        return
      }
      this.updateCharacteristic(this.currentSlats, angle)
      if (!this.isWorkingSlats) {
        this.targetSlatAngle = undefined
        this.updateCharacteristic(this.targetSlats, angle)
      }
    })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('workingslats', null, (newValue) => {
      this.isWorkingSlats = this.isTrue(newValue)
      if (!this.isWorkingSlats) {
        this.targetSlatAngle = undefined
        this.updateCharacteristic(this.targetSlats, this.currentSlats.value)
      }
    })
  }

  // HomeKit slat angle from LEVEL_SLATS; keeps the last known angle when the CCU has no value
  async readSlatAngle (characteristic) {
    let angle
    try {
      angle = slatLevelToAngle(await this.getValueForDataPointNameWithSettingsKey('slats', null, true))
    } catch (e) {
      this.debugLog('unable to read the slats: %s', e.message || e)
    }
    if (angle !== undefined) {
      return angle
    }
    return Number.isFinite(characteristic.value) ? characteristic.value : MIN_TILT
  }

  async queryData () {
    // trigger new event (datapointEvent)
    // kill the cache first
    const self = this
    let value = await self.readBlindLevel()
    self.debugLog('qery set current pos to %s', value)
    self.updateCharacteristic(self.currentPos, value)
    if (self.isWorking === false) {
      self.debugLog('not working so update the target position to %s', value)
      self.updateCharacteristic(self.targetPos, value)
    }

    if (this.observeInhibit === true) {
      value = await self.getValueForDataPointNameWithSettingsKey('inhibit', null, true)
      self.updateObstruction(self.isTrue(value)) // not sure why value (true/false) is currently a string? - but lets convert it if it is
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
    this.reportedLevel = value
    // check if the level is reversed
    if (this.reverse === true) {
      value = 100 - value
    }
    this.debugLog('processLevel input:%s min:%s max:%s reverse:%s output:%s', newValue, this.minValueForClose, this.maxValueForOpen, this.reverse, value)
    return value
  }

  // https://github.com/thkl/homebridge-homematic/issues/208
  // if there is a custom close level and the real level is below homekit will get the 0% ... and visevera for max level

  setFinalBlindLevel (value) {
    value = this.processBlindLevel(value)
    if (!Number.isFinite(value)) {
      return
    }
    this.debugLog('setFinalBlindLevel to %s', value)
    this.updateCharacteristic(this.currentPos, value)
    this.updateCharacteristic(this.targetPos, value)
    this.targetLevel = undefined
    this.updateCharacteristic(this.pstate, 2) // STOPPED
  }

  updatePosition (value) {
    this.updateCharacteristic(this.pstate, this.positionStateFor(value))
  }

  // DIRECTION 0 = NONE, 1 = UP (opening), 2 = DOWN (closing), 3 = UNDEFINED
  positionStateFor (direction) {
    const up = (this.reverse === true) ? 0 : 1 // DECREASING : INCREASING
    switch (direction) {
      case 1:
        return up
      case 2:
        return 1 - up
      default:
        return 2 // STOPPED
    }
  }

  // HomeKit position of the blind from the CCU; keeps the last known position when the CCU has none
  async readBlindLevel () {
    let value
    try {
      value = this.processBlindLevel(await this.getValueForDataPointNameWithSettingsKey('level', null, true))
    } catch (e) {
      this.debugLog('unable to read the level: %s', e.message || e)
    }
    if (!Number.isFinite(value)) {
      value = Number.isFinite(this.currentPos.value) ? this.currentPos.value : 0
    }
    return value
  }

  updateObstruction (value) {
    this.inhibit = value
    this.updateCharacteristic(this.obstruction, value)
  }

  shutdown () {
    this.debugLog('shutdown')
    super.shutdown()
    clearTimeout(this.timer)
    clearTimeout(this.setTime)
    clearTimeout(this.slatTimer)
    clearInterval(this.updateInterval)
  }

  initServiceSettings () {
    return {
      BLIND: {
        inhibit: { name: 'INHIBIT' },
        direction: { name: 'DIRECTION' },
        level: { name: 'LEVEL' },
        working: { name: 'WORKING' }
      },
      JALOUSIE: {
        inhibit: { name: 'INHIBIT' },
        direction: { name: 'DIRECTION' },
        level: { name: 'LEVEL' },
        working: { name: 'WORKING' },
        slats: { name: 'LEVEL_SLATS' },
        workingslats: { name: 'WORKING_SLATS' }
      }
    }
  }

  static channelTypes () {
    return ['BLIND', 'JALOUSIE']
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
      reverse: {
        type: 'checkbox',
        default: false,
        label: 'reverse values',
        hint: '0 is 100 and 100 is 0'
      },
      useSlats: {
        type: 'checkbox',
        default: true,
        label: 'Add Slats',
        hint: 'jalousie actuators only: the slats become the tilt angle of the blind'
      }
    }
  }
}
module.exports = HomeMaticBlindAccessory
