'use strict'

// Apple Home tells the accessories of a bridge apart by their UUID, and HomeMaticAccessory makes it
// from the channel type and the name (a remote adds a prefix). Two channels of one type with the
// same name on one bridge get the same UUID, and HAP-NodeJS then gives both the same accessory id.

const path = require('path')
const uuid = require('@homebridge/hap-nodejs').uuid
const { REMOTE_SERVICE } = require(path.join(__dirname, 'remoteMapping.js'))

// keeps a remote apart from a HomeMaticKeyAccessory with the same channel type and name
const REMOTE_UUID_PREFIX = 'Remote:'
// the bridge of a mapping without an instance
const DEFAULT_INSTANCE = uuid.generate('0')

/** the text the UUID of an accessory is generated from */
function identityKey (serviceClass, channelType, name) {
  return ((serviceClass === REMOTE_SERVICE) ? REMOTE_UUID_PREFIX : '') + channelType + ':' + name
}

/** the bridge ids of a mapping instance (one id, an array of ids or none) */
function bridgesOf (instance) {
  if (Array.isArray(instance)) {
    return instance
  }
  return [instance || DEFAULT_INSTANCE]
}

/**
 * The address of a mapping whose accessory would get the same UUID on a common bridge as the
 * mapping `mapping` ({ name, Service, instance }) of the channel `address`, else undefined.
 * mappings: address -> mapping (the address itself is skipped); typeOf(address) gives the
 * channel type of an address, undefined when the CCU does not know it.
 */
function sameIdentityAs (mappings, address, mapping, typeOf) {
  const type = typeOf(address)
  if (type === undefined) {
    return undefined
  }
  const key = identityKey(mapping.Service, type, mapping.name)
  const bridges = bridgesOf(mapping.instance)
  return Object.keys(mappings).find(other => {
    const candidate = mappings[other]
    if ((other === address) || (!candidate) || (candidate.name !== mapping.name)) {
      return false
    }
    const otherType = typeOf(other)
    return (otherType !== undefined) && (identityKey(candidate.Service, otherType, candidate.name) === key) &&
      bridgesOf(candidate.instance).some(id => bridges.includes(id))
  })
}

module.exports = { REMOTE_UUID_PREFIX, identityKey, sameIdentityAs }
