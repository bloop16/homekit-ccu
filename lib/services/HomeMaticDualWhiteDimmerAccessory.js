const path = require('path')
const HomeMaticDimmerAccessory = require(path.join(__dirname, 'HomeMaticDimmerAccessory.js'))

class HomeMaticDualWhiteDimmerAccessory extends HomeMaticDimmerAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    super.publishServices(Service, Characteristic)

    this.colorCharacteristic = this.service.getCharacteristic(Characteristic.ColorTemperature)
      .on('get', async (callback) => {
        let level
        try {
          level = parseFloat(await self.getValueForDataPointNameWithSettingsKey('coltemp', null, true))
        } catch (e) {
          self.debugLog('unable to read the colour temperature: %s', e.message || e)
        }
        // keep the last value while the CCU has no (valid) level
        callback(null, Number.isFinite(level) ? self.miredFromLevel(level) : self.colorCharacteristic.value)
      })
      .on('set', async (value, callback) => {
        // Level is between 140 - 500
        const x = 1.0 - (parseFloat(value) - 140) / 360
        await self.setValueForDataPointNameWithSettingsKey('coltemp', null, x)
        if (callback) {
          callback()
        }
      })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('coltemp', null, (newValue) => {
      const level = parseFloat(newValue)
      if (Number.isFinite(level)) {
        self.updateCharacteristic(self.colorCharacteristic, self.miredFromLevel(level))
      }
    })
  }

  // LEVEL of the colour channel: 0 = warm (500 mired) ... 1 = cold (140 mired)
  miredFromLevel (level) {
    return ((1.0 - level) * 360) + 140
  }

  static channelTypes () {
    return ['DUAL_WHITE_BRIGHTNESS']
  }

  initServiceSettings () {
    return {
      DUAL_WHITE_BRIGHTNESS: {
        level: { name: '1.LEVEL' },
        coltemp: { name: '2.LEVEL' },
        working: { name: 'WORKING' },
        ramp: { name: 'RAMP_TIME' }
      }
    }
  }
}

module.exports = HomeMaticDualWhiteDimmerAccessory
