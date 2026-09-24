/*
 * File: assistantmodel.js
 * Project: homekit-ccu
 * -----
 * The MIT License (MIT)
 * ==========================================================================
 */

/*
 * The plan of the setup assistant, without any DOM.
 *
 * HomeKit has no rooms: Apple Home puts a new accessory into the room of its bridge. A bridge per
 * CCU room therefore puts every device into its room without moving anything by hand. The
 * assistant proposes bridges by a layout (per room, per floor or one for everything), the user
 * changes names and the bridge of each room, chooses devices and channels, and the plan becomes
 * one call of api method applyAssistant.
 *
 * Devices already in HomeKit are never moved: another bridge would lose their room, scenes and
 * automations in Apple Home.
 */

import { buildEntries, deviceMappings, isMapped, preselectedEntries, suggestNames } from './newdevicemodel.js'

export const LAYOUTS = ['room', 'floor', 'single']
export const NO_ROOM = 0
// Apple Home takes at most 150 accessories per bridge, the bridge itself is one of them
export const MAX_ACCESSORIES = 149

const SECURITY = /KeyMatic|DoorLock|Alarm|Siren/
const DEFAULT_BRIDGE_NAME = 'HomeKit-CCU'

/** the entries of a catalog device, with the services of its main row */
export function withEntries (catalog) {
  return (catalog || []).map(device => ({ device, entries: buildEntries(device) }))
}

/** the CCU room of a device: the room of its main channel, else its first room, else NO_ROOM */
export function roomOfDevice (device, rooms) {
  const main = (device.channels || []).find(channel => channel.main) || (device.channels || [])[0]
  const name = ((main && main.rooms && main.rooms[0]) || (device.rooms || [])[0])
  const room = (rooms || []).find(candidate => candidate.name === name)
  return room ? room.id : NO_ROOM
}

/** true for locks, alarm systems and sirens */
export function isSecurityDevice (item) {
  const main = item.entries.find(entry => entry.preselect) || item.entries[0]
  return Boolean(main) && SECURITY.test(main.services[0].serviceClazz)
}

/** true when the device passes the function filter: null takes all, '' stands for "no function" */
export function passesFunctions (device, functions) {
  if (!functions) {
    return true
  }
  const own = device.functions || []
  return (own.length === 0) ? functions.includes('') : own.some(name => functions.includes(name))
}

/** the devices with free rows, per room id, in the order of the rooms and NO_ROOM last */
export function devicesByRoom (items, rooms, functions = null) {
  const result = new Map()
  ;(rooms || []).forEach(room => result.set(room.id, []))
  result.set(NO_ROOM, [])
  items
    .filter(item => item.entries.some(entry => !isMapped(entry)) && (item.device.virtualKeys !== true) && passesFunctions(item.device, functions))
    .forEach(item => result.get(roomOfDevice(item.device, rooms)).push(item))
  return result
}

/** the display name HomeKit-CCU gives a bridge (lib/util/homekitName.js bridgeDisplayName) */
export function bridgeDisplayName (name) {
  const trimmed = String(name || '').trim()
  return ((trimmed === '') || (trimmed.toLowerCase() === 'default')) ? DEFAULT_BRIDGE_NAME : DEFAULT_BRIDGE_NAME + ' ' + trimmed
}

/** the existing bridge with this name (without the HomeKit-CCU prefix), undefined if none */
function existingNamed (bridges, name) {
  return (bridges || []).find(bridge => bridge.displayName === bridgeDisplayName(name))
}

/** the bridge for devices without a room: the default bridge, else the first without a room */
function defaultBridge (bridges) {
  return existingNamed(bridges, '') || (bridges || []).find(bridge => !bridge.roomId && !(bridge.roomIds || []).length)
}

function existingEntry (bridge, kind) {
  return { key: 'id:' + bridge.id, id: bridge.id, name: bridge.displayName, kind, paired: bridge.paired === true }
}

function bridgeFor (plan, bridges, name, kind, extra = {}) {
  const existing = existingNamed(bridges, name)
  const entry = existing ? existingEntry(existing, kind) : { key: kind + ':' + name, name, kind, ...extra }
  if (!plan.bridges.some(other => other.key === entry.key)) {
    plan.bridges.push(entry)
  }
  return entry.key
}

/**
 * The proposed plan: { layout, bridges: [{ key, id?, name, kind }], roomBridge: { roomId: key },
 * securityBridge: key | undefined }. options: { mergeSmall, smallLimit, security, names }, names
 * are the bridge names in the user's language: { floors: [names], otherRooms, otherDevices, security }.
 * Rooms with an existing bridge (made for this room) keep it; roomBridge '' skips a room.
 */
