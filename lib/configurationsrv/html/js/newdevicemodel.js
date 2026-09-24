/*
 * File: newdevicemodel.js
 * Project: homekit-ccu
 * -----
 * The MIT License (MIT)
 * ==========================================================================
 */

/*
 * The model of the "new device" dialog, without any DOM: the rows a device offers, the names
 * the dialog suggests, the filter and the mappings the dialog finally saves.
 *
 * The server sends the device catalog (lib/util/newDeviceCatalog.js). A device row holds its
 * channels. The keys of a remote or wall button are one row: a remote is one HomeKit
 * accessory with a button per key, mapped on the first key; another service for this row maps
 * every key on its own.
 */

export const REMOTE_SERVICE = 'HomeMaticRemoteAccessory'

const numberOf = (address) => parseInt(String(address).split(':')[1], 10)

/** true when the CCU still uses its default name for the channel ("HmIP-BSM 0001...:4") */
export function hasDefaultName (device, channel) {
  const defaultName = device.type + ' ' + channel.address
  return (!channel.name) || (defaultName.indexOf(channel.name) > -1)
}

/** a readable name of a service class: HomeMaticIPPowerMeterSwitchAccessory -> Power Meter Switch */
export function serviceLabel (serviceClazz) {
  return String(serviceClazz || '')
    .replace(/^HomeMatic(SP)?/, '')
    .replace(/Accessory$/, '')
    .replace(/^IP(?=[A-Z])/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}

/** "4" for one channel, "1–4" for a row of keys */
export function channelNumbers (entry) {
  const numbers = entry.channels.map(channel => channel.number)
  return (numbers.length > 1) ? numbers[0] + '–' + numbers[numbers.length - 1] : String(numbers[0])
}

/**
 * The rows of a catalog device, ordered by channel number. A row is
 * { id, kind: 'channel' | 'keys', device, channels, address, services, mapping, coveredBy, secondary, preselect }.
 */
export function buildEntries (device) {
  const channels = device.channels || []
  const keys = channels.filter(channel => channel.key === true)
  const others = channels.filter(channel => channel.key !== true)
  const entries = others.map(channel => ({
    id: channel.address,
    kind: 'channel',
    device,
    channels: [channel],
    address: channel.address,
    services: channel.services,
    mapping: channel.mapping,
    coveredBy: channel.coveredBy,
    secondary: channel.secondary === true,
    preselect: channel.preselect === true
  }))
  // keys mapped one by one (e.g. as programmable switches) stay single rows without the remote
  const asRemote = keys.every(channel => (!channel.mapping) || (channel.mapping.service === REMOTE_SERVICE))
  if ((keys.length > 0) && asRemote) {
    const remoteKey = keys.find(channel => channel.mapping)
    entries.push({
      id: device.address + ':keys',
      kind: 'keys',
      device,
      channels: keys,
      address: remoteKey ? remoteKey.address : keys[0].address,
      services: keys[0].services,
      mapping: remoteKey ? remoteKey.mapping : undefined,
      coveredBy: undefined,
      secondary: false,
      preselect: keys[0].preselect === true
    })
  } else {
    keys.forEach(channel => entries.push({
      id: channel.address,
      kind: 'channel',
      device,
      channels: [channel],
      address: channel.address,
      services: channel.services.filter(service => service.serviceClazz !== REMOTE_SERVICE),
      mapping: channel.mapping,
      coveredBy: channel.coveredBy,
      secondary: false,
      preselect: false
    }))
  }
  return entries
    .filter(entry => entry.services.length > 0)
    .sort((a, b) => a.channels[0].number - b.channels[0].number)
}

/** true when the row is in HomeKit already (itself or as a button of the device's remote) */
export function isMapped (entry) {
  return (entry.mapping !== undefined) || (entry.coveredBy !== undefined)
}

/** counts of a device's rows: { total, mapped, free } */
export function deviceState (entries) {
  const mapped = entries.filter(isMapped).length
  return { total: entries.length, mapped, free: entries.length - mapped }
}

/** the categories of the catalog (lib/util/newDeviceCatalog.js) in the order the dialog offers them */
export const CATEGORIES = ['light', 'switch', 'cover', 'climate', 'security', 'sensor', 'button', 'water', 'other']

/** the radio systems of the catalog in the order the dialog offers them */
export const SYSTEMS = ['HmIP', 'HmIP-Wired', 'BidCos-RF', 'BidCos-Wired', 'other']

/** true when the device passes the choice filters: room, function, category and radio system */
function passesChoices (device, filter) {
  return ((!filter.room) || (device.rooms || []).includes(filter.room)) &&
    ((!filter.func) || (device.functions || []).includes(filter.func)) &&
    ((!filter.category) || (device.category === filter.category)) &&
    ((!filter.system) || (device.system === filter.system))
}

/**
 * The rows of a device the filter shows, [] when the device is hidden. filter is
 * { text, room, func, category, system, showMapped, showSecondary, showVirtualKeys }; text matches
 * device name, type, address, room, function and channel name; room, func, category and system
 * are values of the device, '' for all. The virtual keys of the CCU are hidden unless asked for.
 */
export function visibleEntries (device, entries, filter = {}) {
  const text = String(filter.text || '').trim().toLowerCase()
  if ((!passesChoices(device, filter)) || ((device.virtualKeys === true) && (filter.showVirtualKeys !== true))) {
    return []
  }
  if ((filter.showMapped !== true) && (deviceState(entries).free === 0)) {
    return []
  }
  const shown = entries.filter(entry => (filter.showSecondary === true) || (!entry.secondary) || isMapped(entry))
  if (text === '') {
    return shown
  }
  const has = (value) => String(value || '').toLowerCase().includes(text)
  const deviceMatches = has(device.name) || has(device.type) || has(device.address) ||
    (device.rooms || []).some(has) || (device.functions || []).some(has)
  if (deviceMatches) {
    return shown
  }
  return shown.filter(entry => entry.channels.some(channel => has(channel.name) || has(channel.address)))
}

/** the rows of a device ticked when the whole device is chosen */
export function preselectedEntries (entries) {
  const free = entries.filter(entry => !isMapped(entry))
  const chosen = free.filter(entry => entry.preselect)
  // a device with nothing obvious (e.g. only a meter channel) gets its first free row
  return (chosen.length > 0) ? chosen : free.slice(0, 1)
}

/**
 * The HomeKit names the dialog suggests for the chosen rows of one device, by row id: the channel
 * name the user gave in the CCU, else the device name; rows that would end up with the same name
 * get their channel number.
 */
export function suggestNames (device, chosenEntries) {
  const base = (entry) => {
    const channel = entry.channels[0]
    return ((entry.kind === 'channel') && !hasDefaultName(device, channel)) ? channel.name : device.name
  }
  const names = {}
  chosenEntries.forEach(entry => {
    const name = base(entry)
    const twins = chosenEntries.filter(other => base(other) === name)
    names[entry.id] = (twins.length > 1) ? name + ' ' + channelNumbers(entry) : name
  })
  return names
}

/** the services a row offers; a row of keys offers each non-remote service as "every key alone" */
export function isPerKeyChoice (entry, serviceClazz) {
  return (entry.kind === 'keys') && (serviceClazz !== REMOTE_SERVICE)
}

/**
 * The mappings to save for a row: { address, name, serviceClass, settings, instanceIDs }. A row of
 * keys with the remote is one mapping on its first key; with another service one mapping per key,
 * named after the key number.
 */
export function mappingsFor (entry, choice) {
  const base = { serviceClass: choice.service, settings: choice.settings || {}, instanceIDs: [choice.bridge] }
  if (isPerKeyChoice(entry, choice.service) && (entry.channels.length > 1)) {
    return entry.channels.map(channel => ({ ...base, address: channel.address, name: choice.name + ' ' + numberOf(channel.address) }))
  }
  return [{ ...base, address: entry.address, name: choice.name }]
}
