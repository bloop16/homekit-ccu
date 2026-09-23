'use strict'

const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { redact, StderrTail } = require(path.join(__dirname, 'ffmpegLog.js'))

const ENCODER_LINE = /^\s*[AVS][.A-Z]{5}\s+(\S+)/
// After 'exit', wait this long at most for the rest of stderr so the error tail is complete.
const STDERR_DRAIN_MS = 250
// stop() sends SIGTERM first so ffmpeg can close its outputs, SIGKILL after this delay.
const KILL_TIMEOUT_MS = 1500

// Every running ffmpeg child; killed when the bridge process exits so no stream outlives it.
const liveChildren = new Set()
process.once('exit', () => {
  for (const child of liveChildren) {
    try {
      child.kill('SIGKILL')
    } catch (e) {
      // already gone
    }
  }
})

function track (child) {
  if (child.pid !== undefined) {
    liveChildren.add(child)
  }
}

/**
 * Human readable reason why ffmpeg could not be run, with a hint for the common cases.
 */
function spawnFailure (ffmpegPath, err) {
  switch (err.code) {
    case 'EACCES':
      return `ffmpeg at ${ffmpegPath} is not executable (EACCES), run: chmod +x ${ffmpegPath}`
    case 'ENOENT':
      return `ffmpeg not found at ${ffmpegPath} (ENOENT), check the ffmpeg path setting`
    default:
      return `ffmpeg at ${ffmpegPath} cannot be run: ${err.message}`
  }
}

function withTail (message, tail) {
  const text = tail.text()
  return text ? `${message}: ${text}` : message
}

/**
 * Thin wrapper around one ffmpeg child process.
 * options: { env, stdin (open a stdin pipe), killTimeoutMs, onExit(code, signal, expected) }
 */
class FfmpegProcess {
  constructor (label, ffmpegPath, args, log, options = {}) {
    this.label = label
    this.ffmpegPath = ffmpegPath
    this.args = args
    this.log = log
    this.env = Object.assign({}, process.env, options.env || {})
    this.onExit = options.onExit || (() => {})
    this.stdin = Boolean(options.stdin)
    this.killTimeoutMs = options.killTimeoutMs || KILL_TIMEOUT_MS
    this.child = null
    this.expectedExit = false
    this.stderrTail = new StderrTail()
  }

  /**
   * Spawn ffmpeg. onExit fires exactly once, also when the binary cannot be spawned at all.
   */
  start () {
    this.log.debug('[ffmpeg:%s] %s %s', this.label, this.ffmpegPath, redact(this.args.join(' ')))
    const child = spawn(this.ffmpegPath, this.args, { env: this.env, stdio: [this.stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'] })
    this.child = child
    track(child)
    child.stderr.on('data', (data) => {
      this.stderrTail.push(data)
      this.log.debug('[ffmpeg:%s] %s', this.label, redact(String(data).trim()))
    })
    if (child.stdin) {
      // A dying ffmpeg must not take the server down with an EPIPE on stdin.
      child.stdin.on('error', (err) => this.log.debug('[ffmpeg:%s] stdin error: %s', this.label, err.message))
    }
    child.on('error', (err) => {
      this.log.error('[ffmpeg:%s] %s', this.label, spawnFailure(this.ffmpegPath, err))
      // A failed spawn emits no 'exit' event, so finish here.
      if (child.pid === undefined) {
        this.finish(child, null, null)
      }
    })
    child.on('exit', (code, signal) => this.afterStderr(child, () => this.finish(child, code, signal)))
    return this
  }

  afterStderr (child, callback) {
    if (child.stderr.readableEnded || child.stderr.destroyed) {
      callback()
      return
    }
    const done = () => {
      clearTimeout(timer)
      child.stderr.removeListener('end', done)
      child.stderr.removeListener('close', done)
      callback()
    }
    const timer = setTimeout(done, STDERR_DRAIN_MS)
    child.stderr.once('end', done)
    child.stderr.once('close', done)
  }

  finish (child, code, signal) {
    if (this.child !== child) {
      return
    }
    const expected = this.expectedExit
    if (!expected) {
      this.log.warn('[ffmpeg:%s] %s', this.label, withTail(`exited unexpectedly (code ${code}, signal ${signal})`, this.stderrTail))
    }
    this.child = null
    liveChildren.delete(child)
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
    if (this.child && this.child.stdin && this.child.stdin.writable) {
      this.child.stdin.write(data)
      this.child.stdin.end()
    }
  }

  /**
   * Stop the process (SIGTERM, SIGKILL after killTimeoutMs) and resolve once it has exited.
   * The exit is reported to onExit as expected.
   */
  stop () {
    return new Promise((resolve) => {
      const child = this.child
      if (!child) {
        resolve()
        return
      }
      this.expectedExit = true
      const timer = setTimeout(() => {
        if (this.child === child) {
          this.log.debug('[ffmpeg:%s] no exit after SIGTERM, sending SIGKILL', this.label)
          child.kill('SIGKILL')
        }
      }, this.killTimeoutMs)
      child.once('finished', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }

  /**
   * Children that are currently running (for orphan protection and tests).
   */
  static get liveChildren () {
    return liveChildren
  }

  static get KILL_TIMEOUT_MS () {
    return KILL_TIMEOUT_MS
  }

  /**
   * Run ffmpeg -encoders once and return the set of encoder names,
   * or null (with an actionable error logged) when ffmpeg cannot be run.
   */
  static probeEncoders (ffmpegPath, log) {
    const result = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 10000 })
    if (result.error) {
      log.error('[ffmpeg] encoder probe failed: %s', spawnFailure(ffmpegPath, result.error))
      return null
    }
    if (result.status !== 0) {
      const tail = new StderrTail()
      tail.push(result.stderr || '')
      log.error('[ffmpeg] encoder probe failed: %s', withTail(`ffmpeg at ${ffmpegPath} exited with code ${result.status}`, tail))
      return null
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
   * Rejections carry the last stderr lines.
   */
  static collectStdout (ffmpegPath, args, log, timeoutMs = 15000, env = {}) {
    return new Promise((resolve, reject) => {
      const chunks = []
      const tail = new StderrTail()
      log.debug('[ffmpeg:snapshot] %s %s', ffmpegPath, redact(args.join(' ')))
      const child = spawn(ffmpegPath, args, { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] })
      track(child)
      child.once('exit', () => liveChildren.delete(child))
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(withTail(`ffmpeg snapshot timeout after ${timeoutMs}ms`, tail)))
      }, timeoutMs)
      child.stdout.on('data', (data) => chunks.push(data))
      child.stderr.on('data', (data) => {
        tail.push(data)
        log.debug('[ffmpeg:snapshot] %s', redact(String(data).trim()))
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        liveChildren.delete(child)
        reject(new Error(spawnFailure(ffmpegPath, err)))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve(Buffer.concat(chunks))
        } else {
          reject(new Error(withTail(`ffmpeg snapshot exited with code ${code}`, tail)))
        }
      })
    })
  }
}

module.exports = FfmpegProcess
