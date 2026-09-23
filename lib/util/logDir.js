'use strict'

const fs = require('fs')

/**
 * @param {string|undefined} dir
 * @returns {boolean} true when dir is an existing directory this process may write to
 */
function isWritableDir (dir) {
  if (!dir) {
    return false
  }
  try {
    if (!fs.statSync(dir).isDirectory()) {
      return false
    }
    fs.accessSync(dir, fs.constants.W_OK) // throws when not writable
    return true
  } catch (e) {
    return false
  }
}

/**
 * @param {Array<string|undefined>} candidates directories in order of preference
 * @param {string} fallback used when no candidate is writable
 * @returns {string}
 */
function selectLogDir (candidates, fallback) {
  return candidates.find(isWritableDir) || fallback
}

module.exports = { isWritableDir, selectLogDir }
