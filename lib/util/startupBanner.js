'use strict'

/*
 * The first lines of the log on every start. They name the version, so a log that is sent in
 * shows which release was running.
 */

const path = require('path')
const { version } = require(path.join(__dirname, '..', '..', 'package.json'))

function startupBanner () {
  return [
    '---- launching ----',
    'Welcome to homekit-ccu ' + version + ' on Node.js ' + process.version + '. Use your HomeMatic devices in HomeKit',
    '(c) 2020-2026 thkl, britz, bloop16 - https://github.com/bloop16/homekit-ccu'
  ]
}

module.exports = { startupBanner }
