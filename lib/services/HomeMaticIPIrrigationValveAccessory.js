/*
 * File: HomeMaticIPIrrigationValveAccessory.js
 * Project: homekit-ccu
 * -----
 * HmIP-WSM / ELV-SH-WSM watering controller (WATER_SWITCH_VIRTUAL_RECEIVER, STATE) as a native
 * HomeKit irrigation valve.
 *   STATE (BOOL, read/write) -> Active and InUse; Active writes STATE
 *   SetDuration / RemainingDuration: HomeKit-CCU closes the valve after the run time set in
 *   HomeKit when HomeKit opened it (0 = no automatic close). The timer is cleared on shutdown.
 * StatusFault from the error datapoints of the maintenance channel, battery from LOW_BAT.
 * ==========================================================================
 */

const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const { numberOr, clamp, addFaultSources } = require(path.join(__dirname, 'NativeSupport.js'))

// HomeKit allows 0..3600 s for SetDuration and RemainingDuration
const MAX_DURATION = 3600
const DEFAULT_DURATION = 600
const FAULT_DATAPOINTS = ['0.ERROR_VALVE_FAILURE', '0.ERROR_WATER_FAILURE', '0.ERROR_OVERHEAT', '0.ERROR_UNDERVOLTAGE', '0.ERROR_FROST_PROTECTION']

class HomeMaticIPIrrigationValveAccessory extends HomeMaticAccessory {
  publishServices (Service, Characteristic) {
    const self = this
    this.Characteristic = Characteristic
    this.isOpen = false
    this.endTime = undefined // unix ms when the running HomeKit timer closes the valve

    const valve = this.getService(Service.Valve)
    valve.setPrimaryService()
    this.valve = valve

    valve.getCharacteristic(Characteristic.ValveType)
      .on('get', (callback) => callback(null, Characteristic.ValveType.IRRIGATION))
      .updateValue(Characteristic.ValveType.IRRIGATION)

    this.active = valve.getCharacteristic(Characteristic.Active)
      .on('get', async (callback) => {
        await self.fetchState()
        callback(null, self.isOpen ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      })
      .on('set', async (value, callback) => {
        const open = (parseInt(value) === Characteristic.Active.ACTIVE)
        self.debugLog('HomeKit %s the valve', open ? 'opens' : 'closes')
        try {
          await self.setValue('STATE', open)
          if (open) {
            self.startTimer()
          } else {
            self.stopTimer()
          }
          callback()
        } catch (e) {
          self.debugLog('unable to switch the valve: %s', e.message || e)
          callback(e)
        }
      })

    this.inUse = valve.getCharacteristic(Characteristic.InUse)
      .on('get', async (callback) => {
        await self.fetchState()
        callback(null, self.isOpen ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE)
      })

    // the run time set in the Home app wins over the configured default (0 is a valid choice)
    const saved = this._persistentValues.duration
    const initial = (saved !== undefined) ? saved : this.getDeviceSettings().duration
    this.duration = clamp(Math.round(numberOr(initial, DEFAULT_DURATION)), 0, MAX_DURATION)
    this.setDuration = valve.getCharacteristic(Characteristic.SetDuration)
      .on('get', (callback) => callback(null, self.duration))
      .on('set', (value, callback) => {
        self.duration = clamp(Math.round(numberOr(value, self.duration)), 0, MAX_DURATION)
        self.savePersistentValue('duration', self.duration)
        callback()
      })
    this.setDuration.updateValue(this.duration)

    this.remaining = valve.getCharacteristic(Characteristic.RemainingDuration)
      .on('get', (callback) => callback(null, self.remainingSeconds()))

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('STATE'), (newValue) => {
      self.applyState(self.isTrue(newValue))
    })

    addFaultSources(this, valve, FAULT_DATAPOINTS)
    this.addLowBatCharacteristic(0)
  }

  async fetchState () {
    try {
      const value = await this.getValue('STATE', true)
      if ((value !== undefined) && (value !== null) && (value !== '')) {
        this.isOpen = this.isTrue(value)
      }
    } catch (e) {
      this.debugLog('unable to read STATE: %s', e.message || e)
    }
    return this.isOpen
  }

  applyState (open) {
    const Characteristic = this.Characteristic
    this.isOpen = open
    if (!open) {
      this.stopTimer()
    }
    this.updateCharacteristic(this.active, open ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
    this.updateCharacteristic(this.inUse, open ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE)
  }

  remainingSeconds () {
    if (this.endTime === undefined) {
      return 0
    }
    return clamp(Math.round((this.endTime - Date.now()) / 1000), 0, MAX_DURATION)
  }

  startTimer () {
    clearTimeout(this.durationTimer)
    this.endTime = undefined
    if (this.duration > 0) {
      this.endTime = Date.now() + this.duration * 1000
      this.durationTimer = setTimeout(() => {
        this.debugLog('run time is over; closing the valve')
        this.endTime = undefined
        Promise.resolve(this.setValue('STATE', false))
          .catch(e => this.debugLog('unable to close the valve: %s', e.message || e))
        this.applyState(false)
      }, this.duration * 1000)
    }
    this.updateCharacteristic(this.remaining, this.remainingSeconds(), true)
  }

  stopTimer () {
    clearTimeout(this.durationTimer)
    this.durationTimer = undefined
    this.endTime = undefined
    this.updateCharacteristic(this.remaining, 0)
  }

  shutdown () {
    clearTimeout(this.durationTimer)
    super.shutdown()
  }

  static channelTypes () {
    return ['WATER_SWITCH_VIRTUAL_RECEIVER']
  }

  static serviceDescription () {
    return 'This service provides an irrigation valve in HomeKit'
  }

  static configurationItems () {
    return {
      duration: {
        type: 'number',
        default: DEFAULT_DURATION,
        label: 'Default run time (seconds)',
        hint: 'HomeKit closes the valve after this time when it opened it (0 to 3600, 0 = never). Can be changed in the Home app.'
      }
    }
  }
}

module.exports = HomeMaticIPIrrigationValveAccessory
