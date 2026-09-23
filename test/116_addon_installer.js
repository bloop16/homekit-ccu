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
echo '{}' > package-lock.json`,
  'start-stop-daemon': '#!/bin/sh\necho "start-stop-daemon $*" >> "$STUB_CALLS"',
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
    LIGHTTPD_CONF_DIR: `${root}/lighttpd`
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
    www: path.join(root, 'config', 'addons', 'www', 'homekit-ccu')
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

  it('points the start message at the log file the server uses', () => {
    const script = fs.readFileSync(INSTALLER, 'utf8')
    expect(script).not.to.contain('/tmp/homekit-ccu.log')
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
