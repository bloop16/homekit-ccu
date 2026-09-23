'use strict'

/**
 * Brings one bridge instance to the current settings format: the setup code lives in
 * `pincode` (hap-homematic created default instances with `pin`, which was never read)
 * and every instance has a stable `setupID`.
 * @returns {{instance: object, changes: string[]}} a new instance object and what changed
 */
function migrateInstance (instance, { generatePin, generateSetupID }) {
  const { pin, ...rest } = instance
  const changes = []
  const migrated = { ...rest }
  if (!migrated.pincode) {
    if (pin) {
      migrated.pincode = pin
      changes.push('pin moved to pincode')
    } else {
      migrated.pincode = generatePin()
      changes.push('pincode generated')
    }
  } else if (pin !== undefined) {
    changes.push('stale pin removed')
  }
  if (!migrated.setupID) {
    migrated.setupID = generateSetupID()
    changes.push('setupID generated')
  }
  return { instance: migrated, changes }
}

/**
 * Migrates all bridge instances of a configuration.
 * @param {object} instances config.instances (may be undefined)
 * @param {{generatePin: function, generateSetupID: function}} generators
 * @returns {{instances: object, migrated: Array<{id: string, name: string, changes: string[]}>}}
 *   a new instances object (the input is not modified) and one entry per changed instance
 */
function migrateInstances (instances, generators) {
  if (!instances || typeof instances !== 'object') {
    return { instances, migrated: [] }
  }
  const migrated = []
  const result = {}
  Object.keys(instances).forEach(id => {
    const instance = instances[id]
    if (!instance || typeof instance !== 'object') {
      result[id] = instance
      return
    }
    const { instance: updated, changes } = migrateInstance(instance, generators)
    result[id] = updated
    if (changes.length > 0) {
      migrated.push({ id, name: instance.name, changes })
    }
  })
  return { instances: migrated.length > 0 ? result : instances, migrated }
}

module.exports = { migrateInstances }
