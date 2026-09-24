'use strict'

/*
 * The device pictures of the CCU WebUI.
 *
 * OpenCCU describes every device type in /www/config/devdescr/DEVDB.tcl, among others with the
 * pictures its WebUI shows:
 *   array set DEV_PATHS {HmIP-BSM {{50 /config/img/devices/50/PushButton-2ch-wm_thumb.png} {250 ...}} ...}
 * The 50 pixel picture is served by the CCU web server, so the configuration UI shows the same
 * picture as the WebUI. Without the file (remote mode, development) there are no pictures and the
 * UI falls back to a symbol per category.
 */

const fs = require('fs')

const DEVDB = '/www/config/devdescr/DEVDB.tcl'
const PICTURE = /([^\s{}]+) \{\{50 (\/config\/img\/devices\/50\/[^\s{}]+\.png)\}/g

/** { deviceType: picture path } from the text of a DEVDB.tcl, only the DEV_PATHS line */
function parseDevDb (text) {
  const line = String(text || '').split('\n').find(candidate => candidate.startsWith('array set DEV_PATHS'))
  const icons = {}
  if (line) {
    for (const match of line.matchAll(PICTURE)) {
      icons[match[1]] = match[2]
    }
  }
  return icons
}

let cache

/** the pictures of the CCU, read once; {} when the CCU has no DEVDB.tcl */
function deviceIcons (file = process.env.HOMEKIT_CCU_DEVDB || DEVDB) {
  if ((cache === undefined) || (cache.file !== file)) {
    let icons = {}
    try {
      icons = parseDevDb(fs.readFileSync(file, 'latin1'))
    } catch (e) {
      // no CCU WebUI here
    }
    cache = { file, icons }
  }
  return cache.icons
}

module.exports = {
  parseDevDb,
  deviceIcons
}
