'use strict'

// Runs the rc.d installer's shell functions with /bin/sh against a scratch root: every CCU path
// is redirected into the scratch directory and every CCU command (npm, node, lighttpd, ...)
// is a stub on PATH, so nothing outside the scratch directory is touched.

const path = require('path')
const os = require('os')
const fs = require('fs')
const childProcess = require('child_process')
const expect = require('expect.js')

const INSTALLER = path.join(__dirname, '..', 'addon_installer', 'homekit-ccu')
const UPDATE_SCRIPT = path.join(__dirname, '..', 'addon_installer', 'update_script')

const STUBS = {
  // node --version answers STUB_NODE_VERSION, everything else (hm_addon.js) is recorded
  node: `#!/bin/sh
if [ "$1" = "--version" ]; then echo "\${STUB_NODE_VERSION:-v22.1.0}"; exit 0; fi
echo "node $*" >> "$STUB_CALLS"`,
  // npm i records whether a stale package-lock.json was still there, then acts per STUB_NPM
  npm: `#!/bin/sh
if [ "$1" = "--version" ]; then echo "10.0.0"; exit 0; fi
if [ -e package-lock.json ]; then echo "npm stale-lock" >> "$STUB_CALLS"; else echo "npm clean" >> "$STUB_CALLS"; fi
case "\${STUB_NPM:-ok}" in
  fail) echo "npm ERR! code ENOTCACHED"; exit 1 ;;
  noindex) echo '{}' > package-lock.json; exit 0 ;;
esac
M=node_modules/homekit-ccu
mkdir -p "$M/etc" "$M/lib/configurationsrv/html"
touch "$M/index.js" "$M/etc/hm_addon.js" "$M/etc/homekit_ccu.conf" "$M/etc/homekit_ccu_addon.cfg" "$M/lib/configurationsrv/html/index.html"
# npm packs every file with the time 1985-10-26
touch -d '1985-10-26 08:15' "$M/lib/configurationsrv/html/index.html"
echo '{}' > package-lock.json`,
  'start-stop-daemon': '#!/bin/sh\necho "start-stop-daemon $*" >> "$STUB_CALLS"',
  monit: '#!/bin/sh\necho "monit $*" >> "$STUB_CALLS"',
  // no-ops: must never reach the real commands (pgrep/kill would hit real processes)
  pgrep: '#!/bin/sh\nexit 1',
  killall: '#!/bin/sh\nexit 0',
  lighttpd: '#!/bin/sh\nexit 0',
  logger: '#!/bin/sh\nexit 0',
  tclsh: '#!/bin/sh\ncat > /dev/null',
  sleep: '#!/bin/sh\nexit 0'
}

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-116-'))
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  Object.entries(STUBS).forEach(([name, body]) => fs.writeFileSync(path.join(bin, name), body + '\n', { mode: 0o755 }))
  const vars = {
    ADDON_DIR: `${root}/addons/\${ADDON_NAME}`,
    CONFIG_DIR: `${root}/config`,
    NPMCACHE_DIR: `${root}/npm-cache`,
    PIDFILE: `${root}/homekit-ccu.pid`,
    LOGFILE: `${root}/homekit-ccu.log`,
    LOCKFILE: `${root}/homekit-ccu-install.lock`,
    LIGHTTPD_CONF_DIR: `${root}/lighttpd`,
    MONIT_DIR: `${root}/monit`,
    MONIT_BIN: `${bin}/monit`,
    HM_ADDONS_CFG: `${root}/hm_addons.cfg`
  }
  let script = fs.readFileSync(INSTALLER, 'utf8')
  Object.entries(vars).forEach(([name, value]) => {
    const line = new RegExp(`^${name}=.*$`, 'm')
    expect(line.test(script)).to.be(true) // the installer must keep defining ${name} on its own line
    script = script.replace(line, `${name}=${value}`)
  })
  const installer = path.join(root, 'homekit-ccu')
  fs.writeFileSync(installer, script, { mode: 0o755 })
  const addonDir = path.join(root, 'addons', 'homekit-ccu')
  const paths = {
    root,
    addonDir,
    moduleDir: path.join(addonDir, 'node_modules', 'homekit-ccu'),
    logfile: vars.LOGFILE,
    calls: path.join(root, 'calls'),
    www: path.join(root, 'config', 'addons', 'www', 'homekit-ccu'),
    legacy: {
      monitCfg: path.join(root, 'monit', 'monit_hap-homematic.cfg'),
      lighttpdConf: path.join(root, 'lighttpd', 'hap-homematic.conf'),
      configDir: path.join(root, 'config', 'addons', 'hap-homematic'),
      hmAddons: path.join(root, 'hm_addons.cfg')
    }
  }
  const run = (cmd, env = {}) => childProcess.spawnSync('/bin/sh', [installer, cmd], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_CALLS: paths.calls, ...env }
  })
  const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  return { ...paths, run, log: () => read(paths.logfile), callLog: () => read(paths.calls) }
}

