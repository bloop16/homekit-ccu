'use strict'

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { configureStillDoorbell } = require(path.join(__dirname, 'camera', 'stillDoorbell.js'))
const { IMAGE_SETTINGS, imageSources, refreshSeconds } = require(path.join(__dirname, 'camera', 'doorbellSettings.js'))
const { StillImage } = require(path.join(__dirname, '..', 'util', 'doorbellImage.js'))
const { createRingTrigger } = require(path.join(__dirname, '..', 'util', 'doorbellTrigger.js'))
const { isActionDatapoint } = require(path.join(__dirname, '..', 'util', 'regaBulkRead.js'))

/**
 * A doorbell in Apple Home that rings on any datapoint of the CCU: a key press (a push button,
 * a doorbell sensor) or a state that becomes active (a contact wired to the bell). Like the
 * doorbell service of a channel it has a camera with a still image and no live video.
 */
class HomeMaticSPDoorBellAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const datapoint = String(this.getDeviceSettings('address_door_bell_key') || '').trim()
    const setting = (key) => this.getDeviceSettings(key)
    this.stillImage = new StillImage(imageSources(setting, this.deviceTypeOf(datapoint)), this.log, this._name, { refreshSeconds: refreshSeconds(setting) })
    this.doorbell = configureStillDoorbell(this.homeKitAccessory, this.stillImage, this._name, this.log)
    if (!datapoint) {
      this.log.warn('[Doorbell %s] no datapoint for the ring configured', this._name)
      return
    }
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress(datapoint), createRingTrigger({
      isAction: isActionDatapoint(datapoint),
      ring: () => {
        this.debugLog('ring by %s', datapoint)
        this.doorbell.ring()
      }
    }))
  }

  // the device type of a datapoint like HmIP-RF.0002DD89A1B2C3:1.PRESS_SHORT, for its picture
  deviceTypeOf (datapoint) {
    const match = /^[^.]+\.([^.]+:\d+)\./.exec(datapoint)
    const channel = match ? this._ccu.getChannelByAddress(match[1]) : undefined
    return channel ? channel.dtype : undefined
  }

  static channelTypes () {
    return ['SPECIAL']
  }

  static serviceDescription () {
    return 'This service provides a doorbell in Apple Home that rings on a key press or when a state becomes active. Apple Home shows a doorbell only with a camera, so it gets a still image and no live video'
  }

  static configurationItems () {
    return {
      address_door_bell_key: {
        type: 'text',
        label: 'Datapoint that rings',
        selector: 'datapoint',
        hint: 'A key press (PRESS_SHORT) or a state (STATE) that becomes active',
        options: { filterChannels: ['KEY', 'KEY_TRANSCEIVER', 'VIRTUAL_KEY', 'MULTI_MODE_INPUT_TRANSMITTER', 'SWITCH_INTERFACE', 'SHUTTER_CONTACT', 'SHUTTER_CONTACT_TRANSCEIVER', 'CONTACT', 'SENSOR'] },
        mandatory: true
      },
      ...IMAGE_SETTINGS
    }
  }
}

module.exports = HomeMaticSPDoorBellAccessory
