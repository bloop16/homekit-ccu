/*
 * File: HomeMaticPassageSensorAccessory.js
 * Project: homekit-ccu
 * The MIT License (MIT)
 * ==========================================================================
 */

/*
 * The passage detector HmIP-SPDR tells with CURRENT_PASSAGE_DIRECTION (true or false) in which
 * direction somebody walked through. Apple Home has no passage sensor: every direction is a
 * motion sensor that detects motion for one second per passage, so an automation can react to
 * "somebody came in" and "somebody went out" separately.
 *
 * The device has two channels of this type (2 and 3) that report the same: map one of them.
 * Its counter (channel 4) counts each direction up for ever, it does not count the people in the
 * room, so it is not shown.
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))

// ms a direction detects motion after a passage
const MOTION_MS = 1000

class HomeMaticPassageSensorAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    // [direction 1, direction 2]; true is direction 1, false direction 2 (swapped with "reverse")
    this.directions = ['Direction 1', 'Direction 2'].map(label => {
      const service = this.addService(new Service.MotionSensor(this._name + ' ' + label, label))
      service.getCharacteristic(Characteristic.StatusActive)
        .on('get', (callback) => callback(null, true))
        .updateValue(true, null)
      const motion = service.getCharacteristic(Characteristic.MotionDetected)
        .on('get', (callback) => callback(null, motion.value === true))
      motion.updateValue(false, null)
      return { service, motion, timer: undefined }
    })
    this.directions[0].service.setPrimaryService()
    this.reverse = this.isTrue(this.getDeviceSettings().reverse)

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('CURRENT_PASSAGE_DIRECTION'), (newValue) => {
      if ((newValue === undefined) || (newValue === null) || (newValue === '')) {
        return
      }
      const first = self.isTrue(newValue) !== self.reverse
      self.pulse(self.directions[first ? 0 : 1])
    })

    this.addLowBatCharacteristic(0)
  }

  pulse (direction) {
    clearTimeout(direction.timer)
    direction.motion.updateValue(true, null)
    direction.timer = setTimeout(() => {
      direction.motion.updateValue(false, null)
    }, MOTION_MS)
  }

  shutdown () {
    super.shutdown()
    ;(this.directions || []).forEach(direction => clearTimeout(direction.timer))
  }

  initServiceSettings () {
    return {}
  }

  static channelTypes () {
    return ['PASSAGE_DETECTOR_DIRECTION_TRANSMITTER']
  }

  static configurationItems () {
    return {
      reverse: {
        type: 'checkbox',
        default: false,
        label: 'Swap the directions',
        hint: 'Direction 1 detects motion when the sensor reports true, direction 2 when it reports false; this swaps them'
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a motion sensor for each direction of a passage detector in HomeKit'
  }

  static getPriority () {
    return 1
  }
}

module.exports = HomeMaticPassageSensorAccessory
