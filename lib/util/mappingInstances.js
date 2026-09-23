'use strict'

// The bridge(s) of a mapping (`config.mappings[address].instance`) is either a bridge id or,
// as the configuration UI stores it, an array of bridge ids (several = multi-bridge device).

/**
 * @returns the bridge id for a one-element array, otherwise the value unchanged
 */
function normalizeInstance (instance) {
  if (Array.isArray(instance) && instance.length === 1 && typeof instance[0] === 'string') {
    return instance[0]
  }
  return instance
}

/**
 * Normalizes the instance of every mapping.
 * @param {object} mappings config.mappings (may be undefined; not modified)
 * @returns {{mappings: object, normalized: string[]}} new mappings when something changed
 *   (otherwise the input) and the keys of the changed mappings
 */
function normalizeMappingInstances (mappings) {
  if (!mappings || typeof mappings !== 'object') {
    return { mappings, normalized: [] }
  }
  const normalized = []
  const result = {}
  Object.keys(mappings).forEach(key => {
    const mapping = mappings[key]
    const isDeviceMapping = mapping && typeof mapping === 'object' && !Array.isArray(mapping)
    const instance = isDeviceMapping ? normalizeInstance(mapping.instance) : undefined
    if (isDeviceMapping && instance !== mapping.instance) {
      result[key] = { ...mapping, instance }
      normalized.push(key)
    } else {
      result[key] = mapping
    }
  })
  return { mappings: normalized.length > 0 ? result : mappings, normalized }
}

/**
 * Takes a removed bridge out of a mapping instance.
 * @returns the remaining bridge id(s), or fallbackId when no bridge is left
 */
function removeInstanceFrom (instance, removedId, fallbackId) {
  if (instance === removedId) {
    return fallbackId
  }
  if (!Array.isArray(instance) || !instance.includes(removedId)) {
    return instance
  }
  const remaining = instance.filter(id => id !== removedId)
  return remaining.length === 0 ? fallbackId : normalizeInstance(remaining)
}

module.exports = { normalizeInstance, normalizeMappingInstances, removeInstanceFrom }
