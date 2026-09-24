'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const expect = require('expect.js')
const {
  applyStagedRestore,
  stageRestoredPersist,
  removePairing,
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
  describe('restore of a backup', () => {
    let configDir, extracted
    beforeEach(() => {
      configDir = tmpDir()
      extracted = tmpDir()
    })

    it('stages the persist folder of a backup even if homekit-ccu already has one', () => {
      writeJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234560D4E7F.json'), accessoryInfo({}))
      writeJSON(path.join(extracted, 'persist', 'AccessoryInfo.1234560D4E7F.json'), accessoryInfo({ 'A-B': 'cc' }))
      writeJSON(path.join(extracted, 'persist', 'IdentifierCache.1234560D4E7F.json'), { cache: {} })

      const staged = stageRestoredPersist({ extractedDir: extracted, configDir })

      expect(staged.sort()).to.eql(['AccessoryInfo.1234560D4E7F.json', 'IdentifierCache.1234560D4E7F.json'])
      // the running bridge keeps its files until the restart
      expect(readJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234560D4E7F.json')).pairedClients).to.eql({})
      expect(fs.existsSync(path.join(configDir, RESTORE_DIR, 'AccessoryInfo.1234560D4E7F.json'))).to.be(true)
    })

    it('applies the staged files on the next start and removes the staging folder', () => {
      writeJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234560D4E7F.json'), accessoryInfo({}))
      writeJSON(path.join(configDir, 'persist', 'IdentifierCache.1234560D4E7F.json'), { cache: { new: 1 } })
      writeJSON(path.join(configDir, RESTORE_DIR, 'AccessoryInfo.1234560D4E7F.json'), accessoryInfo({ 'A-B': 'cc' }))

      const applied = applyStagedRestore({ configDir, log: silentLog })

      expect(applied).to.eql(['AccessoryInfo.1234560D4E7F.json'])
      expect(readJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234560D4E7F.json')).pairedClients).to.eql({ 'A-B': 'cc' })
      // an IdentifierCache that belongs to the new keys must not survive next to the restored ones
      expect(fs.existsSync(path.join(configDir, 'persist', 'IdentifierCache.1234560D4E7F.json'))).to.be(false)
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

  describe('removePairing', () => {
    it('removes AccessoryInfo and IdentifierCache for a bridge username in HAP naming', () => {
      const configDir = tmpDir()
      writeJSON(path.join(configDir, 'persist', 'AccessoryInfo.1234560D4E7F.json'), accessoryInfo({ 'A-B': 'cc' }))
      writeJSON(path.join(configDir, 'persist', 'IdentifierCache.1234560D4E7F.json'), { cache: {} })
      writeJSON(path.join(configDir, 'persist', 'AccessoryInfo.AABBCCDDEEFF.json'), accessoryInfo({}))

      const removed = removePairing({ configDir, username: '12:34:56:0d:4e:7f' })

      expect(removed.sort()).to.eql(['AccessoryInfo.1234560D4E7F.json', 'IdentifierCache.1234560D4E7F.json'])
      expect(fs.readdirSync(path.join(configDir, 'persist'))).to.eql(['AccessoryInfo.AABBCCDDEEFF.json'])
    })

    it('rejects a username that is not a HAP MAC address', () => {
      const configDir = tmpDir()
      expect(() => removePairing({ configDir, username: '../../etc' })).to.throwError()
    })
  })
})
