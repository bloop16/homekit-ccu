const path = require('path')
const fs = require('fs')
const expect = require('expect.js')

const CGI = path.join(__dirname, '..', 'lib', 'configurationsrv', 'html', 'update-check.cgi')

// tclsh is not available in CI, so the script is checked as text
describe('HomeKit-CCU update-check.cgi', () => {
  const script = fs.readFileSync(CGI, 'utf8')

  it('reads only cmd from the query string', () => {
    expect(script).not.to.contain('set $varname')
    expect(script).not.to.match(/\bset\s+\$/)
    expect(script).to.contain('regexp {(?:^|&)cmd=([^&]*)} $env(QUERY_STRING) -> cmd')
  })

  it('points the version check and the download at the fork', () => {
    expect(script).to.contain('set version_url "https://api.github.com/repos/bloop16/homekit-ccu/releases/latest"')
    expect(script).to.contain('set package_url "https://github.com/bloop16/homekit-ccu/releases/latest"')
  })

  it('answers only a version-shaped tag, never markup from the release json', () => {
    expect(script).to.contain('regexp {"tag_name"\\s*:\\s*"v([0-9][0-9A-Za-z.+-]*)"} $json -> newversion')
    expect(script).not.to.contain('v([^"]+)')
  })

  it('captures release tags and rejects anything else (the pattern reads the same in Tcl ARE and JS)', () => {
    const pattern = new RegExp(script.match(/regexp \{("tag_name"[^}]*)\} \$json/)[1])
    const capture = (tag) => { const m = pattern.exec(`{"url":"x","tag_name":"${tag}","name":"y"}`); return m && m[1] }
    expect(capture('v0.1.0')).to.be('0.1.0')
    expect(capture('v0.2.0-beta.1')).to.be('0.2.0-beta.1')
    expect(capture('v1.0.0+build.5')).to.be('1.0.0+build.5')
    expect(capture('v1<script>alert(1)</script>')).to.be(null)
    expect(capture('v<b>1</b>')).to.be(null)
    expect(capture('0.1.0')).to.be(null)
  })

  it('keeps the plain text answer and the download redirect', () => {
    expect(script).to.contain('$cmd == "download"')
    expect(script).to.contain('url=$package_url')
    expect(script).to.contain('puts "n/a"')
  })
})
