'use strict'

/*
 * The file of a service class by its name. Names come from config.json (also from a restored
 * backup) and from api calls, so only a plain class name of lib/services is accepted: a name
 * like '../../tmp/x' must never reach require().
 */

const path = require('path')
const fs = require('fs')

const SERVICES_DIR = path.join(__dirname, '..', 'services')
const CLASS_NAME = /^HomeMatic[A-Za-z0-9]+Accessory$/

/** the absolute path of the service class, undefined for an invalid or unknown name */
function serviceClassFile (name) {
  if ((typeof name !== 'string') || !CLASS_NAME.test(name)) {
    return undefined
  }
  const file = path.join(SERVICES_DIR, name + '.js')
  return fs.existsSync(file) ? file : undefined
}

module.exports = { serviceClassFile }