describe('HomeKit-CCU addon installer', () => {
  let t
  beforeEach(() => { t = setup() })
  afterEach(() => fs.rmSync(t.root, { recursive: true, force: true }))

  it('installs and reports completion when npm succeeds', () => {
    const res = t.run('install')
    expect(res.status).to.be(0)
    expect(fs.existsSync(path.join(t.moduleDir, 'index.js'))).to.be(true)
    expect(fs.existsSync(path.join(t.www, 'index.html'))).to.be(true)
    expect(t.log()).to.contain('Installation complete.')
  })

  it('gives the WebUI files the time of the installation, so browsers load the new version', () => {
    expect(t.run('install').status).to.be(0)
    expect(Date.now() - fs.statSync(path.join(t.www, 'index.html')).mtimeMs).to.be.lessThan(60 * 1000)
  })

  it('removes a half-installed addon directory before npm runs', () => {
    fs.mkdirSync(t.addonDir, { recursive: true })
    fs.writeFileSync(path.join(t.addonDir, 'package-lock.json'), '{}')
    const res = t.run('install')
    expect(res.status).to.be(0)
    expect(t.callLog()).to.contain('npm clean')
    expect(t.callLog()).not.to.contain('npm stale-lock')
  })

  it('fails without "Installation complete" when npm fails', () => {
    const res = t.run('install', { STUB_NPM: 'fail' })
    expect(res.status).not.to.be(0)
    expect(t.log()).to.contain('ERROR: npm install failed')
    expect(t.log()).to.contain('ENOTCACHED')
    expect(t.log()).not.to.contain('Installation complete')
    expect(fs.existsSync(t.www)).to.be(false)
  })

  it('fails when npm leaves no index.js behind', () => {
    const res = t.run('install', { STUB_NPM: 'noindex' })
    expect(res.status).not.to.be(0)
    expect(t.log()).to.contain('index.js')
    expect(t.log()).to.contain('ERROR')
    expect(t.log()).not.to.contain('Installation complete')
  })

  it('keeps the WebUI button of an existing installation when Node.js is too old', () => {
    fs.mkdirSync(path.join(t.moduleDir, 'etc'), { recursive: true })
    fs.writeFileSync(path.join(t.moduleDir, 'etc', 'hm_addon.js'), '')
    fs.writeFileSync(path.join(t.moduleDir, 'index.js'), '')
    const res = t.run('background_install', { STUB_NODE_VERSION: 'v20.11.0' })
    expect(res.status).not.to.be(0)
    expect(t.log()).to.contain('too old')
    expect(t.callLog()).not.to.contain('hm_addon.js')
    expect(fs.existsSync(path.join(t.moduleDir, 'index.js'))).to.be(true)
  })

  it('does not start the server when the background install fails', async function () {
    this.timeout(10000)
    const res = t.run('background_install', { STUB_NPM: 'fail' })
    expect(res.status).to.be(0)
    const start = Date.now()
    while (!/installation failed/.test(t.log())) {
      if (Date.now() - start > 8000) throw new Error('background install did not finish: ' + t.log())
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(t.callLog()).not.to.contain('start-stop-daemon --start')
    expect(t.log()).not.to.contain('Starting HomeKit-CCU')
  })

  describe('legacy hap-homematic cleanup', () => {
    const BUTTONS = 'hap-homematic {CONFIG_URL /addons/hap-homematic/index.html CONFIG_DESCRIPTION {de x en y} ID hap-homematic CONFIG_NAME HAP-HomeMatic} '

    // hap-homematic is uninstalled first (update_script refuses otherwise); these can stay behind
    const createLeftovers = () => {
      const l = t.legacy
      fs.mkdirSync(path.dirname(l.monitCfg), { recursive: true })
      fs.writeFileSync(l.monitCfg, 'check process HapHomeMatic with pidfile /var/run/hap-homematic.pid\n')
      fs.mkdirSync(path.dirname(l.lighttpdConf), { recursive: true })
      fs.writeFileSync(l.lighttpdConf, '')
      fs.mkdirSync(l.configDir, { recursive: true })
      fs.writeFileSync(path.join(l.configDir, 'config.json'), '{}')
      fs.writeFileSync(l.hmAddons, BUTTONS)
    }

    it('removes what an uninstalled hap-homematic left behind but keeps its configuration', () => {
      createLeftovers()
      const res = t.run('install')
      expect(res.status).to.be(0)
      const l = t.legacy
      expect(fs.existsSync(l.monitCfg)).to.be(false)
      expect(t.callLog()).to.contain('monit reload')
      expect(fs.existsSync(l.lighttpdConf)).to.be(false)
      expect(t.callLog()).to.contain(`node ${path.join(t.moduleDir, 'etc', 'hm_addon.js')} hap-homematic\n`)
      expect(fs.existsSync(path.join(l.configDir, 'config.json'))).to.be(true)
      // the old button is removed before ours is created
      const calls = t.callLog()
      expect(calls.indexOf('hm_addon.js hap-homematic')).to.be.lessThan(calls.indexOf('hm_addon.js homekit-ccu'))
      ;['legacy monit config', 'legacy lighttpd config', 'legacy WebUI button']
        .forEach(step => expect(t.log()).to.contain(step))
      expect(t.log()).to.contain('Installation complete.')
    })

    it('does nothing when there are no leftovers', () => {
      fs.writeFileSync(t.legacy.hmAddons, 'homekit-ccu {CONFIG_URL /addons/homekit-ccu/index.html CONFIG_DESCRIPTION {de x en y} ID homekit-ccu CONFIG_NAME HomeKit} ')
      const res = t.run('install')
      expect(res.status).to.be(0)
      expect(t.callLog()).not.to.contain('hap-homematic')
      expect(t.callLog()).not.to.contain('legacy-rc')
      expect(t.callLog()).not.to.contain('monit')
      expect(t.log()).not.to.contain('legacy')
      expect(t.log()).to.contain('Installation complete.')
    })
  })

  it('points the start message at the log file the server uses', () => {
    const script = fs.readFileSync(INSTALLER, 'utf8')
    expect(script).not.to.contain('/tmp/homekit-ccu.log')
  })
})

// Runs update_script (what the CCU add-on upload executes) in a scratch copy of the extracted
// archive; CONFIG_DIR points into the scratch directory and node/the rc.d script are stubs.
const setupUpdate = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-116u-'))
  const bin = path.join(root, 'bin')
  const archive = path.join(root, 'archive')
  const configDir = path.join(root, 'config')
  fs.mkdirSync(bin)
  fs.mkdirSync(archive)
  // node --version answers STUB_NODE_VERSION (empty output when unset, like a broken node)
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\necho "$STUB_NODE_VERSION"\n', { mode: 0o755 })
  fs.writeFileSync(path.join(archive, 'homekit-ccu'), '#!/bin/sh\necho "rc $*" >> "$STUB_CALLS"\n')
  fs.writeFileSync(path.join(archive, 'homekit-ccu.tgz'), 'tgz')
  let script = fs.readFileSync(UPDATE_SCRIPT, 'utf8')
  const addonsDir = path.join(root, 'addons')
  ;[['CONFIG_DIR', configDir], ['ADDONS_DIR', addonsDir]].forEach(([name, value]) => {
    const line = new RegExp(`^${name}=.*$`, 'm')
    expect(line.test(script)).to.be(true) // update_script must keep defining ${name} on its own line
    script = script.replace(line, `${name}=${value}`)
  })
  fs.writeFileSync(path.join(archive, 'update_script'), script, { mode: 0o755 })
  const calls = path.join(root, 'calls')
  const run = (platform, nodeVersion) => childProcess.spawnSync('/bin/sh', ['update_script', platform], {
    cwd: archive,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_CALLS: calls, STUB_NODE_VERSION: nodeVersion }
  })
  return {
    root,
    configDir,
    legacyRcScript: path.join(configDir, 'rc.d', 'hap-homematic'),
    legacyAddonDir: path.join(addonsDir, 'hap-homematic'),
    rcScript: path.join(configDir, 'rc.d', 'homekit-ccu'),
    tgz: path.join(configDir, 'addons', 'homekit-ccu', 'etc', 'homekit-ccu.tgz'),
    run,
    callLog: () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''
  }
}

