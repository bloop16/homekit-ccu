/*
 * File: HomeMaticAlarmAccessory.js
 * Project: homekit-ccu
 * File Created: Monday, 16th March 2020 12:16:09 pm
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

class HomeMaticAlarmAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    this.sensor = this.getService(Service.SecuritySystem)

    this.sensor.getCharacteristic(Characteristic.SecuritySystemAlarmType)
      .on('get', (callback) => {
        callback(null, 0)
      })
      .updateValue(0, null)

    this.alarms = {} // alarm channels that are triggered
    this.currentState = this.sensor.getCharacteristic(Characteristic.SecuritySystemCurrentState)
      .on('get', async (callback) => {
        const armed = await self.readArmState('mapping')
        if (armed !== undefined) {
          self.systemCurrentState = armed
        }
        callback(null, self.hkCurrentState(Characteristic))
      })

    this.targetState = this.sensor.getCharacteristic(Characteristic.SecuritySystemTargetState)
      .on('set', (value, callback) => {
        const hkValue = self.getDataPointResultMapping('armstate', null, value, 'mappingTarget', true)
        self.log.debug('[ALSY] HK %s mapped to %s ', value, hkValue)
        self.setValueForDataPointNameWithSettingsKey('state', 'armstate', hkValue)
        callback()
      })
      .on('get', async (callback) => {
        const target = await self.readArmState('mappingTarget')
        // keep the last known target when the CCU has none
        callback(null, (target !== undefined) ? target : self.targetState.value)
      })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('state', 'armstate', (newValue) => {
      const mappetTargetValue = self.armState(newValue, 'mappingTarget')
      self.log.debug('[ALSY] HK %s mapped to %s ', newValue, mappetTargetValue)
      if (mappetTargetValue === undefined) {
        return
      }
      self.targetState.updateValue(mappetTargetValue, null)
      clearTimeout(self.stateTimer)
      self.stateTimer = setTimeout(() => {
        self.systemCurrentState = self.armState(newValue, 'mapping')
        self.currentState.updateValue(self.hkCurrentState(Characteristic), null)
      }, 100)
    })

    // register all 3 Alarm Channels
    const alTypes =
    ['intalarm',
      'extalarm',
      'panic']

    alTypes.forEach(atype => {
      self.registerAddressWithSettingsKeyForEventProcessingAtAccessory('state', atype, (newValue) => {
        self.alarms[atype] = self.isTrue(newValue)
        self.currentState.updateValue(self.hkCurrentState(Characteristic), null)
      })
    })

    this.addTamperedCharacteristic(this.sensor, 4)
    this.addLowBatCharacteristic(4)
  }

  // HomeKit arm state for an ARMSTATE value; undefined when the value tells nothing
  armState (value, table) {
    if ((value === undefined) || (value === null) || (value === '')) {
      return undefined
    }
    const mapped = this.getDataPointResultMapping('armstate', null, value, table)
    return Number.isInteger(mapped) ? mapped : undefined
  }

  async readArmState (table) {
    try {
      return this.armState(await this.getValueForDataPointNameWithSettingsKey('state', 'armstate', false), table)
    } catch (e) {
      this.debugLog('unable to read ARMSTATE: %s', e.message || e)
      return undefined
    }
  }

  hkCurrentState (Characteristic) {
    if (Object.keys(this.alarms).some(atype => this.alarms[atype] === true)) {
      return Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
    }
    if (this.systemCurrentState !== undefined) {
      return this.systemCurrentState
    }
    const last = this.currentState.value
    return (last !== Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED) ? last : Characteristic.SecuritySystemCurrentState.DISARMED
  }

  shutdown () {
    clearTimeout(this.stateTimer)
    super.shutdown()
  }

  static channelTypes () {
    return ['ARMING']
  }

  static serviceDescription () {
    return 'This service provides a alarm system for HomeKit'
  }

  initServiceSettings (Characteristic) {
    return {
      '*': {
        intalarm: {
          state: '1.STATE'
        },
        extalarm: {
          state: '2.STATE'
        },
        panic: {
          state: '3.STATE'
        },
        armstate: {
          state: 'ARMSTATE',
          number: true,
          mapping: {
            0: Characteristic.SecuritySystemCurrentState.STAY_ARM,
            1: Characteristic.SecuritySystemCurrentState.NIGHT_ARM,
            2: Characteristic.SecuritySystemCurrentState.AWAY_ARM,
            3: Characteristic.SecuritySystemCurrentState.DISARMED
          },
          mappingTarget: {
            0: Characteristic.SecuritySystemTargetState.STAY_ARM,
            1: Characteristic.SecuritySystemTargetState.NIGHT_ARM,
            2: Characteristic.SecuritySystemTargetState.AWAY_ARM,
            3: Characteristic.SecuritySystemTargetState.DISARM
          }
        }
      }
    }
  }
}

module.exports = HomeMaticAlarmAccessory
