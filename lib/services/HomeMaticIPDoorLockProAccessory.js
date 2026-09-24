/*
 * File: HomeMaticIPDoorLockProAccessory.js
 * Project: homekit-ccu
 * -----
 * HmIP-DLP / -DLP-A / -DLP-AS / -DLP-WS door lock drive (channel 12 DOOR_LOCK_TRANSCEIVER) as a
 * native HomeKit lock.
 *
 * Datapoints of DOOR_LOCK_TRANSCEIVER (eQ-3 device definition):
 *   LOCK_STATE        ENUM UNKNOWN(0) LOCKED(1) UNLOCKED(2) INVALID(3)   -> LockCurrentState
 *   LOCK_TARGET_LEVEL ENUM LOCKED(0) UNLOCKED(1) OPEN(2) ...             <- LockTargetState
 *   ACTIVITY_STATE    ENUM UNKNOWN(0) UP(1) DOWN(2) STABLE(3)           end of a drive command
 *   ERROR_JAMMED      BOOL                                               -> JAMMED
 * The drive logic is the one of the HmIP-DLD (HomeMaticKeyMaticIPAccessory); the DLP reports
 * ERROR_JAMMED on the lock channel instead of the maintenance channel.
 * ==========================================================================
 */

const path = require('path')
const HomeMaticKeyMaticIPAccessory = require(path.join(__dirname, 'HomeMaticKeyMaticIPAccessory.js'))

class HomeMaticIPDoorLockProAccessory extends HomeMaticKeyMaticIPAccessory {
  // a blocked drive: ERROR_JAMMED of the lock channel (or the maintenance channel on other firmware)
  async addJammedState () {
    const self = this
    try {
      let jammedDP
      for (const dp of ['ERROR_JAMMED', '0.ERROR_JAMMED']) {
        if ((jammedDP === undefined) && (await this._ccu.hazDatapoint(this.buildAddress(dp)))) {
          jammedDP = dp
        }
      }
      if (jammedDP === undefined) {
        return
      }
      this.jammed = this.isTrue(await this.getValue(jammedDP, false))
      this.updateLockCharacteristics()
      this.registerAddressForEventProcessingAtAccessory(this.buildAddress(jammedDP), (newValue) => {
        self.jammed = self.isTrue(newValue)
        self.updateLockCharacteristics()
      })
    } catch (e) {
      this.debugLog('unable to add the jammed state: %s', e.message || e)
    }
  }

  initServiceSettings () {
    // battery: LOW_BAT of the maintenance channel only
    return {}
  }

  static channelTypes () {
    return ['DOOR_LOCK_TRANSCEIVER']
  }

  static serviceDescription () {
    return 'This service provides a lock in HomeKit for the HmIP door lock drive DLP'
  }
}

module.exports = HomeMaticIPDoorLockProAccessory
