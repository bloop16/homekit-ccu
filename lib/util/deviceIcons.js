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
// the large picture follows the small one: {{50 /…/50/x_thumb.png} {250 /…/250/x.png}}
const LARGE_PICTURE = /([^\s{}]+) \{\{50 [^\s{}]+\} \{250 (\/config\/img\/devices\/250\/[^\s{}]+\.png)\}/g

function devPathsLine (text) {
  return String(text || '').split('\n').find(candidate => candidate.startsWith('array set DEV_PATHS'))
}

function matchAll (text, pattern) {
  const line = devPathsLine(text)
  const pictures = {}
  if (line) {
    for (const match of line.matchAll(pattern)) {
      pictures[match[1]] = match[2]
    }
  }
  return pictures
}

/** { deviceType: picture path } from the text of a DEVDB.tcl, only the DEV_PATHS line */
function parseDevDb (text) {
  return matchAll(text, PICTURE)
}

/** { deviceType: path of the 250 pixel picture } from the text of a DEVDB.tcl */
function parsePictures (text) {
  return matchAll(text, LARGE_PICTURE)
}

let cache

function readDevDb (file) {
  if ((cache === undefined) || (cache.file !== file)) {
    let text = ''
    try {
      text = fs.readFileSync(file, 'latin1')
    } catch (e) {
      // no CCU WebUI here
    }
    cache = { file, icons: parseDevDb(text), pictures: parsePictures(text) }
  }
  return cache
}

/** the pictures of the CCU, read once; {} when the CCU has no DEVDB.tcl */
function deviceIcons (file = process.env.HOMEKIT_CCU_DEVDB || DEVDB) {
  return readDevDb(file).icons
}

/** the path of the 250 pixel picture of a device type on the CCU web server, undefined if none */
function devicePicture (deviceType, file = process.env.HOMEKIT_CCU_DEVDB || DEVDB) {
  return readDevDb(file).pictures[deviceType]
}

module.exports = {
  parseDevDb,
  parsePictures,
  deviceIcons,
  devicePicture
}
