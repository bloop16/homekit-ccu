/*
 * File: HomeMaticIPSmokeDetectorAccessory.js
 * Project: homekit-ccu
 * File Created: Saturday, 28th March 2020 12:23:38 pm
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
const { Characteristic } = require('@homebridge/hap-nodejs')

// SMOKE_DETECTOR_ALARM_STATUS
const ALARM_IDLE = 0
const ALARM_PRIMARY = 1
const ALARM_INTRUSION = 2
const ALARM_SECONDARY = 3
// SMOKE_DETECTOR_TEST_RESULT 2: the smoke test failed
const TEST_FAILED = 2

class HomeMaticIPSmokeDetectorAccessory extends HomeMaticAccessory {
  publishServices (Service) {
    const self = this
    const settings = this.getDeviceSettings()
    this.memyselfandi = settings.single_alarm || false

    const sensor = this.addService(new Service.SmokeSensor(this._name))
    this.detectorstate = sensor.getCharacteristic(Characteristic.SmokeDetected)
      .on('get', async (callback) => {
        try {
          const value = await self.getValue('SMOKE_DETECTOR_ALARM_STATUS', true)
          const smoke = self.smokeDetected(value)
          callback(null, (smoke === undefined) ? self.detectorstate.value : smoke)
        } catch (e) {
          self.debugLog('unable to read the alarm status: %s', e.message || e)
          callback(null, self.detectorstate.value)
        }
      })
    this.detectorstate.eventEnabled = true

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('SMOKE_DETECTOR_ALARM_STATUS'), (newValue) => {
      self.log.debug('[IPSDS] event %s', newValue)
      const smoke = self.smokeDetected(newValue)
      if (smoke !== undefined) {
        self.detectorstate.updateValue(smoke, null)
      }
    })

    this.addFaultStatus(sensor)
    // HmIP-SWSD reports LOW_BAT on the maintenance channel
    if (this._deviceType === 'HmIP-SWSD') {
      this.addLowBatCharacteristic(0)
    }
  }

  // SmokeDetected for an alarm status; undefined when the value tells nothing
  smokeDetected (value) {
    const detected = Characteristic.SmokeDetected.SMOKE_DETECTED
    const notDetected = Characteristic.SmokeDetected.SMOKE_NOT_DETECTED
    switch (parseInt(value)) {
      case ALARM_IDLE:
        return notDetected
      case ALARM_PRIMARY:
      case ALARM_INTRUSION:
        return detected
      case ALARM_SECONDARY:
        // another detector of the team is alarming; ignored when only the own alarm counts
        return (this.memyselfandi !== true) ? detected : notDetected
      default:
        return undefined
    }
  }

  /**
   * StatusFault from the datapoints the detector has: a degraded smoke chamber, a failed smoke
   * test and an unreachable device.
   */
  async addFaultStatus (sensor) {
    const self = this
    const candidates = ['0.ERROR_DEGRADED_CHAMBER', 'ERROR_DEGRADED_CHAMBER', 'SMOKE_DETECTOR_TEST_RESULT', '0.UNREACH']
    const sources = []
    try {
      for (const dp of candidates) {
        if (await this._ccu.hazDatapoint(this.buildAddress(dp))) {
          sources.push(dp)
        }
      }
    } catch (e) {
      this.debugLog('unable to check the fault datapoints: %s', e.message || e)
    }
    if (sources.length === 0) {
      return
    }
    this.faultValues = {}
    const isFault = (dp, value) => (dp === 'SMOKE_DETECTOR_TEST_RESULT') ? (parseInt(value) === TEST_FAILED) : this.isTrue(value)
    const hkFault = () => Object.keys(self.faultValues).some(dp => self.faultValues[dp] === true)
      ? Characteristic.StatusFault.GENERAL_FAULT
      : Characteristic.StatusFault.NO_FAULT

    this.faultCharacteristic = sensor.getCharacteristic(Characteristic.StatusFault)
      .on('get', async (callback) => {
        for (const dp of sources) {
          try {
            self.faultValues[dp] = isFault(dp, await self.getValue(dp, true))
          } catch (e) {
            self.debugLog('unable to read %s: %s', dp, e.message || e)
          }
        }
        callback(null, hkFault())
      })
    sources.forEach(dp => {
      self.registerAddressForEventProcessingAtAccessory(self.buildAddress(dp), (newValue) => {
        self.faultValues[dp] = isFault(dp, newValue)
        self.faultCharacteristic.updateValue(hkFault(), null)
      })
    })
  }

  static channelTypes () {
    return ['HmIP-SWSD:SMOKE_DETECTOR']
  }

  static configurationItems () {
    return {
      single_alarm: {
        type: 'checkbox',
        default: false,
        label: 'Detect single alarms',
        hint: ''
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a smoke detector in HomeKit'
  }
}

module.exports = HomeMaticIPSmokeDetectorAccessory
