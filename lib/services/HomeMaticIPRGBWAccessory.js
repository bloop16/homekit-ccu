const path = require('path')
const HomeMaticDimmerAccessory = require(path.join(__dirname, 'HomeMaticDimmerAccessory.js'))

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
    return {}
  }

  initServiceSettings () {
    return {
      UNIVERSAL_LIGHT_RECEIVER: {
        level: { name: 'LEVEL' },
        working: { name: 'PROCESS' },
        hue: { name: 'HUE' },
        saturation: { name: 'SATURATION' },
        combined: { name: 'COMBINED_PARAMETER' }
      }
    }
  }

  static serviceDescription () {
    return 'This service provides a lightbulb where u can set level and color'
  }

  static validate (configurationItem) {
    return false
  }
}

module.exports = HomeMaticIPRGBWAccessory
