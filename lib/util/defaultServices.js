'use strict'

/*
 * The native HomeKit service class of a channel.
 *
 * Several service classes support the same channel type (a KEY can be a programmable switch,
 * a self-resetting switch, a doorbell, ...). The first class of a channel's list is the default:
 * the server uses it for a channel without a stored service and the configuration UI preselects
 * it for a new mapping. DEFAULT_SERVICES names that default explicitly; every other class
 * follows in a stable order (priority, then class name).
 *
 * Keys: 'DEVICETYPE:CHANNELTYPE', 'DEVICETYPEPREFIX*:CHANNELTYPE' or 'CHANNELTYPE'.
 * Values: class names in order of preference. A class that does not exist (yet) or does not
 * support the channel is simply skipped, so the next preference becomes the default.
 */

const KEY = 'HomeMaticKeyAccessory'
const REMOTE_KEY = ['HomeMaticRemoteAccessory', KEY]
// Apple Home shows a doorbell without a camera as "not supported": the bell button is a
// programmable switch, the doorbell service stays available (e.g. next to a video doorbell)
const DOORBELL = [KEY, 'HomeMaticDoorBellAccessory']
const CONTACT = ['HomeMaticContactSensorAccessory']
const ROTARY_CONTACT = ['HomeMaticRotarySensorAccessory']
const THERMOSTAT = ['HomeMaticRadiatorThermostatAccessory']
const CLIMATE_SENSOR = ['HomeMaticThermometerAccessory']
const SWITCH = ['HomeMaticSwitchAccessory']
const HEATING = 'HEATING_CLIMATECONTROL_TRANSCEIVER'

const DEFAULT_SERVICES = Object.freeze({
  // push buttons and remotes: a stateless programmable switch, not a self-resetting switch
  KEY: REMOTE_KEY,
  KEY_TRANSCEIVER: REMOTE_KEY,
  VIRTUAL_KEY: [KEY],
  // the virtual keys of the CCU: a programmable switch per key, not one remote with 50 buttons
  'HmIP-RCV-50:KEY_TRANSCEIVER': [KEY],
  'HM-RCV-50:KEY': [KEY],
  'HMW-RCV-50:KEY': [KEY],
  SWITCH_INTERFACE: [KEY],
  // doorbell buttons
  'HmIP-DSD-PCB:MULTI_MODE_INPUT_TRANSMITTER': DOORBELL,
  'HmIP-DBB:KEY_TRANSCEIVER': DOORBELL,
  'HM-Sen-DB-PCB:KEY': DOORBELL,
  // read-only contacts: a contact sensor, not a motorised window or door
  MULTI_MODE_INPUT_TRANSMITTER: CONTACT,
  CONTACT,
  SHUTTER_CONTACT: CONTACT,
  SHUTTER_CONTACT_TRANSCEIVER: CONTACT,
  TILT_SENSOR: CONTACT,
  SENSOR: CONTACT,
  'HMW-Sen-SC-12-DR:SENSOR': CONTACT,
  ROTARY_HANDLE_SENSOR: ROTARY_CONTACT,
  ROTARY_HANDLE_TRANSCEIVER: ROTARY_CONTACT,
  // thermostats (wall thermostats as well: a thermostat with humidity, not a thermometer)
  [HEATING]: THERMOSTAT,
  ['HmIP-WTH*:' + HEATING]: THERMOSTAT,
  ['HmIP-STHD:' + HEATING]: THERMOSTAT,
  ['HmIP-BWTH*:' + HEATING]: THERMOSTAT,
  ['HmIPW-WTH*:' + HEATING]: THERMOSTAT,
  ['ALPHA-IP-RBG*:' + HEATING]: THERMOSTAT,
  // temperature and humidity sensors without controls
  ['HmIP-STH:' + HEATING]: CLIMATE_SENSOR,
  CLIMATE_TRANSCEIVER: CLIMATE_SENSOR,
  WEATHER: CLIMATE_SENSOR,
  WEATHER_TRANSMIT: CLIMATE_SENSOR,
  // switch actuators (the switch type of a new mapping: util/newMappingDefaults.js)
  SWITCH,
  SWITCH_VIRTUAL_RECEIVER: SWITCH,
  SIMPLE_SWITCH_RECEIVER: SWITCH,
  DIGITAL_OUTPUT: SWITCH,
  POWERMETER: ['HomeMaticPowerMeterSwitchAccessory'],
  ENERGIE_METER_TRANSMITTER: ['HomeMaticIPPowerMeterSwitchAccessory'],
  // sensors
  PRESENCEDETECTOR_TRANSCEIVER: ['HomeMaticOccupancyAccessory', 'HomeMaticPresenceAccessory'],
  RAINDETECTOR: ['HomeMaticRainLeakAccessory', 'HomeMaticRainDetectorAccessory'],
  SMOKE_DETECTOR: ['HomeMaticIPSmokeDetectorAccessory', 'HomeMaticSmokeDetectorAccessory'],
  // variables: a switch for boolean variables (the class decides per value type)
  VARIABLE: ['HomeMaticVariableAccessory']
})

