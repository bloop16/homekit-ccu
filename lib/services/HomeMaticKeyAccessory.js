/*
 * File: HomeMaticKeyAccessory.js
 * Project: homekit-ccu
 * File Created: Sunday, 8th March 2020 7:00:35 pm
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

// this Accessory will spawn a event to the Server if set
// usefull for reloading action
const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))

// the CCU repeats PRESS_LONG while a key is held; a gap longer than this ends the hold
const LONG_PRESS_GAP_MS = 1000

class HomeMaticKeyAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    this.switch = this.getService(Service.StatelessProgrammableSwitch)
    this.keyEvent = this.switch.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
    // HomeMatic reports short and long presses; a double press does not exist
    this.keyEvent.setProps({
      validValues: [Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS, Characteristic.ProgrammableSwitchEvent.LONG_PRESS]
    })
    this.initialQueryShort = true
    this.initialQueryLong = true
    this.homeKitShortMessage = Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
    this.homeKitLongMessage = Characteristic.ProgrammableSwitchEvent.LONG_PRESS
    this.longPressActive = false
    this.buildKeys('PRESS_SHORT', this.homeKitShortMessage, this.PressShortMessage, this.initialQueryShort, () => this.endLongPress())
    this.buildKeys('PRESS_LONG', this.homeKitLongMessage, this.PressLongMessage, this.initialQueryLong, () => this.startLongPress())
    this.buildKeys('PRESS_LONG_RELEASE', undefined, undefined, true, () => { this.endLongPress(); return false })

    this.buildKeys('PRESS', this.homeKitShortMessage, this.PressShortMessage, this.initialQueryShort)

    if (this.deviceServiceSettings('voltage')) {
      this.addLowBatCharacteristic()
    }
  }

  // true for the first PRESS_LONG of a hold, false for the repetitions
  startLongPress () {
    const isFirst = !this.longPressActive
    this.longPressActive = true
    clearTimeout(this.longPressTimer)
    this.longPressTimer = setTimeout(() => this.endLongPress(), LONG_PRESS_GAP_MS)
    return isFirst
  }

  endLongPress () {
    clearTimeout(this.longPressTimer)
    this.longPressActive = false
    return true
  }

  // shouldSend decides per event whether HomeKit gets notified (default: always)
  async buildKeys (datapoint, homeKitMessage, message, initQuery, shouldSend = () => true) {
    const self = this
    if (await this._ccu.hazDatapoint(this.buildAddress(datapoint))) {
      this.registerAddressForEventProcessingAtAccessory(this.buildAddress(datapoint), (newValue) => {
        if ((!initQuery) || (self.runsInTestMode)) {
          if ((shouldSend() === true) && (homeKitMessage !== undefined)) {
            self.log.debug('%s Event send %s', datapoint, homeKitMessage)
            self.updateCharacteristic(self.keyEvent, homeKitMessage, true)

            if (message) {
              self.emit(message)
            }
          }
        } else {
          self.log.debug('Scrub due initial query')
        }
        initQuery = false
      })
    } else {
      self.log.debug('%s not found skipping key', datapoint)
    }
  }

  shutdown () {
    clearTimeout(this.longPressTimer)
    super.shutdown()
  }

  static channelTypes () {
    return ['KEY', 'VIRTUAL_KEY', 'KEY_TRANSCEIVER', 'MULTI_MODE_INPUT_TRANSMITTER', 'SWITCH_INTERFACE', 'MULTI_MODE_INPUT_TRANSMITTER']
  }

  initServiceSettings () {
    return {
      'HmIP-KRCA': {
        voltage: 1.2
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a programmable switch in HomeKit based on a ccu KEY'
  }

  static filterDevice () {
    return ['HmIP-ASIR', 'HmIP-ASIR-B1', 'HmIP-ASIR-2', 'HmIP-ASIR-O', 'HmIP-BBL']
  }
}
module.exports = HomeMaticKeyAccessory
