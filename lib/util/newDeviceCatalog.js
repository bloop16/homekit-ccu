'use strict'

/*
 * The device catalog of the "new device" dialog.
 *
 * The dialog lists devices, not channels: each compatible CCU device with its rooms and the
 * channels HomeKit-CCU can publish. Per channel it says which service classes fit (native
 * default first, see util/defaultServices.js), whether the channel is already in HomeKit and
 * whether it is a secondary channel the dialog folds away and whether choosing the whole device
 * ticks it (see isPreselected):
 *
 * - HomematicIP actuators have three virtual channels per output (e.g. HmIP-BSM 4, 5, 6). The
 *   first one follows the output as the CCU links it, the other two only matter for users who
 *   combine several links in the CCU. Home Assistant (Homematic(IP) Local) disables them by
 *   default for the same reason.
 * - The keys of a remote or wall button form one group: a remote is one HomeKit accessory with
 *   a button per key (util/remoteMapping.js), mapped on the first key of the device. The virtual
 *   keys of the CCU (HM-RCV-50, HmIP-RCV-50) are no remote, each key stays a row of its own.
 *
 * For the filters of the dialog a device also carries its CCU rooms and functions ("Gewerke"),
 * a category from its main service class, its radio system and the WebUI picture of its type
 * (util/deviceIcons.js).
 */

const path = require('path')
const { orderedServicesForChannel } = require(path.join(__dirname, 'defaultServices.js'))
const { withNativeSettingDefaults } = require(path.join(__dirname, 'newMappingDefaults.js'))
const { REMOTE_SERVICE, channelNumberOf, isRemoteKeyType, isCoveredByRemote } = require(path.join(__dirname, 'remoteMapping.js'))
const { deviceIcons } = require(path.join(__dirname, 'deviceIcons.js'))

const VIRTUAL_RECEIVER = /_VIRTUAL_RECEIVER$/
const METER_TYPES = ['ENERGIE_METER_TRANSMITTER', 'POWERMETER']
const VIRTUAL_KEY_DEVICE = /^(HM|HMW|HmIP)-RCV-\d+$/i

// the category of a device by the service class of its main channel, the first match wins
const CATEGORIES = [
  ['button', /Remote|Key(?!Matic)|PushTheButton|DoorBell/],
  ['light', /Dimmer|RGB|DualWhite|LightBulb/i],
  ['cover', /Blind|Winmatic|WindowDrive|GarageDoor|Door(?!Lock|Bell|Opener)/],
  ['security', /KeyMatic|DoorLock|Smoke|Alarm|Siren|Contact|Window|Rotary|Acceleration/],
  ['climate', /Thermostat|Thermo|Therm|Humidity|CO2|AirQuality|Weather|FloorHeating/],
  ['sensor', /Motion|Occupancy|Presence|LightSensor|Rain|Leak|Filling/],
  ['water', /Irrigation|WaterStop|Valve/],
  ['switch', /Switch|DoorOpener|Fan|PowerMeter/]
]

/** true for the virtual key devices of the CCU (HM-RCV-50, HmIP-RCV-50, HMW-RCV-50) */
function isVirtualKeyDevice (deviceType) {
  return VIRTUAL_KEY_DEVICE.test(String(deviceType))
}

/** light, switch, cover, climate, security, sensor, button, water or other */
function categoryOf (serviceClazz) {
  const match = CATEGORIES.find(([, pattern]) => pattern.test(String(serviceClazz || '')))
  return match ? match[0] : 'other'
}

/** HmIP, HmIP-Wired, BidCos-RF, BidCos-Wired or other, by the device type */
function radioSystemOf (deviceType) {
  const type = String(deviceType || '')
  if (/^HmIPW-/i.test(type)) return 'HmIP-Wired'
  if (/^(HmIP|ELV-SH|ALPHA-IP)/i.test(type)) return 'HmIP'
  if (/^HMW-/i.test(type)) return 'BidCos-Wired'
  if (/^(HM|ZEL|IT|ROTO)-/i.test(type)) return 'BidCos-RF'
  return 'other'
}

/** true for the second and third virtual channel of a HomematicIP output */
function isSecondaryChannel (deviceChannels, channel) {
  if ((!channel) || (!VIRTUAL_RECEIVER.test(String(channel.type)))) {
    return false
  }
  const number = channelNumberOf(channel.address)
  const previous = (deviceChannels || []).find(other => channelNumberOf(other.address) === number - 1)
  return (previous !== undefined) && (previous.type === channel.type)
}

