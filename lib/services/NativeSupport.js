/*
 * File: NativeSupport.js
 * Project: homekit-ccu
 * -----
 * Small helpers shared by the accessories that map HomeMatic devices to native HomeKit services
 * (valves, locks, air quality, occupancy, sirens). Not an accessory class itself; the server only
 * loads HomeMatic*Accessory.js files as services.
 * ==========================================================================
 */

const { Characteristic } = require('@homebridge/hap-nodejs')

/** the number in value, or fallback when the CCU has no (valid) value */
function numberOr (value, fallback) {
  if ((value === undefined) || (value === null) || (value === '') || (typeof value === 'boolean')) {
    return fallback
  }
  const number = parseFloat(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp (value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * StatusFault of a service from several boolean error datapoints (e.g. '0.ERROR_VALVE_FAILURE'):
 * GENERAL_FAULT while one of them is set. Only datapoints the device has are used; nothing is
 * added when it has none of them.
 * @param {object} accessory HomeMaticAccessory
 * @param {object} service HAP service that supports StatusFault
 * @param {string[]} candidates datapoints in the short form 'channel.NAME'
 * @returns {Promise<object|undefined>} the characteristic, or undefined
 */
async function addFaultSources (accessory, service, candidates) {
  const sources = []
  for (const dp of candidates) {
    try {
      if (await accessory._ccu.hazDatapoint(accessory.buildAddress(dp))) {
        sources.push(dp)
      }
    } catch (e) {
      accessory.debugLog('unable to check %s: %s', dp, e.message || e)
    }
  }
  if (sources.length === 0) {
    return undefined
  }
  const faults = {}
  const status = () => sources.some(dp => faults[dp] === true)
    ? Characteristic.StatusFault.GENERAL_FAULT
    : Characteristic.StatusFault.NO_FAULT
  const fault = service.getCharacteristic(Characteristic.StatusFault)
    .on('get', accessory.guardedGet(async (callback) => {
      for (const dp of sources) {
        try {
          const value = await accessory.getValue(dp, true)
          if ((value !== undefined) && (value !== null)) {
            faults[dp] = accessory.isTrue(value)
          }
        } catch (e) {
          accessory.debugLog('unable to read %s: %s', dp, e.message || e)
        }
      }
      callback(null, status())
    }))
  sources.forEach(dp => {
    accessory.registerAddressForEventProcessingAtAccessory(accessory.buildAddress(dp), (newValue) => {
      faults[dp] = accessory.isTrue(newValue)
      fault.updateValue(status(), null)
    })
  })
  return fault
}

/** adds StatusTampered from channel 0 SABOTAGE / ERROR_SABOTAGE when the device reports it */
async function addTamperIfPresent (accessory, service) {
  try {
    const hasSabotage = await accessory._ccu.hazDatapoint(accessory.buildAddress('0.SABOTAGE')) ||
      await accessory._ccu.hazDatapoint(accessory.buildAddress('0.ERROR_SABOTAGE'))
    if (hasSabotage) {
      await accessory.addTamperedCharacteristic(service, 0)
    }
  } catch (e) {
    accessory.debugLog('unable to add the tamper state: %s', e.message || e)
  }
}

module.exports = { numberOr, clamp, addFaultSources, addTamperIfPresent }
