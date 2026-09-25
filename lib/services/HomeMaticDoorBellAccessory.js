/*
 * File: HomeMaticDoorBellAccessory.js
 * Project: homekit-ccu
 * File Created: Sunday, 29th March 2020 1:35:00 pm
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
const { configureStillDoorbell } = require(path.join(__dirname, 'camera', 'stillDoorbell.js'))
const { IMAGE_SETTINGS, imageSources, refreshSeconds } = require(path.join(__dirname, 'camera', 'doorbellSettings.js'))
const { StillImage } = require(path.join(__dirname, '..', 'util', 'doorbellImage.js'))
const { createRingTrigger } = require(path.join(__dirname, '..', 'util', 'doorbellTrigger.js'))

// CHANNEL_OPERATION_MODE of a multi mode input (HmIP-DSD-PCB, HmIP-FCI1, ...): the CCU returns the
// index into INACTIVE, KEY_BEHAVIOR, SWITCH_BEHAVIOR, BINARY_BEHAVIOR; in switch and contact mode
// the channel reports STATE instead of key presses
const STATE_MODES = [2, 3, '2', '3', 'SWITCH_BEHAVIOR', 'BINARY_BEHAVIOR']
const KEY_DATAPOINTS = ['PRESS_SHORT', 'PRESS_LONG', 'PRESS']

/**
 * A doorbell button of the CCU as a doorbell in Apple Home. Apple Home shows a doorbell only as
 * part of a camera, so the doorbell gets a camera with a still image (the picture of the device,
 * or a configured one) and no live video.
 */
class HomeMaticDoorBellAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const setting = (key) => this.getDeviceSettings(key)
    this.stillImage = new StillImage(imageSources(setting, this._deviceType), this.log, this._name, { refreshSeconds: refreshSeconds(setting) })
    this.doorbell = configureStillDoorbell(this.homeKitAccessory, this.stillImage, this._name, this.log)
    this.watchRing()
    this.addLowBatCharacteristic()
  }

  async watchRing () {
    const datapoints = (await this.ringsOnState()) ? ['STATE'] : KEY_DATAPOINTS
    for (const datapoint of datapoints) {
      const address = this.buildAddress(datapoint)
      if (await this._ccu.hazDatapoint(address)) {
        this.registerAddressForEventProcessingAtAccessory(address, createRingTrigger({
          isAction: datapoint !== 'STATE',
          ring: () => {
            this.debugLog('ring by %s', datapoint)
            this.doorbell.ring()
          }
        }))
      }
    }
  }

  // true when the channel reports STATE (switch or contact mode), false for key presses
  async ringsOnState () {
    try {
      const master = await this._ccu.sendInterfaceCommand(this._interf, 'getParamset', [this._serial + ':' + this._channelnumber, 'MASTER'])
      return STATE_MODES.includes(master && master.CHANNEL_OPERATION_MODE)
    } catch (e) {
      this.debugLog('unable to read the channel mode, taking key presses: %s', e && e.message)
      return false
    }
  }

  static channelTypes () {
    return ['KEY', 'VIRTUAL_KEY', 'SWITCH_INTERFACE', 'MULTI_MODE_INPUT_TRANSMITTER', 'KEY_TRANSCEIVER']
  }

  static configurationItems () {
    return { ...IMAGE_SETTINGS }
  }

  static serviceDescription () {
    return 'This service provides a doorbell in Apple Home: it rings on a key press of the channel (or when its state becomes active in switch or contact mode). Apple Home shows a doorbell only with a camera, so it gets a still image and no live video'
  }

  static filterDevice () {
    return ['HmIP-ASIR', 'HmIP-ASIR-B1', 'HmIP-ASIR-2', 'HmIP-ASIR-O', 'HmIP-BBL']
  }

  static getPriority () {
    return 1
  }
}

module.exports = HomeMaticDoorBellAccessory
