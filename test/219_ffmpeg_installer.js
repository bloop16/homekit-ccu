'use strict'

// ffmpeg for the video doorbell: OpenCCU has none. A button in the configuration downloads a
// static build of ffmpeg-for-homebridge, pinned to one release, and installs it only when its
// SHA-256 matches the one the add-on carries; nothing unverified is unpacked or run.

const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const crypto = require('crypto')
const childProcess = require('child_process')
const expect = require('expect.js')
const { FFMPEG_BUILDS, assetFor, FfmpegInstaller } = require(path.join(__dirname, '..', 'lib', 'util', 'ffmpegInstaller.js'))

// a stand-in for ffmpeg: a shell script answering -version and -encoders
const FAKE_FFMPEG = `#!/bin/sh
case "$*" in
  *-encoders*) printf ' V....D libx264              libx264 H.264\\n A....D libopus              libopus Opus\\n A....D libfdk_aac           Fraunhofer FDK AAC\\n' ;;
  *) echo "ffmpeg version 8.0-test Copyright (c) 2000-2025 the FFmpeg developers" ;;
esac
`

function fakeArchive (dir) {
  const root = path.join(dir, 'archive')
  fs.mkdirSync(path.join(root, 'usr', 'local', 'bin'), { recursive: true })
  fs.writeFileSync(path.join(root, 'usr', 'local', 'bin', 'ffmpeg'), FAKE_FFMPEG, { mode: 0o755 })
  const file = path.join(dir, 'ffmpeg-test.tar.gz')
  childProcess.execFileSync('tar', ['-czf', file, '-C', root, '.'])
  const content = fs.readFileSync(file)
  return { content, sha256: crypto.createHash('sha256').update(content).digest('hex') }
}

