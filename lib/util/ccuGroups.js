'use strict'

/*
 * The groups of the CCU (Settings → Groups): virtual group devices with the addresses INT0000001,
 * INT0000002, ... (e.g. HmIP heating groups) and their member devices. Setting the group sets its
 * members, so the dialogs show a group above its members.
 *
 * OpenCCU keeps the groups in groups.gson, a JSON file of its group management. Its layout is not
 * documented, so the members are found by the addresses in it: an object that holds exactly one
 * group address and addresses of other devices describes that group. Unknown addresses are
 * ignored; without the file (remote mode, development) there are no groups.
 */

const fs = require('fs')

const GROUPS_FILE = '/usr/local/etc/config/groups.gson'
const GROUP_ADDRESS = /^INT\d+$/i

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
    return groupMembers(JSON.parse(fs.readFileSync(file, 'utf8')), knownAddresses)
  } catch (e) {
    return {}
  }
}

module.exports = { isGroupAddress, groupMembers, readGroups }
