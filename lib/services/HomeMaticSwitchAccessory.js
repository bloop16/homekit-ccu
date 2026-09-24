/*
 * File: HomeMaticSwitchAccessory.js
 * Project: homekit-ccu
 * File Created: Saturday, 7th March 2020 1:46:37 pm
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

class HomeMaticSwitchAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const subType = this.getDeviceSettings().Type || 'Lightbulb'
    const serviceType = { Outlet: Service.Outlet, Switch: Service.Switch, Fan: Service.Fan }[subType] || Service.Lightbulb
    this.debugLog('[SWITCH] creating Service %s', subType)
    const own = this.createOutput(this.getService(serviceType), subType, '', Characteristic)
    this.isOnCharacteristic = own.on
    this.inUseCharacteristic = own.inUse
    // the other outputs of a multi-gang actuator combined into this accessory (util/combinedChannels.js)
    this.combinedOutputs = this.combinedChannels().map(address => {
      const number = String(address).split(':')[1]
      const service = this.addOutputService(serviceType, this.outputName(address, number), address, Characteristic)
      return this.createOutput(service, subType, number + '.', Characteristic)
    })
    if (this.combinedOutputs.length > 0) {
      this.getService(serviceType).setPrimaryService(true)
    }

    // Loggin only works on Switches
    if (subType === 'Switch') {
      this.enableLoggingService('switch')
      this.addLastActivationService(this.loggingService)
    }

    if (this._deviceType === 'HM-Dis-TD-T') {
      this.addLowBatCharacteristic()
    }
  }

  /** the addresses of the other outputs of this device combined into this accessory */
  combinedChannels () {
    const channels = this.getDeviceSettings().channels
    return Array.isArray(channels)
      ? channels.filter(address => (typeof address === 'string') && (address.split(':')[0] === this._serial) && (address !== this.address()))
      : []
  }

  /** the name of a combined output: its CCU channel name, else the accessory name with the channel number */
  outputName (address, number) {
    const channel = this._ccu.getChannelByAddress(address)
    const defaultName = this._deviceType + ' ' + address
    if ((channel) && (channel.name) && (defaultName.indexOf(channel.name) === -1)) {
      return channel.name
    }
    return this._name + ' ' + number
  }

  /** a further service of the same type, told apart by its subtype (the channel address) */
  addOutputService (OutputService, name, subtype, Characteristic) {
    const service = this.homeKitAccessory.getServiceById(OutputService, subtype) ||
      this.homeKitAccessory.addService(new OutputService(name, subtype))
    const nameCharacteristic = service.getCharacteristic(Characteristic.Name) || service.addCharacteristic(Characteristic.Name)
    nameCharacteristic.setValue(name)
    if (Characteristic.ConfiguredName) {
      const configured = service.getCharacteristic(Characteristic.ConfiguredName) || service.addCharacteristic(Characteristic.ConfiguredName)
      configured.setValue(name)
    }
    return service
  }

  /**
   * On (and OutletInUse) of one output: prefix '' for the channel of this accessory, 'N.' for the
   * combined channel N of the same device. Returns { on, inUse }.
   */
  createOutput (service, subType, prefix, Characteristic) {
    const self = this
    const onTime = this.getDeviceSettings().OnTime
    const readOnly = (prefix === '') ? this.isReadOnly() : this.isChannelReadOnly(prefix.slice(0, -1))
    this.log.debug('isReadonly %s', readOnly)
    const on = service.getCharacteristic(Characteristic.On)
    on.on('get', (callback) => {
      self.getValue(prefix + 'STATE', true).then(value => {
        callback(null, self.isTrue(value))
      }).catch(() => {
        callback(null, on.value === true)
      })
    })

    // without a power measurement an outlet is in use while it is switched on
    let inUse
    if (subType === 'Outlet') {
      inUse = service.getCharacteristic(Characteristic.OutletInUse)
        .on('get', (callback) => {
          self.getValue(prefix + 'STATE', true).then(value => {
            callback(null, self.isTrue(value))
          }).catch(() => {
            callback(null, inUse.value === true)
          })
        })
    }

    on.on('set', async (value, callback) => {
      if (!readOnly) {
        self.debugLog('[Switch] set switch %s%s', prefix, value)
        if ((value === true) && (onTime) && (parseFloat(onTime) > 0)) {
          self.debugLog('set onTime %s seconds', onTime)
          await self.setValue(prefix + 'ON_TIME', onTime)
        }
        self.debugLog('set value %s', value)
        self.setValue(prefix + 'STATE', (value === false) ? 0 : 1)
      } else {
        // check the state to reset the HomeKit State
        self.debugLog('[Switch] is readOnly .. skipping')
        setTimeout(() => {
          self.getValue(prefix + 'STATE', true)
        }, 1000)
      }
      callback()
    })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress(prefix + 'STATE'), (newValue) => {
      self.debugLog('[SWITCH] event state %s%s', prefix, newValue)
      if (prefix === '') {
        // Add a Log Entry for Eve
        self.addLogEntry({ status: self.isTrue(newValue) ? 1 : 0 })
        // Set Last Activation if the switch is on
        if (self.isTrue(newValue)) {
          self.updateLastActivation()
        }
      }
      on.updateValue(self.isTrue(newValue), null)
      if (inUse) {
        inUse.updateValue(self.isTrue(newValue), null)
      }
    })
    return { on, inUse }
  }

  static channelTypes () {
    // ALARMACTUATOR: HM-Sec-SFA-SM output, SWITCH_TRANSCEIVER: HmIP-FLC / HmIP-FDC outputs (both STATE)
    return ['SWITCH', 'STATUS_INDICATOR', 'SWITCH_VIRTUAL_RECEIVER', 'VIR-LG-ONOFF-CH', 'DIGITAL_OUTPUT', 'SIMPLE_SWITCH_RECEIVER', 'ALARMACTUATOR', 'SWITCH_TRANSCEIVER']
  }

  static serviceDescription () {
    return 'This service provides a switch'
  }

  static configurationItems () {
    return {
      Type: {
        type: 'option',
        array: ['Lightbulb', 'Outlet', 'Switch', 'Fan'],
        default: 'Lightbulb',
        label: 'Subtype of this device',
        hint: 'A switch can have different sub types'
      },
      OnTime: {
        type: 'number',
        default: 0,
        label: 'On Time',
        hint: 'HAP will switch off this device automatically after the given seconds. Set this to 0 to turn off this feature.'
      },
      // the other outputs of the device combined into this accessory; set by the new device dialog
      channels: {
        type: 'hidden'
      }
    }
  }
}

module.exports = HomeMaticSwitchAccessory