describe('HomeKit-CCU addon update_script', () => {
  let u
  beforeEach(() => { u = setupUpdate() })
  afterEach(() => fs.rmSync(u.root, { recursive: true, force: true }))

  it('installs on OpenCCU (HM-RASPBERRYMATIC) with Node.js 22+ and starts the background install', async () => {
    const res = u.run('HM-RASPBERRYMATIC', 'v22.12.0')
    expect(res.status).to.be(0)
    expect(fs.readFileSync(u.tgz, 'utf8')).to.be('tgz')
    expect(fs.statSync(u.rcScript).mode & 0o111).not.to.be(0)
    const start = Date.now()
    while (!/rc background_install/.test(u.callLog())) {
      if (Date.now() - start > 5000) throw new Error('background_install was not started')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  })

  it('accepts newer Node.js majors', () => {
    expect(u.run('HM-RASPBERRYMATIC', 'v24.3.0').status).to.be(0)
  })

  ;['CCU3', 'CCU2', ''].forEach(platform => {
    it(`refuses the platform '${platform}' without copying anything`, () => {
      const res = u.run(platform, 'v22.12.0')
      expect(res.status).to.be(1)
      expect(res.stderr).to.contain('unsupported platform')
      expect(res.stderr).to.contain('OpenCCU')
      expect(fs.existsSync(u.configDir)).to.be(false)
    })
  })

  it('refuses a too old Node.js before copying anything', () => {
    const res = u.run('HM-RASPBERRYMATIC', 'v20.11.0')
    expect(res.status).to.be(1)
    expect(res.stderr).to.contain('Node.js v20.11.0 is too old')
    expect(res.stderr).to.contain('Node.js 22 or newer')
    expect(fs.existsSync(u.configDir)).to.be(false)
    expect(u.callLog()).to.be('')
  })

  it('refuses when Node.js reports no version', () => {
    const res = u.run('HM-RASPBERRYMATIC', '')
    expect(res.status).to.be(1)
    expect(res.stderr).to.contain('Node.js not found')
    expect(fs.existsSync(u.configDir)).to.be(false)
  })

  it('refuses an unparsable Node.js version', () => {
    const res = u.run('HM-RASPBERRYMATIC', 'garbage')
    expect(res.status).to.be(1)
    expect(res.stderr).to.contain('too old')
    expect(fs.existsSync(u.configDir)).to.be(false)
  })

  describe('while hap-homematic is still installed', () => {
    const expectRefusal = (res) => {
      expect(res.status).to.be(1)
      expect(res.stderr).to.contain('hap-homematic is still installed')
      expect(res.stderr).to.contain('backup')
      expect(res.stderr).to.contain('uninstall hap-homematic')
      expect(fs.existsSync(u.rcScript)).to.be(false)
      expect(fs.existsSync(u.tgz)).to.be(false)
      expect(u.callLog()).to.be('')
    }

    it('refuses when its rc.d script exists', () => {
      fs.mkdirSync(path.dirname(u.legacyRcScript), { recursive: true })
      fs.writeFileSync(u.legacyRcScript, '#!/bin/sh\n')
      expectRefusal(u.run('HM-RASPBERRYMATIC', 'v22.12.0'))
    })

    it('refuses when its program directory exists', () => {
      fs.mkdirSync(u.legacyAddonDir, { recursive: true })
      expectRefusal(u.run('HM-RASPBERRYMATIC', 'v22.12.0'))
    })

    it('installs once only its configuration backup is left', () => {
      fs.mkdirSync(path.join(u.configDir, 'addons', 'hap-homematic'), { recursive: true })
      expect(u.run('HM-RASPBERRYMATIC', 'v22.12.0').status).to.be(0)
    })
  })

  it('does not mount /usr/local (CCU2-era leftover)', () => {
    expect(fs.readFileSync(UPDATE_SCRIPT, 'utf8')).not.to.match(/\bmount\b/)
  })
})

describe('HomeKit-CCU addon shell scripts', () => {
  const scripts = [INSTALLER, UPDATE_SCRIPT]
  const shells = ['/bin/sh', '/usr/bin/dash', '/bin/dash'].filter(sh => fs.existsSync(sh))

  it('parse with sh -n (and dash -n where available)', () => {
    shells.forEach(sh => scripts.forEach(script => {
      const res = childProcess.spawnSync(sh, ['-n', script], { encoding: 'utf8' })
      expect(res.status).to.be(0)
    }))
  })

  it('use no bash-only redirections or comparisons', () => {
    scripts.forEach(script => {
      const text = fs.readFileSync(script, 'utf8')
      expect(/&>/.test(text)).to.be(false)
      expect(/\[[^\]]*==[^\]]*\]/.test(text)).to.be(false)
    })
  })

  it('have LF line endings', () => {
    scripts.forEach(script => expect(fs.readFileSync(script, 'utf8').includes('\r')).to.be(false))
  })
})
