'use strict'

/*
 * A remote (HomeMaticRemoteAccessory) is mapped on one key channel of a device and shows all keys
 * of that device as buttons of one HomeKit accessory. These helpers find the key channels a remote
 * covers, so the server does not publish them a second time and the "new device" list shows the
 * remote once instead of once per key.
 */

const REMOTE_SERVICE = 'HomeMaticRemoteAccessory'
const REMOTE_KEY_TYPES = Object.freeze(['KEY', 'KEY_TRANSCEIVER'])

const serialOf = (address) => String(address).split(':')[0]
const channelNumberOf = (address) => parseInt(String(address).split(':')[1], 10)

const isRemoteKeyType = (type) => REMOTE_KEY_TYPES.includes(type)

/** addresses of the channels mapped to the remote service */
function remoteAddresses (mappings) {
  return Object.keys(mappings || {})
    .filter(address => (mappings[address] !== null) && (typeof mappings[address] === 'object') &&
      (mappings[address].Service === REMOTE_SERVICE))
}

/** true when channel is a key of a device whose remote is mapped on another of its keys */
function isCoveredByRemote (mappings, channel) {
  if ((!channel) || (!channel.address) || (!isRemoteKeyType(channel.type))) {
    return false
  }
  const serial = serialOf(channel.address)
  return remoteAddresses(mappings)
    .some(address => (address !== channel.address) && (serialOf(address) === serial))
}

/** the key channels of a device a remote shows as buttons, ordered by channel number */
function remoteKeyChannels (device) {
  return ((device && device.channels) || [])
    .filter(channel => isRemoteKeyType(channel.type))
    .slice()
    .sort((a, b) => channelNumberOf(a.address) - channelNumberOf(b.address))
}

/**
 * the list the "new device" wizard offers: every supported channel of the compatible devices,
 * without the keys a remote of the same device already covers
 */
function buildNewDeviceList (compatibleDevices, mappings) {
  return (compatibleDevices || []).map(device => ({
    device: device.address,
    name: device.name,
    type: device.type,
    channels: (device.channels || [])
      .filter(channel => (channel.isSuported === true) && (!isCoveredByRemote(mappings, channel)))
      .map(channel => ({ id: channel.id, address: channel.address, name: channel.name, type: channel.type }))
  }))
}

module.exports = {
  REMOTE_SERVICE,
  REMOTE_KEY_TYPES,
  channelNumberOf,
  isRemoteKeyType,
  isCoveredByRemote,
  remoteKeyChannels,
  buildNewDeviceList
}
