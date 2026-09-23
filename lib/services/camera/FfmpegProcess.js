'use strict'

const { spawn, spawnSync } = require('child_process')

const ENCODER_LINE = /^\s*[AVS][.A-Z]{5}\s+(\S+)/

/**
 * Thin wrapper around one ffmpeg child process.
 * options: { env, onExit(code, signal, expected) }
 */
class FfmpegProcess {
  constructor (label, ffmpegPath, args, log, options = {}) {
    this.label = label
    this.ffmpegPath = ffmpegPath
    this.args = args
    this.log = log
    this.env = Object.assign({}, process.env, options.env || {})
    this.onExit = options.onExit || (() => {})
    this.child = null
    this.expectedExit = false
  }

  /**
   * Spawn ffmpeg. onExit fires exactly once, also when the binary cannot be spawned at all.
   */
  start () {
    this.log.debug('[ffmpeg:%s] %s %s', this.label, this.ffmpegPath, this.args.join(' '))
    const child = spawn(this.ffmpegPath, this.args, { env: this.env, stdio: ['pipe', 'ignore', 'pipe'] })
    this.child = child
    child.stderr.on('data', (data) => this.log.debug('[ffmpeg:%s] %s', this.label, String(data).trim()))
    // A dying ffmpeg must not take the server down with an EPIPE on stdin.
    child.stdin.on('error', (err) => this.log.debug('[ffmpeg:%s] stdin error: %s', this.label, err.message))
    child.on('error', (err) => {
      this.log.error('[ffmpeg:%s] spawn error: %s', this.label, err.message)
      // A failed spawn emits no 'exit' event, so finish here.
      if (child.pid === undefined) {
        this.finish(child, null, null)
      }
    })
    child.on('exit', (code, signal) => this.finish(child, code, signal))
    return this
  }

  finish (child, code, signal) {
    if (this.child !== child) {
      return
    }
    const expected = this.expectedExit
    if (!expected) {
      this.log.warn('[ffmpeg:%s] exited unexpectedly (code %s, signal %s)', this.label, code, signal)
    }
    this.child = null
    child.emit('finished')
    this.onExit(code, signal, expected)
  }

  /**
   * @returns {boolean} true while the child process is alive
   */
  isRunning () {
    return this.child !== null
  }

  /**
   * Write data to ffmpeg's stdin and close it (used to hand over the return audio SDP).
   */
  writeStdin (data) {
    if (this.child && this.child.stdin.writable) {
      this.child.stdin.write(data)
      this.child.stdin.end()
    }
  }

  /**
   * Kill the process and resolve once it has exited.
   */
  stop () {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve()
        return
      }
      this.expectedExit = true
      this.child.once('finished', () => resolve())
      this.child.kill('SIGKILL')
    })
  }

  /**
   * Run ffmpeg -encoders once and return the set of encoder names. Empty set if ffmpeg is unusable.
   */
  static probeEncoders (ffmpegPath, log) {
    const result = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 10000 })
    if (result.error || result.status !== 0) {
      log.warn('[ffmpeg] encoder probe failed for %s: %s', ffmpegPath, result.error ? result.error.message : `exit ${result.status}`)
      return new Set()
    }
    const encoders = new Set()
    for (const line of result.stdout.split('\n')) {
      const match = ENCODER_LINE.exec(line)
      if (match) {
        encoders.add(match[1])
      }
    }
    return encoders
  }

  /**
   * Run ffmpeg and resolve with everything it wrote to stdout (used for snapshots).
   */
  static collectStdout (ffmpegPath, args, log, timeoutMs = 15000, env = {}) {
    return new Promise((resolve, reject) => {
      const chunks = []
      const child = spawn(ffmpegPath, args, { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`ffmpeg snapshot timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      child.stdout.on('data', (data) => chunks.push(data))
      child.stderr.on('data', (data) => log.debug('[ffmpeg:snapshot] %s', String(data).trim()))
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve(Buffer.concat(chunks))
        } else {
          reject(new Error(`ffmpeg snapshot exited with code ${code}`))
        }
      })
    })
  }
}

module.exports = FfmpegProcess
