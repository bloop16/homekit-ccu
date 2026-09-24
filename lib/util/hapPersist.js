'use strict'

/*
 * HomeKit pairing data lives in <config>/persist as AccessoryInfo.<ID>.json (bridge keys and
 * the paired iPhones) and IdentifierCache.<ID>.json (the aid/iid numbers Apple Home knows the
 * accessories by). Losing them means Apple Home no longer recognises the bridge.
 *
 * A restored backup (from hap-homematic or homekit-ccu) must not merge with the keys the running
 * bridge already created, so its files are staged and replace the current ones on the next start.
 */

const fs = require('fs')
const path = require('path')

const RESTORE_DIR = 'persist.restore'
const PAIRING_FILE = /^(AccessoryInfo|IdentifierCache)\.([0-9A-Fa-f]{12})\.json$/

const pairingFiles = (dir) => {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(name => PAIRING_FILE.test(name) && fs.statSync(path.join(dir, name)).isFile())
}

/**
 * Copies the pairing files of an extracted backup into a staging folder. They replace the
 * running bridge's files on the next start, see applyStagedRestore.
 */
function stageRestoredPersist ({ extractedDir, configDir }) {
  const files = pairingFiles(path.join(extractedDir, 'persist'))
  if (files.length === 0) return []
  const staging = path.join(configDir, RESTORE_DIR)
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  files.forEach(name => fs.copyFileSync(path.join(extractedDir, 'persist', name), path.join(staging, name)))
  return files
}

/**
 * Called on start before HAP reads its storage. For every bridge in the staged restore the
 * current AccessoryInfo and IdentifierCache are replaced as a pair.
 */
function applyStagedRestore ({ configDir, log }) {
  const staging = path.join(configDir, RESTORE_DIR)
  if (!fs.existsSync(staging)) return []
  const persist = path.join(configDir, 'persist')
  const files = pairingFiles(staging)
  fs.mkdirSync(persist, { recursive: true })

  new Set(files.map(name => name.match(PAIRING_FILE)[2])).forEach(id => {
    ;['AccessoryInfo', 'IdentifierCache'].forEach(kind => {
      const current = path.join(persist, `${kind}.${id}.json`)
      if (fs.existsSync(current)) fs.unlinkSync(current)
    })
  })
  files.forEach(name => fs.copyFileSync(path.join(staging, name), path.join(persist, name)))
  fs.rmSync(staging, { recursive: true, force: true })
  if (files.length > 0) log.info('[Persist] restored HomeKit pairing data from backup: %s', files.join(', '))
  return files
}

const HAP_USERNAME = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/

/**
 * Deletes the pairing of one bridge, named the way HAP-NodeJS names it
 * (AccessoryInfo.<username without colons, upper case>.json). The bridge
 * gets new keys and a new PIN pairing on its next start.
 */
function removePairing ({ configDir, username }) {
  if (!HAP_USERNAME.test(String(username))) throw new Error(`invalid bridge username ${username}`)
  const id = username.replace(/:/g, '').toUpperCase()
  const persist = path.join(configDir, 'persist')
  return ['AccessoryInfo', 'IdentifierCache']
    .map(kind => `${kind}.${id}.json`)
    .filter(name => {
      const file = path.join(persist, name)
      if (!fs.existsSync(file)) return false
      fs.unlinkSync(file)
      return true
    })
}

module.exports = { stageRestoredPersist, applyStagedRestore, removePairing, RESTORE_DIR }