// 'HmIP-WTH*:TYPE' entries as { prefix, channelType, services }, the longest prefix first
const PREFIX_ENTRIES = Object.keys(DEFAULT_SERVICES)
  .filter(key => /^[^:]+\*:/.test(key))
  .map(key => {
    const [devicePattern, channelType] = key.split(':')
    return { prefix: devicePattern.slice(0, -1), channelType, services: DEFAULT_SERVICES[key] }
  })
  .sort((a, b) => b.prefix.length - a.prefix.length)

/** preferences for this device type and channel type (exact entry, then device type prefix) */
function devicePreferences (channelType, deviceType) {
  if (!deviceType) {
    return []
  }
  const exact = DEFAULT_SERVICES[deviceType + ':' + channelType]
  if (exact) {
    return exact
  }
  const byPrefix = PREFIX_ENTRIES.find(entry => entry.channelType === channelType && deviceType.startsWith(entry.prefix))
  return byPrefix ? byPrefix.services : []
}

/** preferences for every device with this channel type */
function channelPreferences (channelType) {
  return DEFAULT_SERVICES[channelType] || []
}

/** the preferred class names of a channel, the device type specific ones win */
function preferredServices (channelType, deviceType) {
  const byDevice = devicePreferences(channelType, deviceType)
  return (byDevice.length > 0) ? byDevice : channelPreferences(channelType)
}

/** stable order: lower priority value first, then the class name */
function compareServices (a, b) {
  const pa = Number(a.priority) || 0
  const pb = Number(b.priority) || 0
  if (pa !== pb) {
    return pa - pb
  }
  if (a.serviceClazz === b.serviceClazz) {
    return 0
  }
  return (a.serviceClazz < b.serviceClazz) ? -1 : 1
}

function uniqueByClass (list) {
  return list.filter((entry, index) => list.findIndex(other => other.serviceClazz === entry.serviceClazz) === index)
}

/** the entries of list named in preferences (in preference order), then the others in stable order */
function preferredFirst (list, preferences) {
  const preferred = preferences
    .map(name => list.find(entry => entry.serviceClazz === name))
    .filter(entry => entry !== undefined)
  const others = list.filter(entry => !preferred.includes(entry)).sort(compareServices)
  return [...preferred, ...others]
}

/**
 * Orders the service list of one key of the service table ('CHANNELTYPE' or
 * 'DEVICETYPE:CHANNELTYPE'); returns a new list without duplicate classes.
 */
function orderServiceList (list, key) {
  const separator = key.lastIndexOf(':')
  const channelType = (separator > -1) ? key.slice(separator + 1) : key
  const deviceType = (separator > -1) ? key.slice(0, separator) : undefined
  return preferredFirst(uniqueByClass(list || []), preferredServices(channelType, deviceType))
}

/**
 * All service classes for a channel in default order: the device type preference, the classes
 * made for this device type, the channel type preference, then every other class of the channel
 * type the device is not filtered from.
 * @param serviceTable { 'CHANNELTYPE' | 'DEVICETYPE:CHANNELTYPE': [{ serviceClazz, priority, filterDevice }] }
 */
function orderedServicesForChannel (serviceTable, deviceType, channelType) {
  const table = serviceTable || {}
  const specific = uniqueByClass(table[deviceType + ':' + channelType] || [])
  const generic = uniqueByClass((table[channelType] || [])
    .filter(entry => !(entry.filterDevice || []).includes(deviceType))
    .filter(entry => !specific.some(other => other.serviceClazz === entry.serviceClazz)))
  const all = [...specific, ...generic]
  const deviceChosen = devicePreferences(channelType, deviceType)
    .map(name => all.find(entry => entry.serviceClazz === name))
    .filter(entry => entry !== undefined)
  const rest = (list) => list.filter(entry => !deviceChosen.includes(entry))
  return [
    ...deviceChosen,
    ...rest(specific).sort(compareServices),
    ...preferredFirst(rest(generic), channelPreferences(channelType))
  ]
}

/** the default service class name of a channel, undefined if no class supports it */
function defaultServiceFor (serviceTable, deviceType, channelType) {
  const list = orderedServicesForChannel(serviceTable, deviceType, channelType)
  return (list.length > 0) ? list[0].serviceClazz : undefined
}

module.exports = {
  DEFAULT_SERVICES,
  preferredServices,
  compareServices,
  orderServiceList,
  orderedServicesForChannel,
  defaultServiceFor
}
