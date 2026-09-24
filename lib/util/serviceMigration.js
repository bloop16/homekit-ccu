'use strict'

// Service classes that were removed, with the class that replaces them. A device mapping
// (`config.mappings[address]`) names its class in `Service`; a stored mapping naming a removed
// class would leave the channel without an accessory.
const RENAMED_SERVICES = Object.freeze({
  // was an incomplete duplicate of HomeMaticSwitchAccessory for the same channel types
  HomeMaticProgrammableSwitchAccessory: 'HomeMaticSwitchAccessory'
})

const isDeviceMapping = (mapping) => Boolean(mapping) && typeof mapping === 'object' && !Array.isArray(mapping)

/**
 * Replaces removed service class names in the device mappings.
 * @param {object} mappings config.mappings (may be undefined; not modified)
 * @returns {{mappings: object, changed: number}} new mappings when something changed
 *   (otherwise the input) and the number of renamed mappings
 */
function migrateServiceNames (mappings) {
  if (!mappings || typeof mappings !== 'object') {
    return { mappings, changed: 0 }
  }
  let changed = 0
  const result = {}
  Object.keys(mappings).forEach(key => {
    const mapping = mappings[key]
    const replacement = isDeviceMapping(mapping) && typeof mapping.Service === 'string' && Object.hasOwn(RENAMED_SERVICES, mapping.Service)
      ? RENAMED_SERVICES[mapping.Service]
      : undefined
    if (replacement) {
      result[key] = { ...mapping, Service: replacement }
      changed++
    } else {
      result[key] = mapping
    }
  })
  return { mappings: changed > 0 ? result : mappings, changed }
}

module.exports = { RENAMED_SERVICES, migrateServiceNames }