export function proposePlan (layout, byRoom, rooms, bridges, options = {}) {
  const names = { floors: ['Ground floor', 'Upper floor'], otherRooms: 'Other rooms', otherDevices: 'Other devices', security: 'Security', ...(options.names || {}) }
  // deviceBridge: the bridge the user chose for single devices, before the room rule
  const plan = { layout, bridges: [], roomBridge: {}, deviceBridge: {}, securityBridge: undefined }
  const count = (roomId) => (byRoom.get(roomId) || []).length
  const withDevices = (rooms || []).filter(room => count(room.id) > 0)
  const fallback = () => {
    const bridge = defaultBridge(bridges)
    if (bridge) {
      const entry = existingEntry(bridge, 'rest')
      if (!plan.bridges.some(other => other.key === entry.key)) plan.bridges.push(entry)
      return entry.key
    }
    return bridgeFor(plan, bridges, names.otherDevices, 'rest')
  }
  if (layout === 'single') {
    const key = fallback()
    withDevices.forEach(room => { plan.roomBridge[room.id] = key })
  } else if (layout === 'floor') {
    const keys = names.floors.map(name => bridgeFor(plan, bridges, name, 'floor'))
    withDevices.forEach(room => { plan.roomBridge[room.id] = keys[0] })
  } else {
    const limit = Number.isInteger(options.smallLimit) ? options.smallLimit : 2
    withDevices.forEach(room => {
      const own = (bridges || []).find(bridge => bridge.roomId === room.id)
      if (own) {
        const entry = existingEntry(own, 'room')
        if (!plan.bridges.some(other => other.key === entry.key)) plan.bridges.push(entry)
        plan.roomBridge[room.id] = entry.key
      } else if ((options.mergeSmall === true) && (count(room.id) <= limit)) {
        plan.roomBridge[room.id] = bridgeFor(plan, bridges, names.otherRooms, 'rest')
      } else {
        plan.roomBridge[room.id] = bridgeFor(plan, bridges, room.name, 'room', { roomId: room.id })
      }
    })
  }
  if (count(NO_ROOM) > 0) {
    plan.roomBridge[NO_ROOM] = (layout === 'single') ? plan.bridges[0].key : fallback()
  }
  if (options.security === true) {
    plan.securityBridge = bridgeFor(plan, bridges, names.security, 'security')
  }
  return plan
}

/** puts a device on another bridge ('' leaves it out); back on its proposed bridge the choice is forgotten */
export function chooseBridge (plan, item, rooms, key) {
  plan.deviceBridge = plan.deviceBridge || {}
  if (key === proposedBridgeOfDevice(plan, item, rooms)) {
    delete plan.deviceBridge[item.device.address]
  } else {
    plan.deviceBridge[item.device.address] = key
  }
}

/** a new bridge in the plan, e.g. a further floor; returns its key */
export function addBridge (plan, name, kind = 'floor') {
  let key = kind + ':' + name
  for (let i = 2; plan.bridges.some(bridge => bridge.key === key); i++) {
    key = kind + ':' + name + ' ' + i
  }
  plan.bridges.push({ key, name, kind })
  return key
}

/**
 * takes a bridge out of the plan: its rooms become "not taken", devices put on it by hand follow
 * their room again, and without it there is no security bridge
 */
export function removeBridge (plan, key) {
  plan.bridges = plan.bridges.filter(bridge => bridge.key !== key)
  Object.keys(plan.roomBridge).forEach(roomId => {
    if (plan.roomBridge[roomId] === key) plan.roomBridge[roomId] = ''
  })
  Object.keys(plan.deviceBridge || {}).forEach(address => {
    if (plan.deviceBridge[address] === key) delete plan.deviceBridge[address]
  })
  if (plan.securityBridge === key) {
    plan.securityBridge = undefined
  }
}

/**
 * why the names of the new bridges can not be created: 'missing' (an empty name) or 'duplicate'
 * (twice in the plan or the name of an existing bridge, Apple Home and the config need unique
 * names); undefined when all are fine
 */
export function bridgeNameProblem (plan, bridges) {
  const taken = new Set((bridges || []).map(bridge => String(bridge.displayName).toLowerCase()))
  for (const bridge of plan.bridges.filter(candidate => !candidate.id)) {
    const name = String(bridge.name).trim()
    if (name === '') return 'missing'
    const display = bridgeDisplayName(name).toLowerCase()
    if (taken.has(display)) return 'duplicate'
    taken.add(display)
  }
  return undefined
}

/** the bridge key of a device: the one the user chose, else the security bridge for locks and alarms, else its room's ('' skips it) */
export function bridgeOfDevice (plan, item, rooms) {
  const chosen = (plan.deviceBridge || {})[item.device.address]
  if (chosen !== undefined) {
    return chosen
  }
  return proposedBridgeOfDevice(plan, item, rooms)
}

/** the bridge of a device by the rules of the plan (security bridge, room), without a user choice */
export function proposedBridgeOfDevice (plan, item, rooms) {
  if (plan.securityBridge && isSecurityDevice(item)) {
    return plan.securityBridge
  }
  return plan.roomBridge[roomOfDevice(item.device, rooms)] || ''
}

