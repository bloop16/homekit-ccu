/*
 * File: HomeMaticSPCCUTempAccessory.js
 * Project: homekit-ccu
 * File Created: Wednesday, 29th April 2020 4:23:16 pm
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
const { HAPStatus, HapStatusError } = require('@homebridge/hap-nodejs')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { findTemperatureSource, readTemperature } = require(path.join(__dirname, '..', 'util', 'cpuTemperature.js'))

class HomeMaticSPCCUTempAccessory extends HomeMaticAccessory {
  constructor (channel, sInterface, server, settings = {}) {
    super(channel, sInterface, server, settings)
    this._ccuType = 'WEATHER'
  }

  publishServices (Service, Characteristic) {
    const self = this

    this.thermometer = this.getService(Service.TemperatureSensor)
    this.enableLoggingService('weather')

    this.cctemp = this.thermometer.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100
      })
      .on('get', (callback) => {
        const temperature = self.readTemperature()
        if (temperature === undefined) {
          // no temperature on this system (a virtual machine): no answer instead of a made-up value
          callback(new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE))
          return
        }
        callback(null, temperature)
      })

    this.cctemp.eventEnabled = true
    if (this.readTemperature() === undefined) {
      this.log.warn('[%s] this system has no CPU temperature (a virtual machine has none), the sensor shows no value', this._name)
    }
    this.queryData()
  }

  queryData () {
    const self = this
    const temperature = this.readTemperature()
    if ((this.cctemp) && (temperature !== undefined)) {
      this.cctemp.updateValue(temperature, null)
      this.addLogEntry({ temp: temperature, pressure: 0, humidity: 1 })
    }

    this.refreshTimer = setTimeout(() => {
      self.queryData()
    }, 5 * 60 * 1000)
  }

  // degrees Celsius, undefined when the system has no temperature
  readTemperature () {
    return readTemperature(findTemperatureSource(HomeMaticSPCCUTempAccessory.sysfsRoot))
  }

  shutdown () {
    clearTimeout(this.refreshTimer)
    super.shutdown()
  }

  // offered only where there is a temperature to show
  static isAvailable () {
    return findTemperatureSource(HomeMaticSPCCUTempAccessory.sysfsRoot) !== undefined
  }

  static channelTypes () {
    return ['SPECIAL']
  }

  static serviceDescription () {
    return 'This service provides a thermometer which will show your current ccu processor temperature'
  }

  static configurationItems () {
    return {
      showGraph: {
        type: 'option',
        array: ['DONT_SHOW', 'temp'],
        default: 'DONT_SHOW',
        label: 'Show graph',
        hint: 'Show measured values as graph on the frontpage'
      }
    }
  }
}

HomeMaticSPCCUTempAccessory.sysfsRoot = '/sys'

module.exports = HomeMaticSPCCUTempAccessory
