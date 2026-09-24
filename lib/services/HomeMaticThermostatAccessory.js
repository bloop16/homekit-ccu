/*
 * File: HomeMaticThermostatAccessory.js
 * Project: homekit-ccu
 * File Created: Wednesday, 25th March 2020 10:01:00 am
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
const EveHomeKitValveTypes = require(path.join(__dirname, 'EveValve.js'))
const { Characteristic, Formats, Perms, Units, HapStatusError, HAPStatus } = require('@homebridge/hap-nodejs')

// SET_TEMPERATURE 4.5 means off; the devices only know 0.5 degree steps
const OFF_TEMPERATURE = 4.5
const DEFAULT_MAX_TEMPERATURE = 30.5
const TEMPERATURE_STEP = 0.5
// used when heating is switched on again and no temperature was remembered yet
const COMFORT_TEMPERATURE = 21
const LAST_TARGET_KEY = 'lastTargetTemperature'
// CONTROL_MODE of the BidCos thermostats
const HM_MODE_AUTO = 0
const HM_MODE_MANUAL = 1
const HM_MODE_PARTY = 2
const HM_MODE_BOOST = 3
// events of the device are ignored for a moment after HomeKit changed the mode (they arrive in several steps)
const MODE_LOCK_TIME = 2000

function toNumber (value) {
  if ((value === undefined) || (value === null) || (value === '') || (typeof value === 'boolean')) {
    return undefined
  }
  const number = (typeof value === 'number') ? value : parseFloat(value)
  return Number.isFinite(number) ? number : undefined
}

class HomeMaticThermostatAccessory extends HomeMaticAccessory {
  async publishServices (Service) {
    this.minSetTemp = OFF_TEMPERATURE
    this.maxSetTemp = DEFAULT_MAX_TEMPERATURE
    this.offTemp = OFF_TEMPERATURE
    this.currentTemperature = undefined
    this.currentHumidity = undefined
    this.targetTemperature = undefined
    this.controlMode = undefined
    this.modeBeforeBoost = HM_MODE_AUTO
    this.valveState = undefined
    this.unreachable = false
    const settings = this.getDeviceSettings()
    // the key has a typo, but that is how users have it stored
    this.addBoostMode = settings.addBootMode || false
    this.showSepHumidityTile = settings.showSepHumidityTile || false
    this.hasControlMode = (this.getDataPointNameFromSettings('ControlMode', null) !== undefined)

    this.service = this.addService(new Service.Thermostat(this._name))
    this.addHeatingStateCharacteristics()
    this.addTemperatureCharacteristics()
    // only fetch min max if we know where to get this
    if (this.getDataPointNameFromSettings('minTemp', null)) {
      this.getMinMaxTemp()
    }
    this.enableLoggingService('weather')
    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('SetTemperature', null, (newValue) => {
      this.debugLog('SetTemp Event %s', newValue)
      if (!this.lockModes) {
        this.processSetTempEvent(Characteristic, newValue)
      }
    })
    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('Temperature', null, (newValue) => {
      const value = toNumber(newValue)
      if (value === undefined) {
        return
      }
      this.currentTemperature = value
      this.debugLog('curTemperature Event is %s °C', value)
      this.curTemperatureChar.updateValue(value, null)
      this.updateHistory()
      this.updateHeatingStates()
    })
    if (this.addBoostMode) {
      this.addBoostSwitch(Service)
    }
    this.monitorUnreach()

    await Promise.all([this.addHumidity(Service), this.addValveState()])
    this.addLowBatCharacteristic()
  }

  addHeatingStateCharacteristics () {
    this.curHeatingState = this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .setProps({
        format: Formats.UINT8,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        maxValue: Characteristic.CurrentHeatingCoolingState.HEAT,
        validValues: [Characteristic.CurrentHeatingCoolingState.OFF, Characteristic.CurrentHeatingCoolingState.HEAT]
      })
      .on('get', (callback) => this.respond(callback, async () => {
        const modes = await this.calculateHeatingCoolingState(Characteristic)
        this.lastMode = modes.currentMode
        this.debugLog('getCurrentHeatingCoolingState %s', modes.currentMode)
        return modes.currentMode
      }))

    this.tarHeatingState = this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .on('get', (callback) => this.respond(callback, async () => {
        const modes = await this.calculateHeatingCoolingState(Characteristic)
        this.debugLog('getTargetHeatingCoolingState %s', modes.targetMode)
        return modes.targetMode
      }))

    if (!this.hasControlMode) {
      // the device has no modes (HM-CC-TC): it always heats to its setpoint
      this.tarHeatingState.setProps({ validValues: [Characteristic.TargetHeatingCoolingState.HEAT] })
      return
    }

    this.debugLog('Registering Control Mode Characteristic')
    this.tarHeatingState
      .setProps({
        format: Formats.UINT8,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY],
        validValues: [0, 1, 3]
      })
      .on('set', (newValue, callback) => this.execute(callback, async () => {
        this.debugLog('setTargetHeatingCoolingState (ControlMode) %s', newValue)
        await this.setControlMode(newValue)
        this.updateHeatingStates()
      }))

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('ControlMode', null, (newValue) => {
      this.processSetControlEvent(Characteristic, newValue)
    })
  }

  addTemperatureCharacteristics () {
    this.curTemperatureChar = this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', (callback) => this.respond(callback, async () => {
        this.assertReachable()
        const value = toNumber(await this.getValueForDataPointNameWithSettingsKey('Temperature', null, false))
        if (value !== undefined) {
          this.currentTemperature = value
        }
        this.debugLog('Current Temperature is %s', this.currentTemperature)
        return this.knownValue(this.currentTemperature, this.curTemperatureChar)
      }))

    this.tarTemperatureChar = this.service.getCharacteristic(Characteristic.TargetTemperature)
      .on('get', (callback) => this.respond(callback, async () => {
        if (this.targetTemperature === undefined) {
          this.targetTemperature = toNumber(await this.getValueForDataPointNameWithSettingsKey('SetTemperature', null, false))
        }
        this.debugLog('Target Temperature is %s', this.targetTemperature)
        return this.knownValue(this.clampTargetTemperature(this.targetTemperature), this.tarTemperatureChar)
      }))
      .on('set', (value, callback) => this.execute(callback, () => this.setTargetTemperature(value)))
      .setProps({ format: Formats.FLOAT, unit: Units.CELSIUS, perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY] })
    this.applyTargetTemperatureProps()

    this.service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .on('get', (callback) => callback(null, Characteristic.TemperatureDisplayUnits.CELSIUS))
  }

  async addHumidity (Service) {
    const hmDp = this.getDataPointNameFromSettings('Humidity', null)
    this.debugLog('check if datapoint for Humidity exists : %s', hmDp)
    if ((!hmDp) || (!await this._ccu.hazDatapoint(this.buildAddress(hmDp)))) {
      this.currentHumidity = 0
      return
    }
    if (this.showSepHumidityTile) {
      this.debugLog('add humidity as sep tile')
      this.humidityService = this.addService(new Service.HumiditySensor(this._name))
      this.curHumidity = this.humidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
    } else {
      this.debugLog('add humidity as service')
      this.curHumidity = this.service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
    }

    this.curHumidity.on('get', (callback) => this.respond(callback, async () => {
      const value = toNumber(await this.getValueForDataPointNameWithSettingsKey('Humidity', null, false))
      if (value !== undefined) {
        this.currentHumidity = value
      }
      return this.knownValue(this.currentHumidity, this.curHumidity)
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

  // VALVE_STATE of the HM-CC-RT-DN is the valve opening in percent (0..99)
  async addValveState () {
    const strValveState = this.getDataPointNameFromSettings('ValveState', null)
    if ((!strValveState) || (!await this._ccu.hazDatapoint(this.buildAddress(strValveState)))) {
      return
    }
    this.hasValveState = true
    const eveValve = new EveHomeKitValveTypes(this.gatoHomeBridge.hap)
    const eveThermo = new EveHomeKitThermoTypes(this.gatoHomeBridge.hap)
    this.service.addOptionalCharacteristic(eveValve.Characteristic.CurrentValveState)
    this.service.addOptionalCharacteristic(eveThermo.Characteristic.ValvePosition)
    const chValve = this.service.getCharacteristic(eveValve.Characteristic.CurrentValveState)
    const chPosition = this.service.getCharacteristic(eveThermo.Characteristic.ValvePosition)
    const readValve = async () => {
      const value = toNumber(await this.getValueForDataPointNameWithSettingsKey('ValveState', null, false))
      if (value !== undefined) {
        this.valveState = value
      }
      return this.valvePercent()
    }
    chValve.on('get', (callback) => this.respond(callback, readValve))
    chPosition.on('get', (callback) => this.respond(callback, readValve))

    this.registerAddressWithSettingsKeyForEventProcessingAtAccessory('ValveState', null, (newValue) => {
      const value = toNumber(newValue)
      if (value !== undefined) {
        this.valveState = value
        this.updateCharacteristic(chValve, this.valvePercent())
        this.updateCharacteristic(chPosition, this.valvePercent())
        this.updateHeatingStates()
      }
    })
  }

  addBoostSwitch (Service) {
    // the subtype keeps the switch paired users already have
    const boostService = this.getService(Service.Switch, this._name + ' Boost', false, 'Boost Mode')
    this.boostState = 0
    this.boostMode = boostService.getCharacteristic(Characteristic.On)
      .on('get', (callback) => this.respond(callback, async () => {
        const value = parseInt(await this.getValue('BOOST_STATE', false))
        if (Number.isFinite(value)) {
          this.boostState = value
        }
        return (this.boostState > 0)
      }))
      .on('set', (value, callback) => this.execute(callback, () => this.setBoostMode(value)))

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('BOOST_STATE'), (newValue) => {
      const value = parseInt(newValue)
      this.boostState = Number.isFinite(value) ? value : 0
      this.debugLog('BOOST STATE is %s (%s)', this.boostState, (this.boostState > 0))
      this.boostMode.updateValue((this.boostState > 0), null)
    })
  }

  async setBoostMode (value) {
    this.debugLog('hk boost command %s', value)
    if (value === true) {
      await this.setValue('BOOST_MODE', 1)
      return
    }
    if (this.modeBeforeBoost === HM_MODE_AUTO) {
      this.debugLog('boost is off restoring controlmode auto')
      await this.setValueForDataPointNameWithSettingsKey('SetAutoMode', null, this.getDataPointValueFromSettings('SetAutoMode'))
    } else {
      // MANU_MODE takes the temperature to hold
      const temperature = this.isOffTemperature(this.targetTemperature) || (this.targetTemperature === undefined)
        ? this.lastTargetTemperature()
        : this.clampTargetTemperature(this.targetTemperature)
      this.debugLog('boost is off restoring controlmode manu with %s', temperature)
      await this.setValueForDataPointNameWithSettingsKey('SetManuMode', null, temperature)
    }
  }

  // hap-nodejs 2 ignores Accessory.reachable; answering reads with an error makes Apple Home show "No Response"
  monitorUnreach () {
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('0.UNREACH'), (newValue) => {
      this.unreachable = this.isTrue(newValue)
    })
    Promise.resolve(this.getValue('0.UNREACH', false)).then((value) => {
      if ((value !== undefined) && (value !== null)) {
        this.unreachable = this.isTrue(value)
      }
    }).catch((e) => this.debugLog('unable to read UNREACH %s', e && e.message))
  }

  assertReachable () {
    if (this.unreachable) {
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
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
    return (this.valveState === undefined) ? 0 : Math.round(Math.min(100, Math.max(0, this.valveState)))
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
    return this.clampTargetTemperature(Math.round(temperature / TEMPERATURE_STEP) * TEMPERATURE_STEP)
  }

  applyTargetTemperatureProps () {
    this.tarTemperatureChar.setProps({ minValue: this.minSetTemp, maxValue: this.maxSetTemp, minStep: TEMPERATURE_STEP })
  }

  async setTargetTemperature (value) {
    const temperature = this.normalizeTargetTemperature(value)
    if (temperature === undefined) {
      throw new HapStatusError(HAPStatus.INVALID_VALUE_IN_REQUEST)
    }
    this.debugLog('set TargetTemperature Event from HomeKit with value %s °C', temperature)
    this.targetTemperature = temperature
    await this.setValueForDataPointNameWithSettingsKey('SetTemperature', null, temperature)
    this.rememberTargetTemperature(temperature)
  }

  // the last temperature above off is kept in the persistent store so switching on after a restart restores it
  rememberTargetTemperature (temperature) {
    if ((temperature === undefined) || (this.isOffTemperature(temperature))) {
      return
    }
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

  async getMinMaxTemp () {
    this.debugLog('Fetching setTemp boundaries from device')
    try {
      const deviceMasterData = await this._ccu.sendInterfaceCommand(this._interf, 'getParamset', [this._serial, 'MASTER'])
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

  async processSetTempEvent (Characteristic, newValue) {
    const value = toNumber(newValue)
    if ((value === undefined) || (this.lockModes)) {
      return
    }
    this.targetTemperature = value
    this.debugLog('setTemperature Event is %s °C', value)
    if (this.tarHeatingState) {
      const modes = await this.calculateHeatingCoolingState(Characteristic)
      this.lastMode = modes.currentMode
      this.updateCharacteristic(this.curHeatingState, modes.currentMode)
      this.updateCharacteristic(this.tarHeatingState, modes.targetMode)
    }
    this.updateCharacteristic(this.tarTemperatureChar, this.clampTargetTemperature(value))
  }

  async processSetControlEvent (Characteristic, newValue) {
    if (this.lockModes) {
      this.debugLog('event ControlMode ModeChange is locked due to manual set')
      return
    }
    this.debugLog('event ControlMode is %s', newValue)
    const mode = parseInt(newValue)
    if (!Number.isFinite(mode)) {
      return
    }
    this.controlMode = mode
    if (mode !== HM_MODE_BOOST) {
      this.modeBeforeBoost = mode
    }
    const modes = await this.calculateHeatingCoolingState(Characteristic)
    this.debugLog('processSetControlEvent set current Mode %s set targetMode %s', modes.currentMode, modes.targetMode)
    this.lastMode = modes.currentMode
    this.updateCharacteristic(this.curHeatingState, modes.currentMode)
    this.updateCharacteristic(this.tarHeatingState, modes.targetMode)
  }

  // fetches what no event told us yet
  async refreshState () {
    if (this.targetTemperature === undefined) {
      this.debugLog('unknown target temp request it...')
      this.targetTemperature = toNumber(await this.getValueForDataPointNameWithSettingsKey('SetTemperature', null, false))
    }
    if (this.currentTemperature === undefined) {
      this.debugLog('unknown current temp request it...')
      this.currentTemperature = toNumber(await this.getValueForDataPointNameWithSettingsKey('Temperature', null, false))
    }
    if ((this.controlMode === undefined) && (this.hasControlMode)) {
      await this.getControlMode()
    }
  }

  async calculateHeatingCoolingState () {
    await this.refreshState()
    this.debugLog('getting Mode from these Values : CT: %s  TT: %s CM: %s VS: %s',
      this.currentTemperature, this.targetTemperature, this.controlMode, this.valveState)
    return { currentMode: this.currentHeatingState(), targetMode: this.targetHeatingState() }
  }

  currentHeatingState () {
    const State = Characteristic.CurrentHeatingCoolingState
    if (this.isOffTemperature(this.targetTemperature)) {
      return State.OFF
    }
    if ((this.controlMode === HM_MODE_BOOST) || (this.boostState > 0)) {
      return State.HEAT
    }
    if ((this.hasValveState) && (this.valveState !== undefined)) {
      return (this.valveState > 0) ? State.HEAT : State.OFF
    }
    // no valve known: best guess from the temperatures
    if ((this.currentTemperature !== undefined) && (this.targetTemperature !== undefined)) {
      return (this.currentTemperature < this.targetTemperature) ? State.HEAT : State.OFF
    }
    return State.HEAT
  }

  targetHeatingState () {
    const State = Characteristic.TargetHeatingCoolingState
    if (!this.hasControlMode) {
      return State.HEAT
    }
    if (this.isOffTemperature(this.targetTemperature)) {
      return State.OFF
    }
    if ([HM_MODE_MANUAL, HM_MODE_PARTY, HM_MODE_BOOST].indexOf(this.controlMode) !== -1) {
      return State.HEAT
    }
    return State.AUTO
  }

  updateHeatingStates () {
    this.updateCharacteristic(this.curHeatingState, this.currentHeatingState())
    this.updateCharacteristic(this.tarHeatingState, this.targetHeatingState())
  }

  async getControlMode () {
    if (this.controlMode === undefined) {
      const mode = parseInt(await this.getValueForDataPointNameWithSettingsKey('ControlMode', null, true))
      if (Number.isFinite(mode)) {
        this.controlMode = mode
        if (mode !== HM_MODE_BOOST) {
          this.modeBeforeBoost = mode
        }
      }
    }
    return this.controlMode
  }

  // ignores the (partial) events the device sends while it follows a mode change from HomeKit
  lockModeEvents () {
    this.lockModes = true
    clearTimeout(this.lockTimer)
    this.lockTimer = setTimeout(() => {
      this.lockModes = false
      this.debugLog('unlock mode events')
    }, MODE_LOCK_TIME)
  }

  /**
   * @param {number} newMode HomeKit TargetHeatingCoolingState (0 off, 1 heat, 3 auto)
   */
  async setControlMode (newMode) {
    if (!this.hasControlMode) {
      return
    }
    await this.refreshState()
    this.debugLog('setControlMode %s', newMode)
    switch (newMode) {
      case Characteristic.TargetHeatingCoolingState.OFF:
        this.rememberTargetTemperature(this.targetTemperature)
        await this.switchToManualMode(this.offTemp)
        break

      case Characteristic.TargetHeatingCoolingState.HEAT: {
        // keep the current temperature, coming from off use the remembered one
        const temperature = ((this.targetTemperature === undefined) || (this.isOffTemperature(this.targetTemperature)))
          ? this.lastTargetTemperature()
          : this.normalizeTargetTemperature(this.targetTemperature)
        await this.switchToManualMode(temperature)
        break
      }

      case Characteristic.TargetHeatingCoolingState.AUTO:
        this.debugLog('setControlMode AUTO - Auto Mode')
        this.lockModeEvents()
        await this.setValueForDataPointNameWithSettingsKey('SetAutoMode', null, this.getDataPointValueFromSettings('SetAutoMode'))
        this.controlMode = HM_MODE_AUTO
        this.modeBeforeBoost = HM_MODE_AUTO
        break

      default:
        break
    }
  }

  // MANU_MODE switches to manual mode and sets the temperature to hold in one command
  async switchToManualMode (temperature) {
    this.debugLog('set manual mode with %s °C', temperature)
    this.lockModeEvents()
    this.targetTemperature = temperature
    this.controlMode = HM_MODE_MANUAL
    this.modeBeforeBoost = HM_MODE_MANUAL
    await this.setValueForDataPointNameWithSettingsKey('SetManuMode', null, temperature)
    this.updateCharacteristic(this.tarTemperatureChar, this.clampTargetTemperature(temperature))
  }

  updateHistory () {
    // do not add the first 0 after reboot
    if ((this.currentTemperature !== undefined) && (this.currentHumidity !== undefined)) {
      this.addLogEntry({ temp: this.currentTemperature, pressure: 0, humidity: this.currentHumidity })
    }
  }

  shutdown () {
    clearTimeout(this.lockTimer)
    super.shutdown()
  }

  static channelTypes () {
    return ['CLIMATECONTROL_RT_TRANSCEIVER', 'THERMALCONTROL_TRANSMIT', 'CLIMATECONTROL_REGULATOR']
  }

  static serviceDescription () {
    return 'This service provides a thermostat for HomeKit'
  }

  initServiceSettings () {
    return {
      '*': {
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        SetTemperature: { name: 'SET_TEMPERATURE' },
        ControlMode: { name: 'CONTROL_MODE' },
        // MANU_MODE takes the temperature to hold
        SetManuMode: { name: 'MANU_MODE' },
        SetAutoMode: { name: 'AUTO_MODE', value: 1 },
        Humidity: { name: 'ACTUAL_HUMIDITY' },
        ValveState: { name: 'VALVE_STATE' },
        minTemp: { name: 'TEMPERATURE_MINIMUM' },
        maxTemp: { name: 'TEMPERATURE_MAXIMUM' }
      },
      THERMALCONTROL_TRANSMIT: {
        Temperature: { name: 'ACTUAL_TEMPERATURE' },
        SetTemperature: { name: 'SET_TEMPERATURE' },
        Humidity: { name: 'ACTUAL_HUMIDITY' },
        ControlMode: { name: 'CONTROL_MODE' },
        SetManuMode: { name: 'MANU_MODE' },
        SetAutoMode: { name: 'AUTO_MODE', value: 1 },
        minTemp: { name: 'TEMPERATURE_MINIMUM' },
        maxTemp: { name: 'TEMPERATURE_MAXIMUM' }
      },
      CLIMATECONTROL_REGULATOR: {
        Temperature: { name: '1.TEMPERATURE' },
        SetTemperature: { name: '2.SETPOINT' },
        Humidity: { name: '1.HUMIDITY' }
      }
    }
  }

  static configurationItems () {
    return {
      addBootMode: {
        type: 'checkbox',
        default: false,
        label: 'Add a boost mode switch',
        hint: 'adds a switch to turn the boost mode on'
      },
      showSepHumidityTile: {
        type: 'checkbox',
        default: false,
        label: 'Show Humidity as separate tile',
        hint: 'this will remove the humidity sensor from the thermostat and will show the humidity as a separate tile'
      }

    }
  }

  static validate (configurationItem) {
    return false
  }
}

module.exports = HomeMaticThermostatAccessory
