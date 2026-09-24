'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const childProcess = require('child_process')
const util = require('util')
const expect = require('expect.js')
const { unsafeArchiveEntries } = require(path.join(__dirname, '..', 'lib', 'util', 'backupArchive.js'))
const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-125-'))

const archive = (dir, build) => {
  const src = path.join(dir, 'src')
  fs.mkdirSync(src, { recursive: true })
  build(src)
  const file = path.join(dir, 'backup.tar.gz')
  childProcess.execFileSync('tar', ['-czf', file, '-C', src, '.'])
  return file
}

describe('HomeKit-CCU backup hardening', () => {
  describe('unsafeArchiveEntries', () => {
    it('accepts a normal backup', () => {
      const dir = scratch()
      const file = archive(dir, (src) => {
        fs.writeFileSync(path.join(src, 'config.json'), '{}')
        fs.mkdirSync(path.join(src, 'persist'))
        fs.writeFileSync(path.join(src, 'persist', 'AccessoryInfo.AABBCCDDEEFF.json'), '{}')
      })
      expect(unsafeArchiveEntries(file)).to.eql([])
    })

    it('reports symbolic links', () => {
      const dir = scratch()
      const file = archive(dir, (src) => {
        fs.writeFileSync(path.join(src, 'config.json'), '{}')
        fs.symlinkSync('/etc', path.join(src, 'persist'))
      })
      expect(unsafeArchiveEntries(file)).to.eql(['./persist'])
    })

    it('reports entries that leave the target directory', () => {
      const dir = scratch()
      const src = path.join(dir, 'src', 'a')
      fs.mkdirSync(src, { recursive: true })
      fs.writeFileSync(path.join(dir, 'src', 'evil.json'), '{}')
      const file = path.join(dir, 'backup.tar.gz')
      // GNU tar keeps "../" when asked to, like a crafted archive would
      childProcess.execFileSync('tar', ['-P', '-czf', file, '-C', src, '../evil.json'])
      expect(unsafeArchiveEntries(file)).to.eql(['../evil.json'])
    })

    it('reports an unreadable archive as unsafe', () => {
      const dir = scratch()
      const file = path.join(dir, 'broken.tar.gz')
      fs.writeFileSync(file, 'not an archive')
      expect(unsafeArchiveEntries(file).length).to.be(1)
    })
  })

  describe('ConfigurationService', () => {
    const makeService = () => {
      const service = Object.create(ConfigurationService.prototype)
      const lines = []
      const record = (...args) => lines.push(util.format(...args))
      service.log = { debug: record, info: record, warn: record, error: record }
      return { service, lines }
    }

    it('refuses to extract an archive with a symbolic link', () => {
      const dir = scratch()
      const file = archive(dir, (src) => {
        fs.writeFileSync(path.join(src, 'config.json'), '{}')
        fs.symlinkSync('/etc', path.join(src, 'persist'))
      })
      const { service, lines } = makeService()
      service.deleteFolderRecursive = (p) => fs.rmSync(p, { recursive: true, force: true })
      expect(service.checkAndExtractUploadedConfig(file)).to.be(false)
      expect(lines.join('\n')).to.contain('unsafe entries')
    })

    it('creates the backup without a shell and readable by root only', async () => {
      const dir = scratch()
      const config = path.join(dir, 'config')
      fs.mkdirSync(config)
      fs.writeFileSync(path.join(config, 'config.json'), '{"instances":{}}')
      fs.writeFileSync(path.join(config, 'x_persist.json'), '{}')
      const old = process.env.UIX_CONFIG_PATH
      process.env.UIX_CONFIG_PATH = config
      try {
        const { service } = makeService()
        const file = await service.generateBackup()
        expect(fs.statSync(file).mode & 0o077).to.be(0)
        const names = childProcess.execFileSync('tar', ['-tzf', file], { encoding: 'utf8' })
        expect(names).to.contain('config.json')
        expect(names).not.to.contain('x_persist.json')
        fs.unlinkSync(file)
      } finally {
        process.env.UIX_CONFIG_PATH = old
      }
    })

    it('only passes numeric ports to the firewall script', () => {
      const { service } = makeService()
      const scripts = []
      service.runFirewallTcl = (script) => scripts.push(script)
      service.bridges = [{ port: 9877 }, { port: '9878' }, { port: '1]; exec rm -rf /; #' }]
      service.ensureFirewallPorts()
      service.removeFirewallPort('1]; exec reboot; #')
      expect(scripts[0]).to.contain('9877 9878}')
      expect(scripts.join('\n')).not.to.contain('exec')
      expect(scripts.length).to.be(1)
    })

    it('does not log the setup codes of new instances', () => {
      const { service, lines } = makeService()
      service.loadSettings = () => ({ instances: {} })
      let saved
      service.saveSettings = (config) => { saved = config }
      service.process = { send () {} }
      service.ensureFirewallPorts = () => {}
      service.compatibleDevices = []
      service.applyAssistant(JSON.stringify({ bridges: [{ key: 'k', name: 'Küche', roomId: 1 }], devices: [] }))
      const instance = Object.values(saved.instances)[0]
      expect(instance.pincode).to.match(/^\d{3}-\d{2}-\d{3}$/)
      expect(lines.join('\n')).not.to.contain(instance.pincode)
    })
  })
})
