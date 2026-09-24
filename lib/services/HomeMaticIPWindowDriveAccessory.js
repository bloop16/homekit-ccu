/*
 * File: HomeMaticIPWindowDriveAccessory.js
 * Project: homekit-ccu
 * -----
 * HmIP-MOD-WD-VK window drive module (channel 2 WINDOW_DRIVE_RECEIVER) as a native HomeKit window.
 *   LEVEL (0 closed .. 1 open)                   -> CurrentPosition 0..100, TargetPosition writes LEVEL
 *   ACTIVITY_STATE UNKNOWN(0) UP(1) DOWN(2) STABLE(3) -> PositionState (when the device reports it)
 *   STOP                                          <- HoldPosition
 * A target set in HomeKit is kept while the drive runs; it follows the position again when the
 * drive reports STABLE, reaches the target or did not report within DRIVE_TIMEOUT.
 * ==========================================================================
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { Characteristic } = require('@homebridge/hap-nodejs')
const { numberOr, clamp } = require(path.join(__dirname, 'NativeSupport.js'))

const ACTIVITY_UP = 1
const ACTIVITY_DOWN = 2
const ACTIVITY_STABLE = 3
const DRIVE_TIMEOUT = 120 * 1000

// HomeKit position 0..100 for a LEVEL 0..1; undefined for a value that says nothing
function positionForLevel (value) {
  const level = numberOr(value, undefined)
  return (level === undefined) ? undefined : Math.round(clamp(level, 0, 1) * 100)
}

class HomeMaticIPWindowDriveAccessory extends HomeMaticAccessory {
  publishServices (Service) {
    const self = this
    this.driveTimeout = DRIVE_TIMEOUT
    this.position = undefined // last position of the CCU
    this.pendingTarget = undefined // HomeKit target while the drive runs
    this.activity = undefined

    const window = this.getService(Service.Window)

    this.currentPosition = window.getCharacteristic(Characteristic.CurrentPosition)
      .on('get', self.guardedGet(async (callback) => {
        await self.fetchPosition()
        callback(null, self.hkPosition())
      }))

    this.targetPosition = window.getCharacteristic(Characteristic.TargetPosition)
      .on('get', self.guardedGet(async (callback) => {
        await self.fetchPosition()
        callback(null, (self.pendingTarget !== undefined) ? self.pendingTarget : self.hkPosition())
      }))
      .on('set', async (value, callback) => {
        const target = clamp(Math.round(numberOr(value, self.hkPosition())), 0, 100)
        self.debugLog('HomeKit moves the window to %s', target)
        self.startDrive(target)
        try {
          await self.setValue('LEVEL', target / 100)
          callback()
        } catch (e) {
          self.debugLog('unable to set LEVEL: %s', e.message || e)
          self.finishDrive()
          callback(e)
        }
      })

    this.positionState = window.getCharacteristic(Characteristic.PositionState)
      .on('get', (callback) => callback(null, self.hkPositionState()))

    window.getCharacteristic(Characteristic.HoldPosition)
      .on('set', async (value, callback) => {
        if (self.isTrue(value)) {
          self.debugLog('HomeKit stops the window')
          try {
            await self.setValue('STOP', true)
          } catch (e) {
            self.debugLog('unable to stop: %s', e.message || e)
          }
          self.finishDrive()
        }
        callback()
      })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('LEVEL'), (newValue) => {
      const position = positionForLevel(newValue)
      if (position === undefined) {
        return
      }
      self.position = position
      self.updateCharacteristic(self.currentPosition, position)
      if ((self.pendingTarget !== undefined) && (Math.abs(self.pendingTarget - position) <= 1) && !self.isMoving()) {
        self.finishDrive()
      } else {
        self.syncTarget()
      }
    })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('ACTIVITY_STATE'), (newValue) => {
      const activity = parseInt(newValue)
      if (isNaN(activity)) {
        return
      }
      self.activity = activity
      self.updateCharacteristic(self.positionState, self.hkPositionState())
      if ((activity === ACTIVITY_STABLE) && (self.pendingTarget !== undefined) && self.driveStarted) {
        self.finishDrive()
      } else {
        self.syncTarget()
      }
      if ((activity === ACTIVITY_UP) || (activity === ACTIVITY_DOWN)) {
        self.driveStarted = true
      }
    })
  }

  async fetchPosition () {
    try {
      const position = positionForLevel(await this.getValue('LEVEL', true))
      if (position !== undefined) {
        this.position = position
      }
    } catch (e) {
      this.debugLog('unable to read LEVEL: %s', e.message || e)
    }
    return this.position
  }

  hkPosition () {
    return (this.position === undefined) ? this.currentPosition.value : this.position
  }

  isMoving () {
    return (this.activity === ACTIVITY_UP) || (this.activity === ACTIVITY_DOWN)
  }

  hkPositionState () {
    switch (this.activity) {
      case ACTIVITY_UP:
        return Characteristic.PositionState.INCREASING
      case ACTIVITY_DOWN:
        return Characteristic.PositionState.DECREASING
      default:
        return Characteristic.PositionState.STOPPED
    }
  }

  startDrive (target) {
    this.pendingTarget = target
    this.driveStarted = false
    clearTimeout(this.driveTimer)
    this.driveTimer = setTimeout(() => {
      this.debugLog('the drive did not report the end of the command; follow the CCU again')
      this.finishDrive()
    }, this.driveTimeout)
  }

  finishDrive () {
    clearTimeout(this.driveTimer)
    this.driveTimer = undefined
    this.pendingTarget = undefined
    this.driveStarted = false
    this.syncTarget()
  }

  // TargetPosition follows the position while HomeKit waits for nothing
  syncTarget () {
    if ((this.pendingTarget === undefined) && !this.isMoving() && (this.position !== undefined)) {
      this.updateCharacteristic(this.targetPosition, this.position)
    }
  }

  shutdown () {
    clearTimeout(this.driveTimer)
    super.shutdown()
  }

  static channelTypes () {
    return ['WINDOW_DRIVE_RECEIVER']
  }

  static serviceDescription () {
    return 'This service provides a motorized window in HomeKit'
  }
}

module.exports = HomeMaticIPWindowDriveAccessory