/** the names of the rooms (or functions) that hold one of the channel ids, sorted and without duplicates */
function roomNames (rooms, channelIds) {
  const names = (rooms || [])
    .filter(room => Array.isArray(room.channels) && room.channels.some(id => channelIds.includes(id)))
    .map(room => String(room.name))
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

/** the stored mapping of an address as the dialog shows it, undefined if there is none */
function mappingInfo (mappings, address) {
  const stored = (mappings || {})[address]
  if ((stored === null) || (typeof stored !== 'object') || (stored.Service === undefined)) {
    return undefined
  }
  return { name: stored.name, service: stored.Service }
}

/** the key channel carrying the remote of this device, undefined if it has none */
function remoteAddressOf (mappings, deviceChannels) {
  const key = deviceChannels.find(channel => isRemoteKeyType(channel.type) &&
    (mappingInfo(mappings, channel.address) || {}).service === REMOTE_SERVICE)
  return key ? key.address : undefined
}

/** the choice settings ('option') of a service, with the native default for this device */
function serviceOptions (service, deviceType) {
  const settings = withNativeSettingDefaults(service, deviceType, undefined).settings || {}
  return Object.keys(settings)
    .filter(key => (settings[key].type === 'option') && Array.isArray(settings[key].array) && (settings[key].array.length > 0))
    .map(key => ({ key, label: settings[key].label, values: settings[key].array.map(String), default: String(settings[key].default) }))
}

/**
 * Whether the channel carries the function of the device: the outputs and sensors, not the folded
 * channels, not the keys of an actuator (a wall switch unit also has keys) and not the meter
 * channel of a measuring actuator, which switches the same output again.
 */
function isMainChannel (device, entry) {
  if (entry.secondary || METER_TYPES.includes(entry.type)) {
    return false
  }
  return entry.key ? (device.channels || []).every(channel => (channel.isSuported !== true) || isRemoteKeyType(channel.type)) : true
}

/** whether the dialog ticks the channel when the whole device is chosen: a free main channel */
function isPreselected (device, entry) {
  return isMainChannel(device, entry) && !entry.mapping && !entry.coveredBy && !isVirtualKeyDevice(device.type)
}

function catalogChannel (device, channel, context) {
  const { serviceTable, rooms, functions, mappings, remoteAddress } = context
  const entry = {
    id: channel.id,
    address: channel.address,
    number: channelNumberOf(channel.address),
    name: channel.name,
    type: channel.type,
    rooms: roomNames(rooms, [channel.id]),
    functions: roomNames(functions, [channel.id]),
    services: orderedServicesForChannel(serviceTable, device.type, channel.type)
      .map(service => ({ serviceClazz: service.serviceClazz, description: service.description, options: serviceOptions(service, device.type) })),
    secondary: isSecondaryChannel(device.channels, channel),
    key: isRemoteKeyType(channel.type) && !isVirtualKeyDevice(device.type)
  }
  const mapping = mappingInfo(mappings, channel.address)
  if (mapping) {
    entry.mapping = mapping
  } else if (isCoveredByRemote(mappings, channel)) {
    entry.coveredBy = remoteAddress
  }
  entry.preselect = isPreselected(device, entry)
  entry.main = isMainChannel(device, entry)
  return entry
}

/**
 * The devices of the "new device" dialog, sorted by name: every compatible device with at least
 * one supported channel, its rooms, functions, category, radio system, picture and its supported
 * channels (see catalogChannel). serviceTable is the service list of the server, rooms and
 * functions the CCU rooms and functions ({ name, channels: [ids] }), icons { deviceType: path }.
 */
function buildDeviceCatalog (compatibleDevices, mappings, { serviceTable, rooms, functions, icons = deviceIcons() } = {}) {
  return (compatibleDevices || [])
    .map(device => {
      const deviceChannels = device.channels || []
      const supported = deviceChannels.filter(channel => channel.isSuported === true)
      const context = { serviceTable, rooms, functions, mappings, remoteAddress: remoteAddressOf(mappings, deviceChannels) }
      const channels = supported
        .map(channel => catalogChannel(device, channel, context))
        .filter(channel => channel.services.length > 0)
        .sort((a, b) => a.number - b.number)
      const main = channels.find(channel => channel.main) || channels[0]
      const entry = {
        address: device.address,
        name: device.name,
        type: device.type,
        rooms: roomNames(rooms, supported.map(channel => channel.id)),
        functions: roomNames(functions, supported.map(channel => channel.id)),
        category: main ? categoryOf(main.services[0].serviceClazz) : 'other',
        system: radioSystemOf(device.type),
        virtualKeys: isVirtualKeyDevice(device.type),
        channels
      }
      if ((icons || {})[device.type]) {
        entry.icon = icons[device.type]
      }
      return entry
    })
    .filter(device => device.channels.length > 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

module.exports = {
  isSecondaryChannel,
  isVirtualKeyDevice,
  categoryOf,
  radioSystemOf,
  serviceOptions,
  buildDeviceCatalog
}
