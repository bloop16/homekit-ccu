'use strict'

/*
 * ffmpeg for the video doorbell. OpenCCU ships none; this installs a static build of
 * ffmpeg-for-homebridge (the builds Homebridge uses for HomeKit cameras: libx264, libopus,
 * libfdk_aac, SRTP), pinned to one release. The SHA-256 of every archive is part of the add-on:
 * a download that does not match is deleted before anything is unpacked or run.
 * The build contains the non-free fdk-aac, so it is never shipped with the add-on; it is
 * downloaded from the Homebridge project when the user asks for it.
 * It goes to its own directory: an update of the add-on (which replaces the add-on directory)
 * keeps it, the backup (the configuration directory) does not carry its 80 MB.
 */

const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const childProcess = require('child_process')

const INSTALL_DIR = '/usr/local/addons/homekit-ccu-ffmpeg'
const RELEASE_URL = 'https://github.com/homebridge/ffmpeg-for-homebridge/releases/download/'
const MAX_REDIRECTS = 5
const IDLE_TIMEOUT_MS = 60000
const PROBE_TIMEOUT_MS = 10000
// the binary inside the archive
const ARCHIVE_MEMBER = path.join('usr', 'local', 'bin', 'ffmpeg')

// by Node's process.arch; OpenCCU is aarch64 (CCU3, Pi, Charly) or x86_64 (VM) since 2026,
// arm (32 bit) only for older installations
const FFMPEG_BUILDS = Object.freeze({
  release: 'v2.2.2',
  version: '8.0',
  assets: Object.freeze({
    arm64: { file: 'ffmpeg-alpine-aarch64.tar.gz', sha256: '3ed1724533921b6b54d1fd35802af62abd29e8672e0afb94bb2f8c18158323a3', size: 29961411 },
    x64: { file: 'ffmpeg-alpine-x86_64.tar.gz', sha256: 'b29b9d64111410a322e5e5558d1c4f968864ca44630329dc6cd31295997999a3', size: 30832184 },
    arm: { file: 'ffmpeg-alpine-arm32v7.tar.gz', sha256: '7ca3a11389c3f1f06d620a3a1949a5ecfdc16112dd88ba2e7e9cdc8ec278d3af', size: 16579727 }
  })
})

/** { url, sha256, size } of the build for an architecture, undefined when there is none */
function assetFor (arch, builds = FFMPEG_BUILDS) {
  const asset = builds.assets[arch]
  if (!asset) {
    return undefined
  }
  return {
    url: asset.url || (RELEASE_URL + builds.release + '/' + asset.file),
    sha256: asset.sha256,
    size: asset.size
  }
}

/** the version and encoders of an ffmpeg binary, undefined when it cannot be run */
function probe (binary) {
  if (!fs.existsSync(binary)) {
    return undefined
  }
  const run = (args) => childProcess.spawnSync(binary, args, { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS })
  const version = run(['-hide_banner', '-version'])
  if (version.error || version.status !== 0) {
    return undefined
  }
  const encoders = run(['-hide_banner', '-encoders']).stdout || ''
  const has = (name) => new RegExp('^\\s*[VAS][.\\w]{5}\\s+' + name + '\\s', 'm').test(encoders)
  const match = /ffmpeg version (\S+)/.exec(version.stdout || '')
  return {
    version: match ? match[1] : 'unknown',
    video: has('libx264'),
    audio: has('libopus') || has('libfdk_aac')
  }
}

/**
 * Streams url into file, following redirects (GitHub serves release assets from another host),
 * at most maxBytes; resolves with the SHA-256 of the content.
 */
