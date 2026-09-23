'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const util = require('util')
const expect = require('expect.js')
const MonitConfig = require(path.join(__dirname, '..', 'lib', 'monitConfig.js'))

const CONFLICT = "/usr/local/etc/monit_hap-homematic.cfg:2: Service name conflict, HapHomeMatic already defined '/var/run/hap-homematic.pid'"

// fake monit: records every call, fails with the CCU's conflict message when a "fail" file exists
const FAKE_MONIT = `#!/bin/sh
DIR=$(dirname "$0")
echo "monit $*" >> "$DIR/calls"
if [ -f "$DIR/fail" ]; then
  echo "${CONFLICT}" >&2
  echo "second line" >&2
  exit 1
fi
exit 0
`

describe('HomeKit-CCU monit config', () => {
  let root, lines, log, monit, paths

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-119-'))
    lines = { debug: [], info: [], warn: [], error: [] }
    log = {}
    Object.keys(lines).forEach(level => { log[level] = (...args) => lines[level].push(util.format(...args)) })
    paths = {
      monitBin: path.join(root, 'monit'),
      cfgFile: path.join(root, 'monit_homekit-ccu.cfg'),
      legacyCfgFile: path.join(root, 'monit_hap-homematic.cfg'),
      pidFile: path.join(root, 'homekit-ccu.pid'),
      rcScript: '/etc/config/rc.d/homekit-ccu'
    }
    fs.writeFileSync(paths.monitBin, FAKE_MONIT, { mode: 0o755 })
    fs.writeFileSync(paths.pidFile, '4711')
    monit = new MonitConfig(log, paths)
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  const calls = () => {
    const file = path.join(root, 'calls')
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : []
  }
  const config = () => fs.readFileSync(paths.cfgFile, 'utf8')

  it('writes the config under the service name HomekitCCU and reloads monit', () => {
    monit.install()
    expect(config()).to.contain(`check process HomekitCCU with pidfile ${paths.pidFile}\n`)
    expect(config()).to.contain('start = "/etc/config/rc.d/homekit-ccu start"')
    expect(config()).to.contain('stop = "/etc/config/rc.d/homekit-ccu stop"')
    expect(config()).to.contain('restart = "/etc/config/rc.d/homekit-ccu restart"')
    expect(config()).to.contain('exec "/bin/triggerAlarm.tcl \'homekit-ccu restarted\' WatchDog-Alarm"')
    expect(config()).to.match(/^# homekit-ccu /)
    expect(config()).not.to.contain('HapHomeMatic')
    expect(config()).not.to.contain('Hap-HomeMatic')
    expect(calls()).to.eql(['monit reload'])
  })

  it('uses the default CCU paths', () => {
    const cfg = new MonitConfig(log).buildConfig()
    expect(cfg).to.contain('check process HomekitCCU with pidfile /var/run/homekit-ccu.pid\n')
  })

  it('does not reload when the config is already current', () => {
    fs.writeFileSync(paths.cfgFile, monit.buildConfig())
    monit.install()
    expect(calls()).to.eql([])
  })

  it('rewrites a config with the old service name', () => {
    fs.writeFileSync(paths.cfgFile, 'check process HapHomeMatic with pidfile /var/run/homekit-ccu.pid\n')
    monit.install()
    expect(config()).to.contain('check process HomekitCCU')
    expect(calls()).to.eql(['monit reload'])
  })

  it('removes the stale hap-homematic monit config before writing', () => {
    fs.writeFileSync(paths.legacyCfgFile, 'check process HapHomeMatic with pidfile /var/run/hap-homematic.pid\n')
    monit.install()
    expect(fs.existsSync(paths.legacyCfgFile)).to.be(false)
    expect(fs.existsSync(paths.cfgFile)).to.be(true)
    expect(lines.info.join('\n')).to.contain(paths.legacyCfgFile)
    expect(calls()).to.eql(['monit reload'])
  })

  it('logs a failing reload as one warning line and does not throw', () => {
    fs.writeFileSync(path.join(root, 'fail'), '')
    expect(() => monit.install()).not.to.throwException()
    expect(lines.warn).to.eql([`[CCU] monit reload failed: ${CONFLICT}`])
    expect(lines.error).to.eql([])
    expect(fs.existsSync(paths.cfgFile)).to.be(true)
  })

  it('removes its config instead when there is no pid file', () => {
    fs.unlinkSync(paths.pidFile)
    fs.writeFileSync(paths.cfgFile, monit.buildConfig())
    monit.install()
    expect(fs.existsSync(paths.cfgFile)).to.be(false)
    expect(calls()).to.eql(['monit reload'])
  })

  it('remove() deletes the config and the stale legacy config', () => {
    fs.writeFileSync(paths.cfgFile, monit.buildConfig())
    fs.writeFileSync(paths.legacyCfgFile, '')
    monit.remove()
    expect(fs.existsSync(paths.cfgFile)).to.be(false)
    expect(fs.existsSync(paths.legacyCfgFile)).to.be(false)
    expect(calls()).to.eql(['monit reload'])
  })

  it('remove() does nothing when there is nothing to remove', () => {
    monit.remove()
    expect(calls()).to.eql([])
  })

  it('does nothing without monit', () => {
    fs.unlinkSync(paths.monitBin)
    fs.writeFileSync(paths.legacyCfgFile, '')
    monit.install()
    monit.remove()
    expect(fs.existsSync(paths.cfgFile)).to.be(false)
    expect(fs.existsSync(paths.legacyCfgFile)).to.be(true)
  })
})

describe('HomeKit-CCU HomeMaticCCU.processMonitoring', () => {
  const HomeMaticCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticCCU.js'))

  const ccuWith = (configuration, monitConfig) => {
    const lines = { warn: [], info: [] }
    const log = {
      debug: () => {},
      error: () => {},
      info: (...args) => lines.info.push(util.format(...args)),
      warn: (...args) => lines.warn.push(util.format(...args)),
      isDebugEnabled: () => false
    }
    const ccu = new HomeMaticCCU(log, configuration)
    ccu.monitConfig = monitConfig
    return { ccu, lines }
  }

  it('installs the monit config when monitoring is enabled', () => {
    const called = []
    const { ccu } = ccuWith({ enableMonitoring: true }, { install: () => called.push('install'), remove: () => called.push('remove') })
    ccu.processMonitoring()
    expect(called).to.eql(['install'])
  })

  it('removes the monit config when monitoring is disabled', () => {
    const called = []
    const { ccu } = ccuWith({}, { install: () => called.push('install'), remove: () => called.push('remove') })
    ccu.processMonitoring()
    expect(called).to.eql(['remove'])
  })

  it('never lets a monit failure abort the start', () => {
    const { ccu, lines } = ccuWith({ enableMonitoring: true }, { install: () => { throw new Error('EACCES') } })
    expect(() => ccu.processMonitoring()).not.to.throwException()
    expect(lines.warn).to.eql(['[CCU] monitoring setup failed: EACCES'])
  })
})
