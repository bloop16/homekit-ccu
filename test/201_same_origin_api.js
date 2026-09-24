const path = require('path')
const fs = require('fs')
const os = require('os')
const childProcess = require('child_process')
const { pathToFileURL } = require('url')
const expect = require('expect.js')

const ROOT = path.join(__dirname, '..')
const CONF = path.join(ROOT, 'etc', 'homekit_ccu.conf')

describe('HomeKit-CCU configuration api on the origin of the WebUI', () => {
  let Network
  const oldWindow = global.window

  before(async () => {
    ({ Network } = await import(pathToFileURL(path.join(ROOT, 'lib', 'configurationsrv', 'html', 'js', 'network.js')).href))
  })

  after(() => {
    global.window = oldWindow
  })

  const apiBase = (href) => {
    const location = new URL(href)
    global.window = { location }
    return new Network('sid').apiBase
  }

  it('calls the api on the host and port of the page', () => {
    // on the CCU the page is an add-on page of the WebUI (http or https, any port)
    expect(apiBase('https://ccu.local/addons/homekit-ccu/index.html?sid=@x@')).to.be('https://ccu.local/addons/homekit-ccu')
    expect(apiBase('http://192.168.1.13:8080/addons/homekit-ccu/?sid=@x@')).to.be('http://192.168.1.13:8080/addons/homekit-ccu')
    // in remote mode the config server serves the page itself
    expect(apiBase('http://pi.local:9874/index.html?sid=@x@')).to.be('http://pi.local:9874')
    expect(apiBase('http://pi.local:9874/?sid=@x@')).to.be('http://pi.local:9874')
    // behind a reverse proxy with a path of its own
    expect(apiBase('https://home.example/ccu/addons/homekit-ccu/index.html')).to.be('https://home.example/ccu/addons/homekit-ccu')
  })

  it('lets lighttpd pass only the api and the restore upload to the config server, without own ports', () => {
    const conf = fs.readFileSync(CONF, 'utf8')
    expect(conf).to.contain('$HTTP["url"] =~ "^/addons/homekit-ccu/(api|restore)/"')
    expect(conf).to.contain('"/addons/homekit-ccu/api/" => "/api/"')
    expect(conf).not.to.contain('$SERVER["socket"]')
    // lighttpd auth of the WebUI (if any) stays in force for the api
    expect(conf).not.to.match(/^\s*auth\.require/m)
  })

  it('is a valid lighttpd config after the other includes of the CCU', function () {
    const lighttpd = ['/usr/sbin/lighttpd', '/usr/bin/lighttpd'].find(file => fs.existsSync(file))
    if (!lighttpd) {
      this.skip()
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-201-'))
    try {
      fs.mkdirSync(path.join(dir, 'conf'))
      // another add-on ends with a socket condition, as on the CCU
      fs.writeFileSync(path.join(dir, 'conf', 'a-other.conf'), '$SERVER["socket"] == ":2001" { }\n')
      fs.copyFileSync(CONF, path.join(dir, 'conf', 'homekit-ccu.conf'))
      fs.writeFileSync(path.join(dir, 'lighttpd.conf'), [
        'server.modules = ( "mod_access", "mod_proxy" )',
        `server.document-root = "${dir}"`,
        'server.port = 8180',
        `include "${dir}/conf/*.conf"`
      ].join('\n') + '\n')
      const result = childProcess.spawnSync(lighttpd, ['-t', '-f', path.join(dir, 'lighttpd.conf')], { encoding: 'utf8' })
      expect(result.stdout + result.stderr).to.contain('Syntax OK')
      expect(result.status).to.be(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('hands the firewall scripts of the installer to tclsh unexpanded', () => {
    const installer = fs.readFileSync(path.join(ROOT, 'addon_installer', 'homekit-ccu'), 'utf8')
    const heredocs = installer.match(/tclsh - <<\S+/g)
    expect(heredocs.length).to.be.greaterThan(0)
    // with <<EOF the shell would replace $Firewall_USER_PORTS by an empty text
    heredocs.forEach(heredoc => expect(heredoc).to.be("tclsh - <<'EOF'"))
  })
})
