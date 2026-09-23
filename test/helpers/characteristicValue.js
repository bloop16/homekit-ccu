'use strict'

/**
 * Replacement for Characteristic.getValue(callback), which was removed in
 * @homebridge/hap-nodejs 2.x. Resolves the value through the characteristic's
 * get handler (legacy 'get' listener or onGet) and reports it node-style.
 */
function getCharacteristicValue (characteristic, callback) {
  characteristic.handleGetRequest().then(
    (value) => callback(null, value),
    (error) => callback(error)
  )
}

module.exports = { getCharacteristicValue }
