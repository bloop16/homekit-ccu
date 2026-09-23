'use strict'

// Setup codes HomeKit rejects as trivial (HAP specification, "Setup Code").
const TRIVIAL_SETUP_CODES = new Set([
  '000-00-000', '111-11-111', '222-22-222', '333-33-333', '444-44-444',
  '555-55-555', '666-66-666', '777-77-777', '888-88-888', '999-99-999',
  '123-45-678', '876-54-321'
])

/**
 * HAP username (a MAC address) derived from an accessory UUID: the first 6 bytes,
 * marked as locally administered unicast address, formatted XX:XX:XX:XX:XX:XX.
 * @param {string} uuid
 * @returns {string}
 */
function usernameFromUuid (uuid) {
  const hex = String(uuid).replace(/-/g, '').slice(0, 12).toUpperCase()
  const firstByte = (parseInt(hex.slice(0, 2), 16) | 0x02) & 0xfe
  const bytes = [firstByte.toString(16).toUpperCase().padStart(2, '0')]
  for (let i = 2; i < 12; i += 2) {
    bytes.push(hex.slice(i, i + 2))
  }
  return bytes.join(':')
}

/**
 * True for a setup code of the form 123-45-678 that HomeKit accepts.
 * @param {string} code
 */
function isValidSetupCode (code) {
  return /^\d{3}-\d{2}-\d{3}$/.test(String(code)) && !TRIVIAL_SETUP_CODES.has(code)
}

module.exports = { usernameFromUuid, isValidSetupCode }
