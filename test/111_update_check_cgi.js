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

  it('keeps the plain text answer and the download redirect', () => {
    expect(script).to.contain('$cmd == "download"')
    expect(script).to.contain('url=$package_url')
    expect(script).to.contain('puts "n/a"')
  })
})
