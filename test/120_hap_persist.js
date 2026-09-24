'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const expect = require('expect.js')
const {
  migrateLegacyPersist,
  applyStagedRestore,
  stageRestoredPersist,
  MARKER_FILE,
  RESTORE_DIR
} = require(path.join(__dirname, '..', 'lib', 'util', 'hapPersist.js'))

const silentLog = { info () {}, warn () {}, error () {}, debug () {} }

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-persist-'))

const writeJSON = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data))
}
const readJSON = (file) => JSON.parse(fs.readFileSync(file))

const accessoryInfo = (pairedClients) => ({ displayName: 'HomeMatic default', signSk: 'aa', signPk: 'bb', pairedClients })

describe('HomeKit-CCU HAP pairing persistence', () => {
  describe('migrateLegacyPersist', () => {
    let root, legacyDir, configDir
    beforeEach(() => {
      root = tmpDir()
      legacyDir = path.join(root, 'hap-homematic')
      configDir = path.join(root, 'homekit-ccu')
      fs.mkdirSync(configDir, { recursive: true })
    })

    it('copies paired AccessoryInfo and IdentifierCache from hap-homematic when homekit-ccu has none', () => {
      writeJSON(path.join(legacyDir, 'persist', 'AccessoryInfo.1234563CAEA1.json'), accessoryInfo({ 'A-B': 'cc' }))
      writeJSON(path.join(legacyDir, 'persist', 'IdentifierCache.1234563CAEA1.json'), { cache: { x: 2 } })

      const result = migrateLegacyPersist({ legacyDir, configDir, log: silentLog })

      expect(result.migrated).to.eql(['1234563CAEA1'])
      expect(readJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234563CAEA1.json')).pairedClients).to.eql({ 'A-B': 'cc' })
      expect(readJSON(path.join(configDir, 'persist', 'IdentifierCache.1234563CAEA1.json'))).to.eql({ cache: { x: 2 } })
      expect(fs.existsSync(path.join(configDir, MARKER_FILE))).to.be(true)
    })

    it('replaces a fresh unpaired AccessoryInfo that homekit-ccu created on its first start', () => {
      writeJSON(path.join(legacyDir, 'persist', 'AccessoryInfo.1234563CAEA1.json'), accessoryInfo({ 'A-B': 'cc' }))
      writeJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234563CAEA1.json'), accessoryInfo({}))

      const result = migrateLegacyPersist({ legacyDir, configDir, log: silentLog })

      expect(result.migrated).to.eql(['1234563CAEA1'])
      expect(readJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234563CAEA1.json')).pairedClients).to.eql({ 'A-B': 'cc' })
    })

    it('keeps a pairing that was made with homekit-ccu', () => {
      writeJSON(path.join(legacyDir, 'persist', 'AccessoryInfo.1234563CAEA1.json'), accessoryInfo({ OLD: 'cc' }))
      writeJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234563CAEA1.json'), accessoryInfo({ NEW: 'dd' }))

      const result = migrateLegacyPersist({ legacyDir, configDir, log: silentLog })

      expect(result.migrated).to.eql([])
      expect(result.skipped).to.eql(['1234563CAEA1'])
      expect(readJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234563CAEA1.json')).pairedClients).to.eql({ NEW: 'dd' })
    })

    it('ignores unpaired legacy bridges', () => {
      writeJSON(path.join(legacyDir, 'persist', 'AccessoryInfo.AABBCCDDEEFF.json'), accessoryInfo({}))
      const result = migrateLegacyPersist({ legacyDir, configDir, log: silentLog })
      expect(result.migrated).to.eql([])
      expect(fs.existsSync(path.join(configDir, 'persist', 'AccessoryInfo.AABBCCDDEEFF.json'))).to.be(false)
    })

    it('runs only once, so a later reset in the UI does not bring the old pairing back', () => {
      writeJSON(path.join(legacyDir, 'persist', 'AccessoryInfo.1234563CAEA1.json'), accessoryInfo({ 'A-B': 'cc' }))
      migrateLegacyPersist({ legacyDir, configDir, log: silentLog })
      fs.rmSync(path.join(configDir, 'persist'), { recursive: true })

      const result = migrateLegacyPersist({ legacyDir, configDir, log: silentLog })

      expect(result.migrated).to.eql([])
      expect(fs.existsSync(path.join(configDir, 'persist'))).to.be(false)
    })

    it('does nothing when there is no hap-homematic directory', () => {
      const result = migrateLegacyPersist({ legacyDir, configDir, log: silentLog })
      expect(result.migrated).to.eql([])
      expect(fs.existsSync(path.join(configDir, MARKER_FILE))).to.be(true)
    })

    it('survives a broken legacy file', () => {
      fs.mkdirSync(path.join(legacyDir, 'persist'), { recursive: true })
      fs.writeFileSync(path.join(legacyDir, 'persist', 'AccessoryInfo.1234563CAEA1.json'), '{broken')
      const result = migrateLegacyPersist({ legacyDir, configDir, log: silentLog })
      expect(result.migrated).to.eql([])
    })
  })

  describe('restore of a backup', () => {
    let configDir, extracted
    beforeEach(() => {
      configDir = tmpDir()
      extracted = tmpDir()
    })

    it('stages the persist folder of a backup even if homekit-ccu already has one', () => {
      writeJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234563CAEA1.json'), accessoryInfo({}))
      writeJSON(path.join(extracted, 'persist', 'AccessoryInfo.1234563CAEA1.json'), accessoryInfo({ 'A-B': 'cc' }))
      writeJSON(path.join(extracted, 'persist', 'IdentifierCache.1234563CAEA1.json'), { cache: {} })

      const staged = stageRestoredPersist({ extractedDir: extracted, configDir })

      expect(staged.sort()).to.eql(['AccessoryInfo.1234563CAEA1.json', 'IdentifierCache.1234563CAEA1.json'])
      // the running bridge keeps its files until the restart
      expect(readJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234563CAEA1.json')).pairedClients).to.eql({})
      expect(fs.existsSync(path.join(configDir, RESTORE_DIR, 'AccessoryInfo.1234563CAEA1.json'))).to.be(true)
    })

    it('applies the staged files on the next start and removes the staging folder', () => {
      writeJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234563CAEA1.json'), accessoryInfo({}))
      writeJSON(path.join(configDir, 'persist', 'IdentifierCache.1234563CAEA1.json'), { cache: { new: 1 } })
      writeJSON(path.join(configDir, RESTORE_DIR, 'AccessoryInfo.1234563CAEA1.json'), accessoryInfo({ 'A-B': 'cc' }))

      const applied = applyStagedRestore({ configDir, log: silentLog })

      expect(applied).to.eql(['AccessoryInfo.1234563CAEA1.json'])
      expect(readJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234563CAEA1.json')).pairedClients).to.eql({ 'A-B': 'cc' })
      // an IdentifierCache that belongs to the new keys must not survive next to the restored ones
      expect(fs.existsSync(path.join(configDir, 'persist', 'IdentifierCache.1234563CAEA1.json'))).to.be(false)
      expect(fs.existsSync(path.join(configDir, RESTORE_DIR))).to.be(false)
    })

    it('stages nothing when the backup has no persist folder', () => {
      expect(stageRestoredPersist({ extractedDir: extracted, configDir })).to.eql([])
      expect(fs.existsSync(path.join(configDir, RESTORE_DIR))).to.be(false)
    })

    it('ignores files that are not HAP pairing data', () => {
      writeJSON(path.join(extracted, 'persist', 'restartCounter.json'), 3)
      fs.writeFileSync(path.join(extracted, 'persist', '../../evil.json'.replace(/\.\.\//g, '')), '{}')
      expect(stageRestoredPersist({ extractedDir: extracted, configDir })).to.eql([])
    })

    it('does nothing on start when there is no staged restore', () => {
      expect(applyStagedRestore({ configDir, log: silentLog })).to.eql([])
    })
  })
})
