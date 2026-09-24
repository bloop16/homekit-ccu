const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))

module.exports = class HomeMaticDoorOpenerAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    const onTime = this.getDeviceSettings().OnTime || '10'

    this.debugLog('creating Service')
    this.service = this.getService(Service.LockMechanism)
    this.lockState = Characteristic.LockCurrentState.SECURED

    const lockCurrentState = this.service.getCharacteristic(Characteristic.LockCurrentState)
      .on('get', (callback) => {
        callback(null, self.lockState)
      })

    lockCurrentState.updateValue(this.lockState, null)

    const targetState = this.service.getCharacteristic(Characteristic.LockTargetState)

      .on('get', (callback) => {
        callback(null, self.lockState)
      })
      .on('set', async (value, callback) => {
        if (value !== Characteristic.LockTargetState.UNSECURED) {
          // the opener only opens; locking is what it does by itself after the on time
          self.debugLog('lock request ignored, the door opener locks by itself')
          callback()
          return
        }
        self.lockState = Characteristic.LockCurrentState.UNSECURED
        targetState.updateValue(self.lockState, null)
        lockCurrentState.updateValue(self.lockState, null)
        self.debugLog('open door lock')
        try {
          await self.setValue('ON_TIME', parseInt(onTime))
          self.setValue('STATE', 1)
        } catch (e) {
          self.debugLog('unable to open the door: %s', e.message || e)
        }
        callback()

        clearTimeout(self.lockTimer)
        self.lockTimer = setTimeout(() => {
          self.lockState = Characteristic.LockCurrentState.SECURED
          targetState.updateValue(self.lockState, null)
          lockCurrentState.updateValue(self.lockState, null)
        }, parseInt(onTime) * 1000)
      })

    targetState.updateValue(this.lockState, null)
  }

  shutdown () {
    clearTimeout(this.lockTimer)
    super.shutdown()
  }

  static getPriority () {
    return 1
  }

  static channelTypes () {
    return ['SWITCH', 'SWITCH_VIRTUAL_RECEIVER']
  }

  static serviceDescription () {
    return 'This service provides a door lock service which will actuate a switch'
  }

  static configurationItems () {
    return {
      OnTime: {
        type: 'number',
        default: 0,
        label: 'On Time',
        hint: 'HAP will switch off this device automatically after the given seconds. Default is 10 sec.'
      }
    }
  }
}
