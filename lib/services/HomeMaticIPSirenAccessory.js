/*
 * File: HomeMaticIPSirenAccessory.js
 * Project: homekit-ccu
 * -----
 * HmIP-ASIR / -ASIR-2 / -ASIR-O / -ASIR-B1 alarm siren (channel 3 ALARM_SWITCH_VIRTUAL_RECEIVER).
 * HomeKit has no siren service, so the siren is ONE switch named '<name> Alarm':
 *   On  -> DURATION_UNIT S, DURATION_VALUE, OPTICAL_ALARM_SELECTION, ACOUSTIC_ALARM_SELECTION
 *          (the configured signals; the siren stops by itself after the duration)
 *   Off -> the same datapoints with duration 0 and DISABLE_OPTICAL_SIGNAL / DISABLE_ACOUSTIC_SIGNAL
 *   ACOUSTIC_ALARM_ACTIVE or OPTICAL_ALARM_ACTIVE -> On (the switch shows a running alarm)
 * Battery from LOW_BAT of the maintenance channel.
 * ==========================================================================
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { Characteristic } = require('@homebridge/hap-nodejs')
const { numberOr, clamp } = require(path.join(__dirname, 'NativeSupport.js'))

// VALUE_LISTs of the eQ-3 device definition; the index is the value written to the CCU
const ACOUSTIC_SIGNALS = ['DISABLE_ACOUSTIC_SIGNAL', 'FREQUENCY_RISING', 'FREQUENCY_FALLING', 'FREQUENCY_RISING_AND_FALLING',
  'FREQUENCY_ALTERNATING_LOW_HIGH', 'FREQUENCY_ALTERNATING_LOW_MID_HIGH', 'FREQUENCY_HIGHON_OFF', 'FREQUENCY_HIGHON_LONGOFF',
  'FREQUENCY_LOWON_OFF_HIGHON_OFF', 'FREQUENCY_LOWON_LONGOFF_HIGHON_LONGOFF']
const OPTICAL_SIGNALS = ['DISABLE_OPTICAL_SIGNAL', 'BLINKING_ALTERNATELY_REPEATING', 'BLINKING_BOTH_REPEATING',
  'DOUBLE_FLASHING_REPEATING', 'FLASHING_BOTH_REPEATING']
const DURATION_UNIT_SECONDS = 0
const MAX_DURATION = 16343 // DURATION_VALUE maximum
const DEFAULT_ACOUSTIC = 'FREQUENCY_RISING'
const DEFAULT_OPTICAL = 'BLINKING_ALTERNATELY_REPEATING'
const DEFAULT_DURATION = 180

// index of name in list, the index of fallback for an unknown name
function signalIndex (list, name, fallback) {
  const index = list.indexOf(name)
  return (index > -1) ? index : list.indexOf(fallback)
}

class HomeMaticIPSirenAccessory extends HomeMaticAccessory {
  publishServices (Service) {
    const self = this
    const settings = this.getDeviceSettings()
    this.acoustic = signalIndex(ACOUSTIC_SIGNALS, settings.acoustic, DEFAULT_ACOUSTIC)
    this.optical = signalIndex(OPTICAL_SIGNALS, settings.optical, DEFAULT_OPTICAL)
    this.duration = clamp(Math.round(numberOr(settings.duration, DEFAULT_DURATION)), 1, MAX_DURATION)
    this.acousticActive = false
    this.opticalActive = false

    const alarm = this.getService(Service.Switch, this._name + ' Alarm')
    this.alarmCharacteristic = alarm.getCharacteristic(Characteristic.On)
      .on('get', self.guardedGet(async (callback) => {
        await self.fetchActive()
        callback(null, self.isActive())
      }))
      .on('set', async (value, callback) => {
        try {
          if (self.isTrue(value)) {
            await self.startAlarm()
          } else {
            await self.stopAlarm()
          }
          callback()
        } catch (e) {
          self.debugLog('unable to switch the alarm: %s', e.message || e)
          callback(e)
        }
      })

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('ACOUSTIC_ALARM_ACTIVE'), (newValue) => {
      self.acousticActive = self.isTrue(newValue)
      self.updateCharacteristic(self.alarmCharacteristic, self.isActive())
    })
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('OPTICAL_ALARM_ACTIVE'), (newValue) => {
      self.opticalActive = self.isTrue(newValue)
      self.updateCharacteristic(self.alarmCharacteristic, self.isActive())
    })

    this.addLowBatCharacteristic(0)
  }

  isActive () {
    return (this.acousticActive === true) || (this.opticalActive === true)
  }

  async fetchActive () {
    for (const [dp, key] of [['ACOUSTIC_ALARM_ACTIVE', 'acousticActive'], ['OPTICAL_ALARM_ACTIVE', 'opticalActive']]) {
      try {
        const value = await this.getValue(dp, true)
        if ((value !== undefined) && (value !== null) && (value !== '')) {
          this[key] = this.isTrue(value)
        }
      } catch (e) {
        this.debugLog('unable to read %s: %s', dp, e.message || e)
      }
    }
  }

  // the selections are written last: writing them starts (or stops) the signal
  async sendAlarm (duration, optical, acoustic) {
    await this.setValue('DURATION_UNIT', DURATION_UNIT_SECONDS)
    await this.setValue('DURATION_VALUE', duration)
    await this.setValue('OPTICAL_ALARM_SELECTION', optical)
    await this.setValue('ACOUSTIC_ALARM_SELECTION', acoustic)
  }

  startAlarm () {
    this.debugLog('starting the alarm for %s s (acoustic %s, optical %s)', this.duration, ACOUSTIC_SIGNALS[this.acoustic], OPTICAL_SIGNALS[this.optical])
    return this.sendAlarm(this.duration, this.optical, this.acoustic)
  }

  stopAlarm () {
    this.debugLog('stopping the alarm')
    return this.sendAlarm(0, 0, 0)
  }

  static channelTypes () {
    return ['ALARM_SWITCH_VIRTUAL_RECEIVER']
  }

  static serviceDescription () {
    return 'This service provides a switch in HomeKit that sounds the siren: on starts the configured acoustic and optical alarm for the configured time, off stops it'
  }

  static configurationItems () {
    return {
      acoustic: {
        type: 'option',
        array: ACOUSTIC_SIGNALS,
        default: DEFAULT_ACOUSTIC,
        label: 'Acoustic signal',
        hint: 'Sound of the alarm; DISABLE_ACOUSTIC_SIGNAL for a silent alarm'
      },
      optical: {
        type: 'option',
        array: OPTICAL_SIGNALS,
        default: DEFAULT_OPTICAL,
        label: 'Optical signal',
        hint: 'Light signal of the alarm; DISABLE_OPTICAL_SIGNAL for no light'
      },
      duration: {
        type: 'number',
        default: DEFAULT_DURATION,
        label: 'Alarm duration (seconds)',
        hint: 'The siren stops by itself after this time (1 to 16343 seconds)'
      }
    }
  }
}

module.exports = HomeMaticIPSirenAccessory
