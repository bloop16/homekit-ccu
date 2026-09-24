'use strict'

/*
 * HomeKit pairing data lives in <config>/persist as AccessoryInfo.<ID>.json (bridge keys and
 * the paired iPhones) and IdentifierCache.<ID>.json (the aid/iid numbers Apple Home knows the
 * accessories by). Losing them means Apple Home no longer recognises the bridge.
 *
 * Two ways the files can get lost when coming from hap-homematic:
 *  - the new addon uses a new config directory, so the keys stay behind in the old one
 *  - a restored backup must not merge with keys the running bridge already created
 */

const fs = require('fs')
const path = require('path')

const MARKER_FILE = '.hap-homematic-pairing-checked'
const RESTORE_DIR = 'persist.restore'
const PAIRING_FILE = /^(AccessoryInfo|IdentifierCache)\.([0-9A-Fa-f]{12})\.json$/

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const pairingCount = (file) => {
  const info = readJSON(file)
  return Object.keys((info && info.pairedClients) || {}).length
}

const pairingFiles = (dir) => {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(name => PAIRING_FILE.test(name) && fs.statSync(path.join(dir, name)).isFile())
}

const bridgeIds = (files) => files
  .map(name => name.match(PAIRING_FILE))
  .filter(m => m[1] === 'AccessoryInfo')
  .map(m => m[2])

/**
 * Brings the pairing of hap-homematic over to homekit-ccu once. A bridge that is already
 * paired with homekit-ccu keeps its pairing.
 */
function migrateLegacyPersist ({ legacyDir, configDir, log }) {
  const result = { migrated: [], skipped: [] }
  const marker = path.join(configDir, MARKER_FILE)
  if (fs.existsSync(marker)) return result

  const legacyPersist = path.join(legacyDir, 'persist')
  const persist = path.join(configDir, 'persist')

  bridgeIds(pairingFiles(legacyPersist)).forEach(id => {
    const infoName = `AccessoryInfo.${id}.json`
    const cacheName = `IdentifierCache.${id}.json`
    try {
      if (pairingCount(path.join(legacyPersist, infoName)) === 0) return
      const target = path.join(persist, infoName)
      if (fs.existsSync(target) && pairingCount(target) > 0) {
        log.info('[Persist] bridge %s is already paired with homekit-ccu, keeping that pairing', id)
        result.skipped.push(id)
        return
      }
      fs.mkdirSync(persist, { recursive: true })
      fs.copyFileSync(path.join(legacyPersist, infoName), target)
      const legacyCache = path.join(legacyPersist, cacheName)
      if (fs.existsSync(legacyCache)) {
        fs.copyFileSync(legacyCache, path.join(persist, cacheName))
      } else if (fs.existsSync(path.join(persist, cacheName))) {
        fs.unlinkSync(path.join(persist, cacheName))
      }
      log.info('[Persist] took over the HomeKit pairing of bridge %s from hap-homematic', id)
      result.migrated.push(id)
    } catch (e) {
      log.warn('[Persist] cannot take over the hap-homematic pairing of %s: %s', id, e.message)
    }
  })

  try {
    fs.writeFileSync(marker, new Date().toISOString())
  } catch (e) {
    log.warn('[Persist] cannot write %s: %s', marker, e.message)
  }
  return result
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

module.exports = { migrateLegacyPersist, stageRestoredPersist, applyStagedRestore, MARKER_FILE, RESTORE_DIR }
