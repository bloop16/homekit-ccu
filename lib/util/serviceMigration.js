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

// Special devices that were removed without a replacement: a stored one is dropped from
// config.special and config.mappings
const REMOVED_SERVICES = Object.freeze([
  // an HTTP request as a switch, unrelated to the CCU; https without a port went to port 80
  'HomeMaticSPHTTPAccessory',
  // a battery from any datapoint; the devices show their battery level themselves
  'HomeMaticBatteryAccessory'
])

/**
 * Drops the special devices whose service class was removed.
 * @param {object} config parsed config.json (not modified)
 * @returns {{config: object, removed: string[]}} a new config when something was removed
 *   (otherwise the input) and "name (class)" of every removed device
 */
function removeRemovedServices (config) {
  const mappings = (config && config.mappings && typeof config.mappings === 'object') ? config.mappings : {}
  const gone = Object.keys(mappings).filter(key => {
    const mapping = mappings[key]
    return isDeviceMapping(mapping) && REMOVED_SERVICES.includes(mapping.Service)
  })
  if (gone.length === 0) {
    return { config, removed: [] }
  }
  const removed = gone.map(key => (mappings[key].name || key) + ' (' + mappings[key].Service + ')')
  const keptMappings = Object.fromEntries(Object.entries(mappings).filter(([key]) => !gone.includes(key)))
  const special = Array.isArray(config.special)
    ? config.special.filter(id => !gone.includes(id + ':0'))
    : config.special
  return { config: { ...config, special, mappings: keptMappings }, removed }
}

module.exports = { RENAMED_SERVICES, migrateServiceNames, REMOVED_SERVICES, removeRemovedServices }
