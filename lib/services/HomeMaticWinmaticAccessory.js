/*
 * File: HomeMaticWinmaticAccessory.js
 * Project: homekit-ccu
 * File Created: Monday, 20th April 2020 6:42:07 pm
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

class HomeMaticWinmaticAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    this.setByHomeKit = false
    this.isWorking = false
    const service = this.addService(new Service.Window(this._name))
    service.setPrimaryService(true)
    this.currentPosition = service.getCharacteristic(Characteristic.CurrentPosition)
      .on('get', async (callback) => {
        const hkPos = await self.readPosition(self.currentPosition)
        if (callback) callback(null, hkPos)
      })
      .on('set', (value, callback) => {
        callback()
      })

    this.currentPosition.eventEnabled = true

    this.targetPosition = service.getCharacteristic(Characteristic.TargetPosition)
      .on('set', async (value, callback) => {
        self.setByHomeKit = true
        if (value === 0) {
        // Lock Window on Close Event
          self.log.debug('[WinMatic] set to 0 -> should lock')
          self.shouldLock = true
        }
        await self.setValue('SPEED', 1)
        self.setValueDelayed('LEVEL', (value / 100), 500)
        callback()
      })
      .on('get', async (callback) => {
        const hkPos = await self.readPosition(self.targetPosition)
        if (callback) callback(null, hkPos)
      })

    this.targetPosition.eventEnabled = true

    this.position = service.getCharacteristic(Characteristic.PositionState)
      .on('get', async (callback) => {
        let dir
        try {
          dir = await self.getValue('DIRECTION', true)
        } catch (e) {
          self.debugLog('unable to read DIRECTION: %s', e.message || e)
        }
        // DIRECTION 0 NONE, 1 UP (opening), 2 DOWN (closing), 3 UNDEFINED
        switch (parseInt(dir)) {
          case 1:
            if (callback) callback(null, Characteristic.PositionState.INCREASING)
            break
          case 2:
            if (callback) callback(null, Characteristic.PositionState.DECREASING)
            break
          default:
            if (callback) callback(null, Characteristic.PositionState.STOPPED)
            break
        }
      })

    this.position.eventEnabled = true

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('DIRECTION'), (newValue) => {
      switch (parseInt(newValue)) {
        case 0:
          this.position.updateValue(Characteristic.PositionState.STOPPED, null)
          break
        case 1:
          this.position.updateValue(Characteristic.PositionState.INCREASING, null)
          break
        case 2:
          this.position.updateValue(Characteristic.PositionState.DECREASING, null)
          break
      }
    })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('WORKING'), async (newValue) => {
      self.isWorking = self.isTrue(newValue)
      if (!self.isTrue(newValue)) {
        if (self.shouldLock === true) {
          // set level to -0.005
          self.shouldLock = false
          await self.setValue('SPEED', 1)
          await self.setValue('LEVEL', -0.005)
        }
        self.position.updateValue(Characteristic.PositionState.STOPPED, null)
        self.setByHomeKit = false
        self.getValue('LEVEL', true)
      }
    })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('LEVEL'), (newValue) => {
      const value = self.hkPosition(newValue)
      if (value === undefined) {
        return
      }
      // do not touch the target position if the movement was initiated by homekit
      if (self.setByHomeKit === false) {
        self.targetPosition.updateValue(value, null)
      }
      setTimeout(() => {
        self.currentPosition.updateValue(value, null)
      }, 200)
    })

    // Battery level is different here channel 2

    const batService = this.addService(new Service.Battery(this._name))

    this.levelCharacteristic = batService.getCharacteristic(Characteristic.BatteryLevel)
      .on('get', async (callback) => {
        const level = await self.readBatteryLevel()
        callback(null, (level === undefined) ? self.levelCharacteristic.value : level)
      })

    this.lowLevelCharacteristic = batService.getCharacteristic(Characteristic.StatusLowBattery)
      .on('get', async (callback) => {
        const level = await self.readBatteryLevel()
        if (level === undefined) {
          callback(null, self.lowLevelCharacteristic.value)
          return
        }
        callback(null, (level <= 20) ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
      })

    this.chargingCharacteristic = batService.getCharacteristic(Characteristic.ChargingState)
      .on('get', (callback) => {
        self.getValue('2.STATUS', true).then(value => {
          if (parseFloat(value) === 1) {
            callback(null, Characteristic.ChargingState.CHARGING)
          } else {
            callback(null, Characteristic.ChargingState.NOT_CHARGING)
          }
        }).catch(() => callback(null, self.chargingCharacteristic.value))
      })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('2.LEVEL'), (newValue) => {
      const level = parseFloat(newValue) * 100
      if (!Number.isFinite(level)) {
        return
      }
      self.lowLevelCharacteristic.updateValue((level <= 20) ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL, null)
      self.levelCharacteristic.updateValue(level, null)
    })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('2.STATUS'), (newValue) => {
      self.chargingCharacteristic.updateValue((parseFloat(newValue) === 1) ? Characteristic.ChargingState.CHARGING : Characteristic.ChargingState.NOT_CHARGING, null)
    })
  }

  // HomeKit position for LEVEL (0..1, -0.005 = closed and locked); undefined when the value tells nothing
  hkPosition (level) {
    const lvl = parseFloat(level)
    if (!Number.isFinite(lvl)) {
      return undefined
    }
    return Math.min(100, Math.max(0, lvl * 100))
  }

  // reads LEVEL; keeps the last known position when the CCU has none
  async readPosition (characteristic) {
    let hkPos
    try {
      hkPos = this.hkPosition(await this.getValue('LEVEL', true))
    } catch (e) {
      this.debugLog('unable to read LEVEL: %s', e.message || e)
    }
    return (hkPos === undefined) ? characteristic.value : hkPos
  }

  // battery level in percent from channel 2, undefined when unknown
  async readBatteryLevel () {
    try {
      const level = parseFloat(await this.getValue('2.LEVEL', true)) * 100
      return Number.isFinite(level) ? Math.min(100, Math.max(0, level)) : undefined
    } catch (e) {
      this.debugLog('unable to read the battery level: %s', e.message || e)
      return undefined
    }
  }

  static channelTypes () {
    return ['WINMATIC']
  }

  static serviceDescription () {
    return 'This service provides a window device for HomeKit'
  }

  static configurationItems () {
    return {}
  }
}

module.exports = HomeMaticWinmaticAccessory
