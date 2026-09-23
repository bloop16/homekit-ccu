'use strict'

const crypto = require('crypto')
const path = require('path')
const { isValidSetupCode } = require(path.join(__dirname, '..', 'services', 'camera', 'hapIdentity.js'))

const PIN_RANGE = 100000000 // 8 digits
const SETUP_ID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SETUP_ID_LENGTH = 4

const randomPinNumber = () => crypto.randomInt(0, PIN_RANGE)

const formatPin = (value) => {
  const digits = String(value).padStart(8, '0')
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 8)}`
}

/**
 * A random HomeKit setup code (123-45-678) that is not on the HAP list of trivial codes.
 * @param {function(): number} [random] source of 8 digit numbers, injectable for tests
 * @returns {string}
 */
function generatePin (random = randomPinNumber) {
  let code
  do {
    code = formatPin(random())
  } while (!isValidSetupCode(code))
  return code
}

/**
 * A random HomeKit setup ID (4 characters 0-9A-Z), used in the setup URI / QR code.
 * @returns {string}
 */
function generateSetupID () {
  let setupID = ''
  for (let i = 0; i < SETUP_ID_LENGTH; i++) {
    setupID += SETUP_ID_CHARS.charAt(crypto.randomInt(0, SETUP_ID_CHARS.length))
  }
  return setupID
}

module.exports = { generatePin, generateSetupID }
