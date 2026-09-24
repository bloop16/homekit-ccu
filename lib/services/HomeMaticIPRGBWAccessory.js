const path = require('path')
const HomeMaticDimmerAccessory = require(path.join(__dirname, 'HomeMaticDimmerAccessory.js'))

// HomeKit ColorTemperature is mired (1000000 / Kelvin), 140..500; the CCU uses Kelvin
const MIRED_KELVIN = 1000000
const HAP_MIN_MIRED = 140
const HAP_MAX_MIRED = 500
// white range of the device when its MASTER paramset tells nothing (eQ-3 defaults)
const DEFAULT_WARM_WHITE = 2000
const DEFAULT_COLD_WHITE = 6500
// HmIP-RGBW DEVICE_OPERATION_MODE (ENUM RGBW, RGB, 2_TUNABLE_WHITE, 4_PWM): only tunable white has a white channel
const TUNABLE_WHITE_MODES = [2, '2', '2_TUNABLE_WHITE']
// what the device supports is kept, so a restart publishes the same characteristics right away
const WHITE_CACHE_KEY = 'colorTemperature'

function positiveNumber (value) {
  const number = parseFloat(value)
  return (Number.isFinite(number) && (number > 0)) ? number : undefined
}

// mired range for the warm and cold white of the device (Kelvin), within what HomeKit accepts
function whiteRange (warmWhite, coldWhite) {
  const warm = positiveNumber(warmWhite) || DEFAULT_WARM_WHITE
  const cold = positiveNumber(coldWhite) || DEFAULT_COLD_WHITE
  const minMired = Math.min(HAP_MAX_MIRED, Math.max(HAP_MIN_MIRED, Math.ceil(MIRED_KELVIN / Math.max(warm, cold))))
  const maxMired = Math.min(HAP_MAX_MIRED, Math.max(minMired, Math.floor(MIRED_KELVIN / Math.min(warm, cold))))
  return { minMired, maxMired, warmWhite: Math.min(warm, cold), coldWhite: Math.max(warm, cold) }
}

function clamp (value, min, max) {
  return Math.min(max, Math.max(min, value))
}

class HomeMaticIPRGBWAccessory extends HomeMaticDimmerAccessory {
  publishServices (Service, Characteristic) {
    super.publishServices(Service, Characteristic)
    const self = this
    // HUE 0..360, SATURATION 0..1 at the CCU; HomeKit uses degrees and percent
    this.colorCharacteristic = this.service.getCharacteristic(Characteristic.Hue)
      .on('get', async (callback) => {
        const hue = await self.readNumber('hue')
        if (callback) callback(null, (hue === undefined) ? self.colorCharacteristic.value : hue)
      })
      .on('set', (value, callback) => {
        self.hue = value
        self.updateHMDevice()
        callback()
      })

    this.colorCharacteristic.eventEnabled = true

    this.saturationCharacteristic = this.service.getCharacteristic(Characteristic.Saturation)
      .on('get', async (callback) => {
        const saturation = await self.readNumber('saturation')
        if (callback) callback(null, (saturation === undefined) ? self.saturationCharacteristic.value : saturation * 100)
      })
      .on('set', (value, callback) => {
        self.saturation = value
        self.updateHMDevice()
        callback()
      })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('hue', null, async (newValue) => {
      self.debugLog('event on hue %s', newValue)
      const hue = parseFloat(newValue)
      if (Number.isFinite(hue)) {
        self.hue = hue
        self.updateCharacteristic(self.colorCharacteristic, hue)
      }
    })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('saturation', null, async (newValue) => {
      self.debugLog('event on saturation %s', newValue)
      const saturation = parseFloat(newValue)
      if (Number.isFinite(saturation)) {
        self.saturation = saturation * 100
        self.updateCharacteristic(self.saturationCharacteristic, saturation * 100)
      }
    })

    const setting = this.getDeviceSettings().colorTemperature
    const useWhite = ((setting === undefined) || (setting === null)) ? true : this.isTrue(setting)
    if (useWhite) {
      this.setupColorTemperature(Characteristic)
    }
  }

  // colour temperature next to hue and saturation; the CCU switches the lamp to white when
  // COLOR_TEMPERATURE is written and back to colour with hue and saturation
  async setupColorTemperature (Characteristic) {
    const cached = this.getPersistentValue(WHITE_CACHE_KEY)
    if ((cached) && (cached.supported === true)) {
      this.addColorTemperature(Characteristic, cached)
    } else if ((!cached) && (this._deviceType !== 'HmIP-RGBW')) {
      this.addColorTemperature(Characteristic, whiteRange())
    }
    const white = await this.readWhiteCapabilities()
    if (white === undefined) {
      return
    }
    if (white.supported) {
      this.addColorTemperature(Characteristic, white)
    } else {
      this.removeColorTemperature()
    }
    if (JSON.stringify(cached) !== JSON.stringify(white)) {
      this.savePersistentValue(WHITE_CACHE_KEY, white)
    }
  }

