'use strict'

/*
 * The groups of the CCU (Settings → Groups): virtual group devices with the addresses INT0000001,
 * INT0000002, ... (e.g. HmIP heating groups) and their member devices. Setting the group sets its
 * members, so the dialogs show a group above its members.
 *
 * OpenCCU keeps the groups in groups.gson, a JSON file of its group management (latin1), e.g.
 *   {"groups":[{"id":2,"groupMembers":[{"memberType":{"id":"RADIATOR_THERMOSTAT"},"id":"000A...:1"}, ...],
 *     "groupType":{"id":"hmip.heating.group"},"groupProperties":{"GROUP_DEVICE_NAME":"Bad INT0000002","NAME":"Bad"}}]}
 * The group device appears only inside GROUP_DEVICE_NAME. As the layout is not documented, the
 * members are found by the addresses in it: an object that names exactly one group address (also
 * inside a text) and addresses of other devices describes that group. Unknown addresses are
 * ignored; without the file (remote mode, development) there are no groups.
 */

const fs = require('fs')

const GROUPS_FILE = '/usr/local/etc/config/groups.gson'
const GROUP_ADDRESS = /^INT\d+$/i
const GROUP_IN_TEXT = /\bINT\d+\b/gi

/** true for the address of a CCU group device */
function isGroupAddress (address) {
  return GROUP_ADDRESS.test(String(address || ''))
}

const serialOf = (value) => String(value).split(':')[0]

/**
 * { groupAddress: [member device addresses] } from the parsed groups file. knownAddresses are the
 * device addresses of the CCU; only they count as members.
 */
function groupMembers (data, knownAddresses) {
  const known = new Set(knownAddresses || [])
  const result = {}
  const walk = (node, depth) => {
    const found = new Set()
    if ((depth > 30) || (node === null) || (node === undefined)) {
      return found
    }
    if (typeof node === 'string') {
      const serial = serialOf(node)
      if (known.has(serial)) found.add(serial)
      // "Badezimmer INT0000002": the group device inside a name
      ;(node.match(GROUP_IN_TEXT) || []).map(address => address.toUpperCase()).filter(address => known.has(address)).forEach(address => found.add(address))
      return found
    }
    if (typeof node !== 'object') {
      return found
    }
    Object.values(node).forEach(child => walk(child, depth + 1).forEach(address => found.add(address)))
    if (!Array.isArray(node)) {
      const groups = [...found].filter(isGroupAddress)
      const members = [...found].filter(address => !isGroupAddress(address))
      if ((groups.length === 1) && (members.length > 0)) {
        result[groups[0]] = [...new Set((result[groups[0]] || []).concat(members))].sort()
      }
    }
    return found
  }
  walk(data, 0)
  return result
}

/** the groups of the CCU from its groups file, {} without the file or with an unreadable one */
function readGroups (knownAddresses, file = process.env.HOMEKIT_CCU_GROUPS || GROUPS_FILE) {
  try {
    // the CCU writes the file in latin1 ("K\xfcche"); only the addresses matter here
    return groupMembers(JSON.parse(fs.readFileSync(file, 'latin1')), knownAddresses)
  } catch (e) {
    return {}
  }
}

module.exports = { isGroupAddress, groupMembers, readGroups }
