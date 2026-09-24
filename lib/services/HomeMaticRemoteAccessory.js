/*
 * File: HomeMaticRemoteAccessory.js
 * Project: homekit-ccu
 * -----
 * The MIT License (MIT)
 * ==========================================================================
 *
 * A remote control or wall switch as Apple Home expects it: one accessory with a
 * StatelessProgrammableSwitch per key (ServiceLabelIndex 1..n) and a ServiceLabel service, so the
 * Home app shows "Button 1..n" with single and long press automations. It is mapped on one key
 * channel of the device and picks up all key channels of that device.
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { homeKitName } = require(path.join(__dirname, '..', 'util', 'homekitName.js'))
const { REMOTE_KEY_TYPES, channelNumberOf, remoteKeyChannels } = require(path.join(__dirname, '..', 'util', 'remoteMapping.js'))

// the CCU repeats PRESS_LONG while a key is held; a gap longer than this ends the hold
const LONG_PRESS_GAP_MS = 1000
// keeps the remote apart from a HomeMaticKeyAccessory with the same channel type and name
const UUID_PREFIX = 'Remote:'

class HomeMaticRemoteAccessory extends HomeMaticAccessory {
  constructor (channel, sInterface, server, settings = {}) {
    super(channel, sInterface, server, settings)
    this._device = this._ccu.getCCUDevices().find(device => device.address === this._serial)
    // the accessory is the whole device: without a name of its own it is named after the device
    if ((!settings.name) && (this._device) && (this._device.name)) {
      this._name = homeKitName(this._device.name, this._name)
    }
  }

  generateUUID (key) {
    return super.generateUUID(UUID_PREFIX + key)
  }

  publishServices (Service, Characteristic) {
    const labelService = this.getService(Service.ServiceLabel)
    labelService.getCharacteristic(Characteristic.ServiceLabelNamespace)
      .updateValue(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS)

    this.buttons = this.keyChannels().map((channel, position) =>
      this.addButton(channel, position + 1, Service, Characteristic))

    this.addLowBatCharacteristic()
  }

  /** the key channels of this device, or the mapped channel alone when the device is unknown */
  keyChannels () {
    const channels = remoteKeyChannels(this._device)
    if (channels.length > 0) {
      return channels
    }
    this.log.warn('[Remote] no key channels found for %s, using the mapped channel only', this._serial)
    return [{ address: this._serial + ':' + this._channelnumber, type: this._ccuType }]
  }

  /** the channel name set in the CCU, or "<accessory name> <index>" for a default channel name */
  buttonName (channel, index) {
    const fallback = this._name + ' ' + index
    const defaultName = this._deviceType + ' ' + channel.address
    if ((channel.name) && (defaultName.indexOf(channel.name) === -1)) {
      return homeKitName(channel.name, fallback)
    }
    return homeKitName(fallback, this._serial + ' ' + index)
  }

  addButton (channel, index, Service, Characteristic) {
    const channelNumber = channelNumberOf(channel.address)
    const service = this.getService(Service.StatelessProgrammableSwitch, this.buttonName(channel, index), true, 'button' + channelNumber)
    const labelIndex = service.testCharacteristic(Characteristic.ServiceLabelIndex)
      ? service.getCharacteristic(Characteristic.ServiceLabelIndex)
      : service.addCharacteristic(Characteristic.ServiceLabelIndex)
    labelIndex.updateValue(index)

    const keyEvent = service.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
    // HomeMatic reports short and long presses; a double press does not exist
    keyEvent.setProps({
      validValues: [Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS, Characteristic.ProgrammableSwitchEvent.LONG_PRESS]
    })

    const button = { index, channelNumber, keyEvent, longPressActive: false, longPressTimer: undefined }
    const { SINGLE_PRESS, LONG_PRESS } = Characteristic.ProgrammableSwitchEvent
    this.watchKey(button, 'PRESS_SHORT', () => { this.endLongPress(button); return SINGLE_PRESS })
    this.watchKey(button, 'PRESS_LONG', () => this.startLongPress(button) ? LONG_PRESS : undefined)
    this.watchKey(button, 'PRESS_LONG_RELEASE', () => { this.endLongPress(button); return undefined })
    return button
  }

  // true for the first PRESS_LONG of a hold, false for the repetitions
  startLongPress (button) {
    const isFirst = !button.longPressActive
    button.longPressActive = true
    clearTimeout(button.longPressTimer)
    button.longPressTimer = setTimeout(() => this.endLongPress(button), LONG_PRESS_GAP_MS)
    return isFirst
  }

  endLongPress (button) {
    clearTimeout(button.longPressTimer)
    button.longPressActive = false
  }

  // eventFor returns the HomeKit event to send for a CCU event, or undefined to send nothing
  async watchKey (button, datapoint, eventFor) {
    const address = this.buildAddress(button.channelNumber + '.' + datapoint)
    try {
      if (!(await this._ccu.hazDatapoint(address))) {
        this.debugLog('%s:%s.%s not found skipping', this._serial, button.channelNumber, datapoint)
        return
      }
    } catch (e) {
      this.log.error('[Remote] unable to check %s:%s.%s: %s', this._serial, button.channelNumber, datapoint, e.message || e)
      return
    }
    // registering fetches the current value once; that is no key press
    let initialQuery = !this.runsInTestMode
    this.registerAddressForEventProcessingAtAccessory(address, () => {
      if (initialQuery) {
        initialQuery = false
        this.debugLog('Scrub due initial query')
        return
      }
      const homeKitEvent = eventFor()
      if (homeKitEvent !== undefined) {
        this.debugLog('button %s %s event send %s', button.index, datapoint, homeKitEvent)
        this.updateCharacteristic(button.keyEvent, homeKitEvent, true)
      }
    })
  }

  shutdown () {
    (this.buttons || []).forEach(button => clearTimeout(button.longPressTimer))
    super.shutdown()
  }

  static channelTypes () {
    return REMOTE_KEY_TYPES.slice()
  }

  initServiceSettings () {
    return {
      'HmIP-KRCA': {
        voltage: 1.2
      }
    }
  }

  // HomeMaticKeyAccessory stays the default for key channels
  static getPriority () {
    return 1
  }

  static serviceDescription () {
    return 'This service provides a remote or wall switch as one HomeKit device with a button for every key of the device'
  }

  static filterDevice () {
    return ['HmIP-ASIR', 'HmIP-ASIR-B1', 'HmIP-ASIR-2', 'HmIP-ASIR-O', 'HmIP-BBL']
  }
}

module.exports = HomeMaticRemoteAccessory