function download (url, file, { maxBytes, allowHttp, redirects = MAX_REDIRECTS }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    if (target.protocol !== 'https:' && !(allowHttp && target.protocol === 'http:')) {
      reject(new Error('ffmpeg is only downloaded over https, not from ' + target.protocol))
      return
    }
    const client = (target.protocol === 'https:') ? https : http
    const request = client.get(target, { timeout: IDLE_TIMEOUT_MS }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume()
        if (redirects <= 0) {
          reject(new Error('too many redirects'))
          return
        }
        download(new URL(response.headers.location, target).href, file, { maxBytes, allowHttp, redirects: redirects - 1 }).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error('the download answered HTTP ' + response.statusCode))
        return
      }
      const hash = crypto.createHash('sha256')
      const out = fs.createWriteStream(file, { mode: 0o600 })
      let size = 0
      let failed = false
      const fail = (error) => {
        if (!failed) {
          failed = true
          response.destroy()
          out.destroy()
          reject(error)
        }
      }
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          fail(new Error('the download is larger than the pinned ffmpeg build'))
          return
        }
        hash.update(chunk)
      })
      response.on('error', fail)
      out.on('error', fail)
      out.on('finish', () => {
        if (!failed) {
          resolve(hash.digest('hex'))
        }
      })
      response.pipe(out)
    })
    request.on('timeout', () => request.destroy(new Error('the download stalled')))
    request.on('error', reject)
  })
}

class FfmpegInstaller {
  /**
   * @param {{dir?: string, log: object, builds?: object, arch?: string, allowHttp?: boolean}} options
   *   allowHttp only for tests
   */
  constructor ({ dir = process.env.HOMEKIT_CCU_FFMPEG_DIR || INSTALL_DIR, log, builds = FFMPEG_BUILDS, arch = process.arch, allowHttp = false } = {}) {
    this.dir = dir
    this.log = log
    this.builds = builds
    this.arch = arch
    this.allowHttp = allowHttp
    this.state = 'idle'
    this.message = ''
  }

  get binary () {
    return path.join(this.dir, 'ffmpeg')
  }

  /** what the configuration shows: supported, installed, version, encoders, state of an installation */
  async status () {
    const found = probe(this.binary)
    const state = (this.state === 'idle' && found) ? 'installed' : this.state
    return {
      supported: assetFor(this.arch, this.builds) !== undefined,
      arch: this.arch,
      release: this.builds.release,
      installed: found !== undefined,
      path: found ? this.binary : undefined,
      version: found ? found.version : undefined,
      video: found ? found.video : false,
      audio: found ? found.audio : false,
      state,
      message: this.message
    }
  }

  /** downloads, verifies and installs ffmpeg; resolves with { path, version, video, audio } */
  async install () {
    if (this.running) {
      throw new Error('an installation of ffmpeg is already running')
    }
    this.running = true
    this.message = ''
    const work = path.join(this.dir, '.install-' + crypto.randomBytes(6).toString('hex'))
    try {
      const asset = assetFor(this.arch, this.builds)
      if (!asset) {
        throw new Error('there is no ffmpeg build for this system (' + this.arch + ')')
      }
      fs.mkdirSync(work, { recursive: true, mode: 0o700 })
      const archive = path.join(work, 'ffmpeg.tar.gz')
      this.state = 'downloading'
      this.log.info('[ffmpeg] downloading %s', asset.url)
      const sha256 = await download(asset.url, archive, { maxBytes: asset.size, allowHttp: this.allowHttp })
      if (sha256 !== asset.sha256) {
        throw new Error('the SHA-256 of the download does not match (' + sha256 + '), nothing was installed')
      }
      this.state = 'installing'
      childProcess.execFileSync('tar', ['-xzf', archive, '-C', work], { timeout: 120000 })
      const unpacked = path.join(work, ARCHIVE_MEMBER)
      if (!fs.existsSync(unpacked) || !fs.lstatSync(unpacked).isFile()) {
        throw new Error('the archive has no ffmpeg')
      }
      // tar as root keeps the owner stored in the archive: the binary belongs to the add-on
      if (typeof process.getuid === 'function') {
        fs.chownSync(unpacked, process.getuid(), process.getgid())
      }
      fs.chmodSync(unpacked, 0o755)
      const found = probe(unpacked)
      if (!found) {
        throw new Error('the downloaded ffmpeg does not run on this system')
      }
      fs.renameSync(unpacked, this.binary)
      this.state = 'installed'
      this.log.info('[ffmpeg] installed %s (%s) at %s', found.version, this.builds.release, this.binary)
      return { path: this.binary, ...found }
    } catch (e) {
      this.state = 'failed'
      this.message = e.message
      this.log.error('[ffmpeg] installation failed: %s', e.message)
      throw e
    } finally {
      fs.rmSync(work, { recursive: true, force: true })
      this.running = false
    }
  }
}

module.exports = { FFMPEG_BUILDS, INSTALL_DIR, assetFor, probe, FfmpegInstaller }