/**
 * The rows ticked at the start: the useful free rows of every device; nothing of the virtual CCU
 * keys and of devices partly in HomeKit already (the rest of such a device was left out on purpose).
 */
export function initialSelection (items) {
  const selected = new Set()
  items
    .filter(item => (item.device.virtualKeys !== true) && !item.entries.some(isMapped))
    .forEach(item => preselectedEntries(item.entries, { explicit: false }).forEach(entry => selected.add(entry.id)))
  return selected
}

/**
 * The choice (name, service, settings) of every selected row, by row id; existing choices are
 * kept, missing ones get the suggested name and the native service with its default settings.
 */
export function completeChoices (items, selected, choices = {}) {
  const result = { ...choices }
  items.forEach(item => {
    const chosen = item.entries.filter(entry => selected.has(entry.id) && !isMapped(entry))
    const names = suggestNames(item.device, chosen)
    chosen.forEach(entry => {
      if (!result[entry.id]) {
        const service = entry.services[0]
        const settings = {}
        ;(service.options || []).forEach(option => { settings[option.key] = option.default })
        result[entry.id] = { name: names[entry.id], service: service.serviceClazz, settings }
      }
    })
  })
  return result
}

/**
 * The summary per bridge of the plan: [{ key, name, isNew, paired, rooms: [names], devices, accessories }]
 * with only the bridges that get devices or hold rooms, plus the counts and warnings
 * ({ bridges, tooMany: [names] }).
 */
export function summarize (plan, items, rooms, selected, choices, combine = new Set()) {
  const byKey = new Map(plan.bridges.map(bridge => [bridge.key, {
    key: bridge.key,
    name: bridge.id ? bridge.name : bridgeDisplayName(bridge.name),
    isNew: !bridge.id,
    paired: bridge.paired === true,
    rooms: [],
    devices: 0,
    accessories: 0
  }]))
  Object.keys(plan.roomBridge).forEach(roomId => {
    const summary = byKey.get(plan.roomBridge[roomId])
    const room = (rooms || []).find(candidate => String(candidate.id) === String(roomId))
    if (summary && room) summary.rooms.push(room.name)
  })
  items.forEach(item => {
    const chosen = item.entries.filter(entry => selected.has(entry.id) && !isMapped(entry))
    const summary = byKey.get(bridgeOfDevice(plan, item, rooms))
    if (summary && (chosen.length > 0)) {
      summary.devices += 1
      // one accessory per mapping: combined outputs are one, keys mapped one by one are several
      summary.accessories += choices ? deviceMappings(chosen, choices, summary.key, combine.has(item.device.address)).length : chosen.length
    }
  })
  const list = [...byKey.values()].filter(summary => (summary.devices > 0) || (summary.rooms.length > 0))
  return {
    bridges: list,
    newBridges: list.filter(summary => summary.isNew && (summary.devices > 0)).length,
    devices: list.reduce((sum, summary) => sum + summary.devices, 0),
    accessories: list.reduce((sum, summary) => sum + summary.accessories, 0),
    tooMany: list.filter(summary => summary.accessories > MAX_ACCESSORIES).map(summary => summary.name)
  }
}

/**
 * The payload of api method applyAssistant: the bridges that get devices (new ones with their
 * rooms) and a mapping per selected row with the key of its bridge; the switch outputs of the
 * devices in combine become one accessory (newdevicemodel.js deviceMappings). Rows without a
 * bridge are skipped.
 */
export function buildApplyPayload (plan, items, rooms, selected, choices, combine = new Set()) {
  const devices = []
  const used = new Set()
  items.forEach(item => {
    const key = bridgeOfDevice(plan, item, rooms)
    const chosen = item.entries.filter(entry => selected.has(entry.id) && !isMapped(entry))
    if ((!key) || (chosen.length === 0)) return
    deviceMappings(chosen, choices, key, combine.has(item.device.address)).forEach(mapping => {
      const { instanceIDs, ...rest } = mapping
      devices.push({ ...rest, bridge: key })
    })
    used.add(key)
  })
  const bridges = plan.bridges.filter(bridge => used.has(bridge.key)).map(bridge => {
    if (bridge.id) {
      return { key: bridge.key, id: bridge.id }
    }
    // the rooms of the bridge, so the new device dialog proposes it for devices of these rooms
    const roomIds = Object.keys(plan.roomBridge)
      .filter(roomId => (plan.roomBridge[roomId] === bridge.key) && (String(roomId) !== String(NO_ROOM)))
      .map(Number)
      .filter(roomId => roomId !== bridge.roomId)
    const result = { key: bridge.key, name: bridge.name }
    if (bridge.roomId !== undefined) result.roomId = bridge.roomId
    if (roomIds.length > 0) result.roomIds = roomIds
    return result
  })
  return { bridges, devices }
}
