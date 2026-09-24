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
 *   a button per key (util/remoteMapping.js), mapped on the first key of the device.
 */

const path = require('path')
const { orderedServicesForChannel } = require(path.join(__dirname, 'defaultServices.js'))
const { withNativeSettingDefaults } = require(path.join(__dirname, 'newMappingDefaults.js'))
const { REMOTE_SERVICE, channelNumberOf, isRemoteKeyType, isCoveredByRemote } = require(path.join(__dirname, 'remoteMapping.js'))

const VIRTUAL_RECEIVER = /_VIRTUAL_RECEIVER$/
const METER_TYPES = ['ENERGIE_METER_TRANSMITTER', 'POWERMETER']

/** true for the second and third virtual channel of a HomematicIP output */
function isSecondaryChannel (deviceChannels, channel) {
  if ((!channel) || (!VIRTUAL_RECEIVER.test(String(channel.type)))) {
    return false
  }
  const number = channelNumberOf(channel.address)
  const previous = (deviceChannels || []).find(other => channelNumberOf(other.address) === number - 1)
  return (previous !== undefined) && (previous.type === channel.type)
}

/** the names of the rooms that hold one of the channel ids, sorted and without duplicates */
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
 * Whether the dialog ticks the channel when the whole device is chosen: the outputs and sensors,
 * not the folded channels, not the keys of an actuator (a wall switch unit also has keys) and not
 * the meter channel of a measuring actuator, which switches the same output again.
 */
function isPreselected (device, entry) {
  if (entry.secondary || entry.mapping || entry.coveredBy || METER_TYPES.includes(entry.type)) {
    return false
  }
  return entry.key ? (device.channels || []).every(channel => (channel.isSuported !== true) || isRemoteKeyType(channel.type)) : true
}

function catalogChannel (device, channel, context) {
  const { serviceTable, rooms, mappings, remoteAddress } = context
  const entry = {
    id: channel.id,
    address: channel.address,
    number: channelNumberOf(channel.address),
    name: channel.name,
    type: channel.type,
    rooms: roomNames(rooms, [channel.id]),
    services: orderedServicesForChannel(serviceTable, device.type, channel.type)
      .map(service => ({ serviceClazz: service.serviceClazz, description: service.description, options: serviceOptions(service, device.type) })),
    secondary: isSecondaryChannel(device.channels, channel),
    key: isRemoteKeyType(channel.type)
  }
  const mapping = mappingInfo(mappings, channel.address)
  if (mapping) {
    entry.mapping = mapping
  } else if (isCoveredByRemote(mappings, channel)) {
    entry.coveredBy = remoteAddress
  }
  entry.preselect = isPreselected(device, entry)
  return entry
}

/**
 * The devices of the "new device" dialog, sorted by name: every compatible device with at least
 * one supported channel, its rooms and its supported channels (see catalogChannel).
 * serviceTable is the service list of the server, rooms the CCU rooms ({ name, channels: [ids] }).
 */
function buildDeviceCatalog (compatibleDevices, mappings, { serviceTable, rooms } = {}) {
  return (compatibleDevices || [])
    .map(device => {
      const deviceChannels = device.channels || []
      const supported = deviceChannels.filter(channel => channel.isSuported === true)
      const context = { serviceTable, rooms, mappings, remoteAddress: remoteAddressOf(mappings, deviceChannels) }
      const channels = supported
        .map(channel => catalogChannel(device, channel, context))
        .filter(channel => channel.services.length > 0)
        .sort((a, b) => a.number - b.number)
      return {
        address: device.address,
        name: device.name,
        type: device.type,
        rooms: roomNames(rooms, supported.map(channel => channel.id)),
        channels
      }
    })
    .filter(device => device.channels.length > 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

module.exports = {
  isSecondaryChannel,
  serviceOptions,
  buildDeviceCatalog
}