async function serve (routes) {
  const requests = []
  const server = http.createServer((request, response) => {
    requests.push(request.url)
    const route = routes[request.url]
    if (!route) {
      response.writeHead(404)
      response.end()
    } else if (route.redirect) {
      response.writeHead(302, { Location: route.redirect })
      response.end()
    } else {
      response.writeHead(200, { 'Content-Type': 'application/gzip' })
      response.end(route.body)
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { base: 'http://127.0.0.1:' + server.address().port, requests, close: () => server.close() }
}

describe('HomeKit-CCU ffmpeg installer', () => {
  let tmp
  let installDir
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-219-'))
    installDir = path.join(tmp, 'homekit-ccu-ffmpeg')
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const log = { info () {}, warn () {}, error () {}, debug () {} }
  const installerFor = (asset, extra = {}) => new FfmpegInstaller({ dir: installDir, log, builds: { ...FFMPEG_BUILDS, assets: { x64: asset } }, arch: 'x64', allowHttp: true, ...extra })

  it('pins ffmpeg-for-homebridge v2.2.2 for arm64, x64 and legacy 32 bit arm, by SHA-256', () => {
    expect(FFMPEG_BUILDS.release).to.be('v2.2.2')
    expect(assetFor('arm64', FFMPEG_BUILDS)).to.eql({
      url: 'https://github.com/homebridge/ffmpeg-for-homebridge/releases/download/v2.2.2/ffmpeg-alpine-aarch64.tar.gz',
      sha256: '3ed1724533921b6b54d1fd35802af62abd29e8672e0afb94bb2f8c18158323a3',
      size: 29961411
    })
    expect(assetFor('x64', FFMPEG_BUILDS).sha256).to.be('b29b9d64111410a322e5e5558d1c4f968864ca44630329dc6cd31295997999a3')
    expect(assetFor('arm', FFMPEG_BUILDS).sha256).to.be('7ca3a11389c3f1f06d620a3a1949a5ecfdc16112dd88ba2e7e9cdc8ec278d3af')
    expect(assetFor('ia32', FFMPEG_BUILDS)).to.be(undefined)
  })

  it('downloads (following the redirect of GitHub), verifies and installs ffmpeg, then reports its encoders', async () => {
    const archive = fakeArchive(tmp)
    const server = await serve({ '/release': { redirect: '/objects/ffmpeg' }, '/objects/ffmpeg': { body: archive.content } })
    try {
      const installer = installerFor({ url: server.base + '/release', sha256: archive.sha256, size: archive.content.length })
      expect((await installer.status()).installed).to.be(false)
      const result = await installer.install()
      expect(result.path).to.be(path.join(installDir, 'ffmpeg'))
      expect(fs.statSync(result.path).mode & 0o777).to.be(0o755)
      expect(fs.statSync(result.path).uid).to.be(process.getuid())
      const status = await installer.status()
      expect(status).to.eql({ supported: true, arch: 'x64', release: 'v2.2.2', installed: true, path: result.path, version: '8.0-test', video: true, audio: true, state: 'installed', message: '' })
      expect(server.requests).to.eql(['/release', '/objects/ffmpeg'])
      // nothing but the binary is left in the directory
      expect(fs.readdirSync(installDir)).to.eql(['ffmpeg'])
    } finally {
      server.close()
    }
  })

  it('installs nothing when the SHA-256 does not match', async () => {
    const archive = fakeArchive(tmp)
    const server = await serve({ '/release': { body: archive.content } })
    try {
      const installer = installerFor({ url: server.base + '/release', sha256: '0'.repeat(64), size: archive.content.length })
      let error
      await installer.install().catch(e => { error = e })
      expect(error.message).to.contain('SHA-256')
      expect(fs.existsSync(path.join(installDir, 'ffmpeg'))).to.be(false)
      expect(fs.existsSync(installDir) ? fs.readdirSync(installDir) : []).to.eql([])
      const status = await installer.status()
      expect(status.state).to.be('failed')
      expect(status.message).to.contain('SHA-256')
    } finally {
      server.close()
    }
  })

  it('stops a download larger than the pinned file', async () => {
    const archive = fakeArchive(tmp)
    const server = await serve({ '/release': { body: Buffer.concat([archive.content, Buffer.alloc(1024 * 1024)]) } })
    try {
      const installer = installerFor({ url: server.base + '/release', sha256: archive.sha256, size: archive.content.length })
      let error
      await installer.install().catch(e => { error = e })
      expect(error.message).to.contain('larger')
      expect(fs.existsSync(path.join(installDir, 'ffmpeg'))).to.be(false)
    } finally {
      server.close()
    }
  })

  it('refuses plain http outside the tests and unsupported architectures', async () => {
    const plain = new FfmpegInstaller({ dir: installDir, log, builds: { ...FFMPEG_BUILDS, assets: { x64: { url: 'http://example.invalid/x', sha256: 'a', size: 1 } } }, arch: 'x64' })
    let error
    await plain.install().catch(e => { error = e })
    expect(error.message).to.contain('https')
    const other = new FfmpegInstaller({ dir: installDir, log, arch: 'ia32' })
    expect((await other.status()).supported).to.be(false)
    error = undefined
    await other.install().catch(e => { error = e })
    expect(error.message).to.contain('ia32')
  })

  it('runs one installation at a time', async () => {
    const archive = fakeArchive(tmp)
    const server = await serve({ '/release': { body: archive.content } })
    try {
      const installer = installerFor({ url: server.base + '/release', sha256: archive.sha256, size: archive.content.length })
      const first = installer.install()
      let error
      await installer.install().catch(e => { error = e })
      expect(error.message).to.contain('already')
      await first
    } finally {
      server.close()
    }
  })

  it('reports an existing ffmpeg of the add-on as installed without a download', async () => {
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'ffmpeg'), FAKE_FFMPEG, { mode: 0o755 })
    const status = await new FfmpegInstaller({ dir: installDir, log, arch: 'x64' }).status()
    expect(status.installed).to.be(true)
    expect(status.version).to.be('8.0-test')
  })

  describe('api of the configuration', () => {
    const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))

    function serviceWith (installer) {
      const service = Object.create(ConfigurationService.prototype)
      service.log = { error () {}, info () {}, debug () {}, warn () {} }
      service.useAuth = false
      service.ffmpegInstaller = installer
      service.sent = []
      service.process = { send: (message) => service.sent.push(message) }
      return service
    }

    async function callApi (service, method) {
      const response = { headersSent: false, writeHead () { this.headersSent = true }, end (body) { this.body = body } }
      await service.processApiCall({ method }, response)
      return JSON.parse(response.body)
    }

    it('reports the status of ffmpeg', async () => {
      const service = serviceWith({ status: async () => ({ supported: true, installed: false, state: 'idle' }) })
      expect(await callApi(service, 'ffmpegStatus')).to.eql({ supported: true, installed: false, state: 'idle' })
    })

    it('starts the installation, answers at once and reloads the bridges when it is done', async () => {
      let finish
      const installer = {
        state: 'idle',
        install () {
          this.state = 'downloading'
          return new Promise(resolve => { finish = () => { this.state = 'installed'; resolve({}) } })
        },
        status: async function () { return { state: this.state } }
      }
      const service = serviceWith(installer)
      expect(await callApi(service, 'installFfmpeg')).to.eql({ state: 'downloading' })
      expect(service.sent).to.eql([])
      finish()
      await new Promise(resolve => setImmediate(resolve))
      expect(service.sent).to.eql([{ topic: 'reloadApplicances' }])
    })

    it('reloads nothing when the installation failed', async () => {
      const installer = { install: () => Promise.reject(new Error('SHA-256')), status: async () => ({ state: 'failed', message: 'SHA-256' }) }
      const service = serviceWith(installer)
      expect(await callApi(service, 'installFfmpeg')).to.eql({ state: 'failed', message: 'SHA-256' })
      await new Promise(resolve => setImmediate(resolve))
      expect(service.sent).to.eql([])
    })
  })
})
