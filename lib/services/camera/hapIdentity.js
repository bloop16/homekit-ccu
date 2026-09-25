'use strict'

// Setup codes HomeKit rejects as trivial (HAP specification, "Setup Code").
const TRIVIAL_SETUP_CODES = new Set([
  '000-00-000', '111-11-111', '222-22-222', '333-33-333', '444-44-444',
  '555-55-555', '666-66-666', '777-77-777', '888-88-888', '999-99-999',
  '123-45-678', '876-54-321'
])

/**
 * True for a setup code of the form 123-45-678 that HomeKit accepts.
 * @param {string} code
 */
function isValidSetupCode (code) {
  return /^\d{3}-\d{2}-\d{3}$/.test(String(code)) && !TRIVIAL_SETUP_CODES.has(code)
}

module.exports = { isValidSetupCode }
