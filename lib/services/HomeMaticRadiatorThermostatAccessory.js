/*
 * File: HomeMaticRadiatorThermostatAccessory.js
 * Project: homekit-ccu
 * File Created: Wednesday, 22nd April 2020 7:03:44 pm
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
const EveHomeKitThermoTypes = require(path.join(__dirname, 'EveThermo.js'))
const { Characteristic, Formats, Perms, HapStatusError, HAPStatus } = require('@homebridge/hap-nodejs')

// SET_POINT_TEMPERATURE 4.5 means off, 30.5 means fully open; the device only knows 0.5 degree steps
const OFF_TEMPERATURE = 4.5
const DEFAULT_MAX_TEMPERATURE = 30.5
const TEMPERATURE_STEP = 0.5
// used when heating is switched on again and no temperature was remembered yet
const COMFORT_TEMPERATURE = 21
const LAST_TARGET_KEY = 'lastTargetTemperature'
// values for CONTROL_MODE (write) and SET_POINT_MODE (read)
const HM_MODE_AUTO = 0
const HM_MODE_MANUAL = 1
const HM_MODE_PARTY = 2

function toNumber (value) {
  if ((value === undefined) || (value === null) || (value === '') || (typeof value === 'boolean')) {
    return undefined
  }
  const number = (typeof value === 'number') ? value : parseFloat(value)
  return Number.isFinite(number) ? number : undefined
}

function roundToStep (value, step) {
  return Math.round(value / step) * step
}

class HomeMaticRadiatorThermostatAccessory extends HomeMaticAccessory {
  async publishServices (Service) {
    this.offTemp = OFF_TEMPERATURE
    this.minSetTemp = OFF_TEMPERATURE
    this.maxSetTemp = DEFAULT_MAX_TEMPERATURE
    this.currentTemperature = undefined
    this.targetTemperature = undefined
    this.currentHumidity = 0
    this.controlMode = undefined
    this.valveLevel = undefined
    this.windowOpen = false
    this.boostActive = false
    this.hasValveLevel = false
    this.lastSetTemp = toNumber(this.getPersistentValue(LAST_TARGET_KEY))

    const settings = this.getDeviceSettings()
    this.addBoostMode = settings.addBoostMode || false

    this.service = this.addService(new Service.Thermostat(this._name))
    this.addHeatingStateCharacteristics()
    this.addTemperatureCharacteristics()
    this.getMinMaxTemp()
    this.enableLoggingService('weather')
    if (this.addBoostMode) {
      this.addBoostSwitch(Service)
    }
    this.registerEvents()

    await Promise.all([this.addHumidity(), this.addValveLevel()])
    this.addLowBatCharacteristic()
  }

  addHeatingStateCharacteristics () {
    this.curHeatingState = this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .setProps({
        maxValue: Characteristic.CurrentHeatingCoolingState.HEAT,
        validValues: [Characteristic.CurrentHeatingCoolingState.OFF, Characteristic.CurrentHeatingCoolingState.HEAT]
      })
      .on('get', (callback) => this.respond(callback, async () => (await this.calculateHeatingCoolingState()).currentMode))

    this.tarHeatingState = this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .on('get', (callback) => this.respond(callback, async () => (await this.calculateHeatingCoolingState()).targetMode))
      .on('set', (newValue, callback) => this.execute(callback, () => this.setTargetHeatingCoolingState(newValue)))
    // there is no cooling
    this.tarHeatingState.setProps({
      format: Formats.UINT8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY],
      validValues: [0, 1, 3]
    })
  }

  addTemperatureCharacteristics () {
    this.curTemperatureChar = this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', (callback) => this.respond(callback, async () => {
        const value = toNumber(await this.getValueForDataPointNameWithSettingsKey('Temperature', null, false))
        if (value !== undefined) {
          this.currentTemperature = value
        }
        return this.knownValue(this.currentTemperature, this.curTemperatureChar)
      }))

    this.tarTemperatureChar = this.service.getCharacteristic(Characteristic.TargetTemperature)
      .on('get', (callback) => this.respond(callback, async () => {
        const value = toNumber(await this.getValueForDataPointNameWithSettingsKey('SetTemperature', null, false))
        if (value !== undefined) {
          this.targetTemperature = value
        }
        return this.knownValue(this.clampTargetTemperature(this.targetTemperature), this.tarTemperatureChar)
      }))
      .on('set', (value, callback) => this.execute(callback, () => this.setTargetTemperature(value)))
    this.tarTemperatureChar.setProps({ format: Formats.FLOAT, perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY] })
    this.applyTargetTemperatureProps()

    this.service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .on('get', (callback) => callback(null, Characteristic.TemperatureDisplayUnits.CELSIUS))
  }

  addBoostSwitch (Service) {
    // the subtype keeps the switch paired users already have
    const boostService = this.getService(Service.Switch, this._name + ' Boost', false, 'Boost Mode')
    this.boostMode = boostService.getCharacteristic(Characteristic.On)
      .on('get', (callback) => this.respond(callback, async () => {
        const value = await this.getValueForDataPointNameWithSettingsKey('SetBoostMode', null, false)
        if ((value !== undefined) && (value !== null)) {
          this.boostActive = this.isTrue(value)
        }
        return this.boostActive
      }))
      .on('set', (value, callback) => this.execute(callback, () => this.setBoostMode(value)))
  }

  async addHumidity () {
    const dpn = this.getDataPointNameFromSettings('Humidity', null)
    if ((!dpn) || (!await this._ccu.hazDatapoint(this.buildAddress(dpn)))) {
      return
    }
    this.debugLog('%s exists', dpn)
    this.curHumidity = this.service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
      .on('get', (callback) => this.respond(callback, async () => {
        const value = toNumber(await this.getValueForDataPointNameWithSettingsKey('Humidity', null, false))
        if (value !== undefined) {
          this.currentHumidity = value
        }
        return this.currentHumidity
      }))

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('Humidity', null, (newValue) => {
      const value = toNumber(newValue)
      if (value !== undefined) {
        this.currentHumidity = value
        this.curHumidity.updateValue(value, null)
        this.updateHistory()
      }
    })
  }

  // radiator thermostats report how far the valve is open (LEVEL 0..1); wall thermostats and groups do not
  async addValveLevel () {
    const dpn = this.getDataPointNameFromSettings('ValveLevel', null)
    if ((!dpn) || (!await this._ccu.hazDatapoint(this.buildAddress(dpn)))) {
      return
    }
    this.hasValveLevel = true
    const eve = new EveHomeKitThermoTypes(this.gatoHomeBridge.hap)
    this.service.addOptionalCharacteristic(eve.Characteristic.ValvePosition)
    this.valvePositionChar = this.service.getCharacteristic(eve.Characteristic.ValvePosition)
      .on('get', (callback) => this.respond(callback, async () => {
        const value = toNumber(await this.getValueForDataPointNameWithSettingsKey('ValveLevel', null, false))
        if (value !== undefined) {
          this.valveLevel = value
        }
        return this.valvePercent()
      }))

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('ValveLevel', null, (newValue) => {
      const value = toNumber(newValue)
      if (value !== undefined) {
        this.valveLevel = value
        this.valvePositionChar.updateValue(this.valvePercent(), null)
        this.updateHeatingStates()
      }
    })
  }

  registerEvents () {
    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('SetTemperature', null, (newValue) => {
      const value = toNumber(newValue)
      if (value === undefined) {
        return
      }
      this.targetTemperature = value
      this.tarTemperatureChar.updateValue(this.clampTargetTemperature(value), null)
      this.updateHeatingStates()
    })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('Temperature', null, (newValue) => {
      const value = toNumber(newValue)
      if (value === undefined) {
        return
      }
      this.currentTemperature = value
      this.debugLog('Current temp event is %s', value)
      this.curTemperatureChar.updateValue(value, null)
      this.updateHistory()
      this.updateHeatingStates()
    })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('ControlMode', null, (newValue) => {
      const value = parseInt(newValue)
      if (Number.isFinite(value)) {
        this.controlMode = value
        this.updateHeatingStates()
      }
    })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('WindowState', null, (newValue) => {
      this.windowOpen = this.isTrue(newValue)
      this.debugLog('Window state event %s', this.windowOpen)
      this.updateHeatingStates()
    })

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('SetBoostMode', null, (newValue) => {
      this.boostActive = this.isTrue(newValue)
      this.debugLog('BOOST_MODE is %s', this.boostActive)
      if (this.boostMode) {
        this.boostMode.updateValue(this.boostActive, null)
      }
      this.updateHeatingStates()
    })
  }

  // answers a HomeKit read; errors become a HAP status instead of an unhandled rejection
  respond (callback, producer) {
    producer().then((value) => callback(null, value), (error) => {
      if (!(error instanceof HapStatusError)) {
        this.errorLog('unable to read from the CCU: %s', error && error.message)
      }
      callback(error)
    })
  }

  // runs a HomeKit write and reports failures back to HomeKit
  execute (callback, task) {
    task().then(() => callback(), (error) => {
      this.errorLog('unable to send to the CCU: %s', error && error.message)
      callback(error)
    })
  }

  knownValue (value, characteristic) {
    return (value !== undefined) ? value : characteristic.value
  }

  valvePercent () {
    if (this.valveLevel === undefined) {
      return 0
    }
    return Math.round(Math.min(1, Math.max(0, this.valveLevel)) * 100)
  }

  isOffTemperature (temperature) {
    return (temperature !== undefined) && (temperature <= this.offTemp)
  }

  clampTargetTemperature (temperature) {
    if (temperature === undefined) {
      return undefined
    }
    return Math.min(this.maxSetTemp, Math.max(this.minSetTemp, temperature))
  }

  normalizeTargetTemperature (value) {
    const temperature = toNumber(value)
    if (temperature === undefined) {
      return undefined
    }
    return this.clampTargetTemperature(roundToStep(temperature, TEMPERATURE_STEP))
  }

  applyTargetTemperatureProps () {
    this.tarTemperatureChar.setProps({
      minValue: this.minSetTemp,
      maxValue: this.maxSetTemp,
      minStep: TEMPERATURE_STEP
    })
  }

  async setTargetTemperature (value) {
    const temperature = this.normalizeTargetTemperature(value)
    if (temperature === undefined) {
      throw new HapStatusError(HAPStatus.INVALID_VALUE_IN_REQUEST)
    }
    this.targetTemperature = temperature
    await this.setValueForDataPointNameWithSettingsKey('SetTemperature', null, temperature)
    this.rememberTargetTemperature(temperature)
    this.debugLog('set TargetTemperature %s °C', temperature)
  }

  // the last temperature above off is kept in the persistent store so switching on after a restart restores it
  rememberTargetTemperature (temperature) {
    if ((temperature === undefined) || (this.isOffTemperature(temperature))) {
      return
    }
    this.lastSetTemp = temperature
    if (toNumber(this.getPersistentValue(LAST_TARGET_KEY)) !== temperature) {
      this.savePersistentValue(LAST_TARGET_KEY, temperature)
    }
  }

  lastTargetTemperature () {
    const stored = toNumber(this.getPersistentValue(LAST_TARGET_KEY))
    if ((stored === undefined) || (this.isOffTemperature(stored))) {
      return this.normalizeTargetTemperature(COMFORT_TEMPERATURE)
    }
    return this.normalizeTargetTemperature(stored)
  }

  async setTargetHeatingCoolingState (newValue) {
    await this.refreshState()
    switch (newValue) {
      case Characteristic.TargetHeatingCoolingState.OFF:
        this.debugLog('switch to manual mode and set temperature to %s', this.offTemp)
        if (!this.windowOpen) {
          this.rememberTargetTemperature(this.targetTemperature)
        }
        await this.setValueForDataPointNameWithSettingsKey('SetControlMode', null, HM_MODE_MANUAL)
        await this.setValueForDataPointNameWithSettingsKey('SetTemperature', null, this.offTemp)
        this.targetTemperature = this.offTemp
        break

      case Characteristic.TargetHeatingCoolingState.AUTO:
        this.debugLog('switch to auto mode')
        await this.setValueForDataPointNameWithSettingsKey('SetControlMode', null, HM_MODE_AUTO)
        break

      case Characteristic.TargetHeatingCoolingState.HEAT:
        this.debugLog('switch to manual mode')
        await this.setValueForDataPointNameWithSettingsKey('SetControlMode', null, HM_MODE_MANUAL)
        // coming from off: heat to the remembered temperature, unless the window is open (the device keeps its window temperature)
        if (((this.targetTemperature === undefined) || (this.isOffTemperature(this.targetTemperature))) && (!this.windowOpen)) {
          const temperature = this.lastTargetTemperature()
          this.debugLog('restore temperature %s', temperature)
          await this.setValueForDataPointNameWithSettingsKey('SetTemperature', null, temperature)
          this.targetTemperature = temperature
        }
        break

      default:
        break
    }
    this.updateHeatingStates()
  }

  async setBoostMode (value) {
    this.debugLog('hk boost command %s', value)
    if (value === true) {
      this.debugLog('set to auto mode and boost on')
      await this.setValueForDataPointNameWithSettingsKey('SetControlMode', null, HM_MODE_AUTO)
      await this.setValueForDataPointNameWithSettingsKey('SetBoostMode', null, true)
    } else {
      // switching to auto ends the boost https://github.com/thkl/hap-homematic/issues/91#issuecomment-636178214
      await this.setValueForDataPointNameWithSettingsKey('SetControlMode', null, HM_MODE_AUTO)
      if (this.controlMode !== HM_MODE_AUTO) {
        this.debugLog('boost is off restoring manual mode')
        await this.setValueForDataPointNameWithSettingsKey('SetControlMode', null, HM_MODE_MANUAL)
      }
    }
  }

  // fetches what no event told us yet
  async refreshState () {
    if (this.targetTemperature === undefined) {
      this.targetTemperature = toNumber(await this.getValueForDataPointNameWithSettingsKey('SetTemperature', null, true))
    }
    if (this.currentTemperature === undefined) {
      this.currentTemperature = toNumber(await this.getValueForDataPointNameWithSettingsKey('Temperature', null, true))
    }
    if (this.controlMode === undefined) {
      const mode = parseInt(await this.getValueForDataPointNameWithSettingsKey('ControlMode', null, true))
      this.controlMode = Number.isFinite(mode) ? mode : undefined
    }
    if ((this.hasValveLevel) && (this.valveLevel === undefined)) {
      this.valveLevel = toNumber(await this.getValueForDataPointNameWithSettingsKey('ValveLevel', null, true))
    }
  }

  async calculateHeatingCoolingState () {
    await this.refreshState()
    const result = { currentMode: this.currentHeatingState(), targetMode: this.targetHeatingState() }
    this.debugLog('modes from CT: %s TT: %s CM: %s LEVEL: %s window: %s -> %s',
      this.currentTemperature, this.targetTemperature, this.controlMode, this.valveLevel, this.windowOpen, JSON.stringify(result))
    return result
  }

  currentHeatingState () {
    const State = Characteristic.CurrentHeatingCoolingState
    if ((this.isOffTemperature(this.targetTemperature)) || (this.windowOpen)) {
      return State.OFF
    }
    if (this.boostActive) {
      return State.HEAT
    }
    if ((this.hasValveLevel) && (this.valveLevel !== undefined)) {
      return (this.valveLevel > 0) ? State.HEAT : State.OFF
    }
    // no valve (wall thermostat, group): best guess from the temperatures
    if ((this.currentTemperature !== undefined) && (this.targetTemperature !== undefined)) {
      return (this.currentTemperature < this.targetTemperature) ? State.HEAT : State.OFF
    }
    return State.OFF
  }

  targetHeatingState () {
    const State = Characteristic.TargetHeatingCoolingState
    if (this.isOffTemperature(this.targetTemperature)) {
      return State.OFF
    }
    if ((this.controlMode === HM_MODE_MANUAL) || (this.controlMode === HM_MODE_PARTY)) {
      return State.HEAT
    }
    return State.AUTO
  }

  updateHeatingStates () {
    this.curHeatingState.updateValue(this.currentHeatingState(), null)
    this.tarHeatingState.updateValue(this.targetHeatingState(), null)
  }

  async getMinMaxTemp () {
    this.debugLog('Fetching setTemp boundaries from device')
    try {
      // HmIP configuration data are located in the HEATING_CLIMATECONTROL_TRANSCEIVER channel
      const deviceMasterData = await this._ccu.sendInterfaceCommand(this._interf, 'getParamset', [this._serial + ':' + this._channelnumber, 'MASTER'])
      if (deviceMasterData) {
        const minimum = toNumber(deviceMasterData[this.getDataPointNameFromSettings('minTemp', null)])
        const maximum = toNumber(deviceMasterData[this.getDataPointNameFromSettings('maxTemp', null)])
        // 4.5 stays selectable, it is how HomeKit switches the thermostat off
        if (minimum !== undefined) {
          this.minSetTemp = Math.min(this.offTemp, minimum)
        }
        if ((maximum !== undefined) && (maximum > this.offTemp)) {
          this.maxSetTemp = maximum
        }
      }
    } catch (e) {
      this.debugLog('unable to fetch setTemp boundaries %s', e && e.message)
    }
    this.debugLog('min %s | max %s will be used in homekit for this device', this.minSetTemp, this.maxSetTemp)
    this.applyTargetTemperatureProps()
  }

  updateHistory () {
    if (this.currentTemperature !== undefined) {
      this.addLogEntry({ temp: this.currentTemperature, pressure: 0, humidity: this.currentHumidity })
    }
  }

  static channelTypes () {
    return ['HEATING_CLIMATECONTROL_TRANSCEIVER']
  }

  static serviceDescription () {
    return 'This service provides a thermostat for HomeKit'
  }

  initServiceSettings () {
    return {
      HEATING_CLIMATECONTROL_TRANSCEIVER: {
        voltage: 2.4,
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        Humidity: { name: 'HUMIDITY' },
        SetTemperature: { name: 'SET_POINT_TEMPERATURE' },
        ControlMode: { name: 'SET_POINT_MODE' },
        SetControlMode: { name: 'CONTROL_MODE' },
        SetBoostMode: { name: 'BOOST_MODE' },
        ValveLevel: { name: 'LEVEL' },
        minTemp: { name: 'TEMPERATURE_MINIMUM' },
        maxTemp: { name: 'TEMPERATURE_MAXIMUM' },
        WindowState: { name: 'WINDOW_STATE' }
      }
    }
  }

  static configurationItems () {
    return {
      addBoostMode: {
        type: 'checkbox',
        default: false,
        label: 'Add a boost mode switch',
        hint: 'adds a switch to turn the boost mode on'
      }
    }
  }
}

module.exports = HomeMaticRadiatorThermostatAccessory
