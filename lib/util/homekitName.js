'use strict'

/*
 * Names shown in Apple Home. HAP-NodeJS and the Home app accept a Name only if it starts and
 * ends with a letter or digit and contains letters, digits, spaces, apostrophes and a few
 * punctuation marks in between. The Name characteristic holds at most 64 characters.
 */

const MAX_LENGTH = 64
const UNSUPPORTED = /[^\p{L}\p{N}\p{Zs}’'&!._:;()/,-]/gu
const LEADING = /^[^\p{L}\p{N}]+/u
const TRAILING = /[^\p{L}\p{N}]+$/u

const tidy = (text) => text.replace(/\p{Zs}+/gu, ' ').replace(LEADING, '').replace(TRAILING, '')

// "Bad (OG)" loses its closing bracket at the end, so the opening one goes too
const dropUnmatchedOpening = (text) => {
  const opening = (text.match(/\(/g) || []).length
  const closing = (text.match(/\)/g) || []).length
  if (opening <= closing) return text
  const index = text.lastIndexOf('(')
  return text.slice(0, index) + ' ' + text.slice(index + 1)
}

function clean (value) {
  let name = tidy(String(value === undefined || value === null ? '' : value).normalize('NFC').replace(UNSUPPORTED, ' '))
  name = tidy(dropUnmatchedOpening(name))
  if (name.length > MAX_LENGTH) {
    name = tidy(dropUnmatchedOpening(name.slice(0, MAX_LENGTH)))
  }
  return name
}

// a valid HomeKit name for value; the fallback is used when nothing of value is left
function homeKitName (value, fallback = 'HomeMatic') {
  return clean(value) || clean(fallback)
}

const ADDON_NAME = 'HomeKit-CCU'

// the bridge of the default instance is "HomeKit-CCU", room bridges "HomeKit-CCU Wohnzimmer"
function bridgeDisplayName (instanceName) {
  const name = homeKitName(instanceName, '')
  if ((name === '') || (name.toLowerCase() === 'default')) return ADDON_NAME
  return homeKitName(ADDON_NAME + ' ' + name, ADDON_NAME)
}

module.exports = { homeKitName, bridgeDisplayName, ADDON_NAME }
