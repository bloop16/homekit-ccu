'use strict'

/*
 * Channels that are part of another channel's HomeKit accessory.
 *
 * - the keys of a remote (util/remoteMapping.js): the remote shows every key of its device
 * - the outputs of a multi-gang switch actuator combined into one accessory: the mapping of the
 *   first output lists the other outputs in settings.channels (HomeMaticSwitchAccessory), each
 *   becomes a switch of that accessory
 * Such a channel gets no accessory of its own and is no free channel for a new mapping.
 */

const path = require('path')
const { REMOTE_SERVICE, isCoveredByRemote } = require(path.join(__dirname, 'remoteMapping.js'))

const SWITCH_SERVICE = 'HomeMaticSwitchAccessory'

const serialOf = (address) => String(address).split(':')[0]

/** the other outputs a switch mapping combines into its accessory, [] if none */
function combinedChannelsOf (mapping) {
  const channels = (mapping && mapping.settings && mapping.settings.channels)
  return Array.isArray(channels) ? channels.filter(address => typeof address === 'string') : []
}

/**
 * The address of the mapping whose accessory holds this channel: the remote of its device or a
 * switch mapping combining it; undefined when the channel is on its own.
 */
function coveringAddress (mappings, channel) {
  if ((!channel) || (!channel.address)) {
    return undefined
  }
  const all = mappings || {}
  if (isCoveredByRemote(all, channel)) {
    return Object.keys(all).find(address => (address !== channel.address) && (serialOf(address) === serialOf(channel.address)) &&
      all[address] && (all[address].Service === REMOTE_SERVICE))
  }
  return Object.keys(all).find(address => (address !== channel.address) && all[address] && (all[address].Service === SWITCH_SERVICE) &&
    combinedChannelsOf(all[address]).includes(channel.address))
}

module.exports = {
  SWITCH_SERVICE,
  combinedChannelsOf,
  coveringAddress
}
