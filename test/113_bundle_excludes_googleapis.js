const path = require('path')
const { execFileSync } = require('child_process')
const expect = require('expect.js')

const ROOT = path.join(__dirname, '..')
const PACK_TIMEOUT_MS = 60 * 1000
const MAX_TARBALL_BYTES = 8 * 1024 * 1024
// googleapis and its transitive tree, formerly pulled in by fakegato-history for Google-Drive storage
const EXCLUDED_PREFIXES = [
  'node_modules/googleapis',
  'node_modules/google-auth-library',
  'node_modules/gaxios',
  'node_modules/gcp-metadata',
  'node_modules/gtoken',
  'node_modules/fakegato-history/'
]

describe('HomeKit-CCU addon bundle', function () {
  this.timeout(PACK_TIMEOUT_MS + 5000)

  let pack

  before(() => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: PACK_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    pack = JSON.parse(out)[0]
  })

  it('bundles the runtime dependencies', () => {
    const paths = pack.files.map(f => f.path)
    expect(paths).to.contain('node_modules/@homebridge/hap-nodejs/package.json')
    expect(paths).to.contain('lib/vendor/fakegato-history/fakegato-history.js')
  })

  it('does not bundle googleapis or its dependencies', () => {
    const offending = pack.files
      .map(f => f.path)
      .filter(p => EXCLUDED_PREFIXES.some(prefix => p.startsWith(prefix)))
    expect(offending).to.eql([])
  })

  it('keeps the tarball below 8 MB', () => {
    expect(pack.size).to.be.below(MAX_TARBALL_BYTES)
  })
})