  // { supported, minMired, maxMired } from the MASTER paramsets; undefined when the CCU does not tell
  async readWhiteCapabilities () {
    let supported = true
    if (this._deviceType === 'HmIP-RGBW') {
      const device = await this.readMasterParamset(this._serial + ':0')
      if ((!device) || (device.DEVICE_OPERATION_MODE === undefined)) {
        return undefined
      }
      supported = TUNABLE_WHITE_MODES.includes(device.DEVICE_OPERATION_MODE)
    }
    if (!supported) {
      return { supported }
    }
    const channel = await this.readMasterParamset(this._serial + ':' + this._channelnumber) || {}
    return { supported, ...whiteRange(channel.HARDWARE_COLOR_TEMPERATURE_WARM_WHITE, channel.HARDWARE_COLOR_TEMPERATURE_COLD_WHITE) }
  }

  async readMasterParamset (address) {
    try {
      return await this._ccu.sendInterfaceCommand(this._interf, 'getParamset', [address, 'MASTER'])
    } catch (e) {
      this.debugLog('unable to read the MASTER paramset of %s: %s', address, e && e.message)
      return undefined
    }
  }

  addColorTemperature (Characteristic, range) {
    this.whiteRange = { ...whiteRange(range.warmWhite, range.coldWhite) }
    if (this.colorTemperatureCharacteristic) {
      this.applyWhiteRange()
      return
    }
    this.colorTemperatureCharacteristic = this.service.getCharacteristic(Characteristic.ColorTemperature)
      .on('get', async (callback) => {
        const kelvin = positiveNumber(await this.readNumber('colortemp'))
        callback(null, (kelvin === undefined) ? this.colorTemperatureCharacteristic.value : this.miredFor(kelvin))
      })
      .on('set', (value, callback) => {
        const kelvin = this.kelvinFor(value)
        this.debugLog('set colour temperature %s mired = %s K', value, kelvin)
        Promise.resolve(this.setValueForDataPointNameWithSettingsKey('colortemp', null, kelvin))
          .catch((e) => this.errorLog('unable to set the colour temperature: %s', e && e.message))
        callback()
      })
    this.applyWhiteRange()

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('colortemp', null, (newValue) => {
      // empty while the lamp shows a colour
      const kelvin = positiveNumber(newValue)
      if ((kelvin !== undefined) && (this.colorTemperatureCharacteristic)) {
        this.updateCharacteristic(this.colorTemperatureCharacteristic, this.miredFor(kelvin))
      }
    })
  }

  removeColorTemperature () {
    if (this.colorTemperatureCharacteristic) {
      this.service.removeCharacteristic(this.colorTemperatureCharacteristic)
      this.colorTemperatureCharacteristic = undefined
    }
  }

  applyWhiteRange () {
    const characteristic = this.colorTemperatureCharacteristic
    const { minMired, maxMired } = this.whiteRange
    const current = Number.isFinite(characteristic.value) ? characteristic.value : maxMired
    characteristic.updateValue(clamp(current, minMired, maxMired))
    characteristic.setProps({ minValue: minMired, maxValue: maxMired })
  }

  miredFor (kelvin) {
    return clamp(Math.round(MIRED_KELVIN / kelvin), this.whiteRange.minMired, this.whiteRange.maxMired)
  }

  kelvinFor (mired) {
    const value = positiveNumber(mired) || this.whiteRange.maxMired
    return clamp(Math.round(MIRED_KELVIN / value), this.whiteRange.warmWhite, this.whiteRange.coldWhite)
  }

  // a number from the CCU or undefined when there is no (valid) value
  async readNumber (settingsKey) {
    try {
      const value = parseFloat(await this.getValueForDataPointNameWithSettingsKey(settingsKey, null, false))
      return Number.isFinite(value) ? value : undefined
    } catch (e) {
      this.debugLog('unable to read %s: %s', settingsKey, e.message || e)
      return undefined
    }
  }

  // COMBINED_PARAMETER always carries level (percent), hue (degrees) and saturation (percent)
  updateHMDevice () {
    const brightness = parseFloat(this.levelCharacteristic.value) || 0
    const level = Math.round(this.recalcCCUValueForHomeKit(brightness) * 100)
    const hue = Math.round((this.hue !== undefined) ? this.hue : this.colorCharacteristic.value)
    const saturation = Math.round((this.saturation !== undefined) ? this.saturation : this.saturationCharacteristic.value)
    const value = `L=${level},H=${hue},SAT=${saturation},OT=0,RT=0,RTTDV=0,RTTDU=0`
    this.setValueForDataPointNameWithSettingsKey('combined', null, value)
  }

  static channelTypes () {
    return ['UNIVERSAL_LIGHT_RECEIVER']
  }

  static configurationItems () {
    return {
      colorTemperature: {
        type: 'checkbox',
        default: true,
        label: 'Use Color Temp',
        hint: 'adds the white colour temperature when the device supports it (HmIP-RGBW: tunable white mode only)'
      }
    }
  }

  initServiceSettings () {
    return {
      UNIVERSAL_LIGHT_RECEIVER: {
        level: { name: 'LEVEL' },
        working: { name: 'PROCESS' },
        hue: { name: 'HUE' },
        saturation: { name: 'SATURATION' },
        colortemp: { name: 'COLOR_TEMPERATURE' },
        combined: { name: 'COMBINED_PARAMETER' }
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a lightbulb where u can set level and color'
  }
}

module.exports = HomeMaticIPRGBWAccessory
