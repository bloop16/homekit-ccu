/*
 * File: HomeMaticIPDoorLockSensorAccessory.js
 * Project: homekit-ccu
 * -----
 * HmIP-DLS door lock sensor (channel 1 DOOR_LOCK_STATE_TRANSCEIVER) as a read-only HomeKit lock.
 * The sensor only reports whether the bolt is locked:
 *   LOCK_STATE ENUM UNKNOWN(0) LOCKED(1) UNLOCKED(2) -> LockCurrentState
 * LockTargetState follows the current state; HomeKit writes are rejected because the sensor
 * cannot move the bolt.
 * ==========================================================================
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { HAPStatus, HapStatusError } = require('@homebridge/hap-nodejs')

const LOCK_STATE_LOCKED = 1
const LOCK_STATE_UNLOCKED = 2

class HomeMaticIPDoorLockSensorAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    this.Characteristic = Characteristic
    this.lockState = undefined
    const service = this.getService(Service.LockMechanism)

    this.lockCurrentState = service.getCharacteristic(Characteristic.LockCurrentState)
      .on('get', async (callback) => {
        await self.fetchLockState()
        callback(null, self.hkCurrentState())
      })

    this.lockTargetState = service.getCharacteristic(Characteristic.LockTargetState)
      .on('get', async (callback) => {
        await self.fetchLockState()
        callback(null, self.hkTargetState())
      })
      .on('set', (value, callback) => {
        self.debugLog('the lock sensor cannot lock or unlock; rejecting target %s', value)
        callback(new HapStatusError(HAPStatus.READ_ONLY_CHARACTERISTIC))
        // show the real state again
        setImmediate(() => self.lockTargetState.updateValue(self.hkTargetState(), null))
      })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('LOCK_STATE'), (newValue) => {
      const lockState = parseInt(newValue)
      if (isNaN(lockState)) {
        return
      }
      self.lockState = lockState
      self.updateCharacteristic(self.lockCurrentState, self.hkCurrentState())
      self.updateCharacteristic(self.lockTargetState, self.hkTargetState())
    })

    this.addLowBatCharacteristic(0)
  }

  // reads LOCK_STATE; keeps the last known state when the CCU has no answer
  async fetchLockState () {
    try {
      const lockState = parseInt(await this.getValue('LOCK_STATE', true))
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
    switch (this.lockState) {
      case LOCK_STATE_LOCKED:
        return Characteristic.LockTargetState.SECURED
      case LOCK_STATE_UNLOCKED:
        return Characteristic.LockTargetState.UNSECURED
      default:
        // UNKNOWN says nothing about the bolt; keep what HomeKit shows
        return this.lockTargetState.value
    }
  }

  static channelTypes () {
    return ['DOOR_LOCK_STATE_TRANSCEIVER']
  }

  static serviceDescription () {
    return 'This service provides a read-only lock in HomeKit for the HmIP door lock sensor DLS'
  }
}

module.exports = HomeMaticIPDoorLockSensorAccessory
