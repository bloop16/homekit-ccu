'use strict'

/*
 * Native settings for NEW mappings.
 *
 * HomeMaticSwitchAccessory publishes a Lightbulb when a mapping stores no 'Type'. Stored
 * mappings keep that (another type would replace the primary service of a paired accessory),
 * but a new mapping stores the native type explicitly: an Outlet for plugs, a Switch otherwise.
 */

const SWITCH_CLASS = 'HomeMaticSwitchAccessory'
const PLUG_DEVICE_TYPES = [/^HmIP-PS/, /^HMIP-PSM/, /^HM-LC-Sw1-Pl/, /^HM-ES-PMSw1-Pl/, /^HmIP-USBSM/]

// the second channel of the Hörmann and Tormatic garage door modules switches the drive's light
const LIGHT_DEVICE_TYPES = [/^HmIP-MOD-HO/, /^HmIP-MOD-TM/]

const matches = (deviceType, patterns) => (typeof deviceType === 'string') && patterns.some(pattern => pattern.test(deviceType))

/** 'Outlet' for plug-in devices, 'Lightbulb' for lights, 'Switch' for every other switch actuator */
function nativeSwitchType (deviceType) {
  if (matches(deviceType, PLUG_DEVICE_TYPES)) return 'Outlet'
  if (matches(deviceType, LIGHT_DEVICE_TYPES)) return 'Lightbulb'
  return 'Switch'
}

/** a stored switch mapping without a type, published as a Lightbulb */
function isLegacySwitchMapping (storedMapping) {
  return (storedMapping !== undefined) && (storedMapping !== null) &&
    (storedMapping.Service === SWITCH_CLASS) &&
    ((storedMapping.settings === undefined) || (storedMapping.settings === null) || (storedMapping.settings.Type === undefined))
}

/** the native value of each setting of serviceClazz a new mapping should store */
function nativeSettings (serviceClazz, deviceType) {
  return (serviceClazz === SWITCH_CLASS) ? { Type: nativeSwitchType(deviceType) } : {}
}

/**
 * A copy of a service table entry { serviceClazz, settings } whose setting defaults are the
 * native ones for this device; the entry itself when nothing changes (another class, or a
 * stored switch mapping without a type, which must stay a Lightbulb).
 */
function withNativeSettingDefaults (serviceItem, deviceType, storedMapping) {
  const native = nativeSettings(serviceItem.serviceClazz, deviceType)
  const keys = Object.keys(native).filter(key => serviceItem.settings && serviceItem.settings[key])
  if ((keys.length === 0) || isLegacySwitchMapping(storedMapping)) {
    return serviceItem
  }
  const settings = keys.reduce((result, key) => ({ ...result, [key]: { ...serviceItem.settings[key], default: native[key] } }), { ...serviceItem.settings })
  return { ...serviceItem, settings }
}

/**
 * The settings to store for a mapping: missing native settings are added unless the channel
 * already has a stored switch mapping without a type. Returns a new object.
 */
function completeNewMappingSettings (serviceClazz, deviceType, settings, storedMapping) {
  const given = settings || {}
  const sameLegacyMapping = isLegacySwitchMapping(storedMapping) && (serviceClazz === SWITCH_CLASS)
  if (sameLegacyMapping) {
    return { ...given }
  }
  const native = nativeSettings(serviceClazz, deviceType)
  const missing = Object.keys(native).filter(key => given[key] === undefined)
  return missing.reduce((result, key) => ({ ...result, [key]: native[key] }), { ...given })
}

module.exports = {
  nativeSwitchType,
  isLegacySwitchMapping,
  withNativeSettingDefaults,
  completeNewMappingSettings
}
