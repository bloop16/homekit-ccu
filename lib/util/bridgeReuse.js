'use strict'

// Saving the configuration reloads all devices. A bridge whose identity did not change keeps
// running and only gets its new devices, so Apple Home never sees it go away and a pairing that
// is going on at that moment is not broken.

const crypto = require('crypto')

// everything a bridge is published with; a change of any of it needs a new publish
function bridgeIdentity ({ name, username, pincode, setupID }) {
  return crypto.createHash('sha256').update(JSON.stringify([name, username, pincode, setupID])).digest('hex')
}

// Old and new devices are exchanged in one synchronous step. hap-nodejs hands out the aids of
// the devices on the next request of Apple Home and forgets the ones of absent devices, so a
// bridge that is empty for a moment would cost the devices their rooms, scenes and automations.
function swapBridgedAccessories (bridge, accessories) {
  const previous = bridge.bridgedAccessories.slice()
  if (accessories.length > 0) {
    previous.forEach(accessory => bridge.removeBridgedAccessory(accessory, true))
    bridge.addBridgedAccessories(accessories) // one configuration update for the whole swap
  } else if (previous.length > 0) {
    bridge.removeBridgedAccessories(previous)
  }
  unlinkControllerStorage(bridge, previous)
}

// removeBridgedAccessory of hap-nodejs keeps the controller storage of a removed accessory linked
// to the bridge; without this every reload would add one more for each device.
// linkedAccessories is private in hap-nodejs: check this after every update of it.
function unlinkControllerStorage (bridge, removed) {
  const storage = bridge.controllerStorage
  if (!storage || !Array.isArray(storage.linkedAccessories)) return
  const stale = new Set(removed.map(accessory => accessory.controllerStorage))
  storage.linkedAccessories = storage.linkedAccessories.filter(linked => !stale.has(linked))
}

module.exports = { bridgeIdentity, swapBridgedAccessories }
