'use strict'

const util = require('util')
const fs = require('fs')

let DEBUG_ENABLED = false
let LOGFILE
// the log is appended to (the installer writes into the same file); at startup a file larger
// than this is moved to <file>.1 so it cannot grow forever on the CCU's small /var/log
const ROTATE_SIZE = 2 * 1024 * 1024

function rotateIfLarge (logFile) {
  try {
    const stat = fs.statSync(logFile, { throwIfNoEntry: false })
    if (stat && stat.size > ROTATE_SIZE) {
      fs.renameSync(logFile, logFile + '.1') // replaces an older .1
    }
  } catch (e) {
    console.error('unable to rotate %s: %s', logFile, e.message)
  }
}

// ANSI styling only for terminals that support it (honours NO_COLOR/FORCE_COLOR via hasColors);
// the stream is checked here because util.styleText only validates it from Node.js 22.13 on
function paint (format, text, stream) {
  if (stream.isTTY && typeof stream.hasColors === 'function' && stream.hasColors()) {
    return util.styleText(format, text, { validateStream: false })
  }
  return text
}

/**
 * Logger class
 */

class Logger {
  constructor (prefix) {
    this.prefix = prefix
  }

  setDebugEnabled (enabled) {
    DEBUG_ENABLED = enabled
  }

  isDebugEnabled () {
    return DEBUG_ENABLED
  }

  setLogFile (logFile) {
    LOGFILE = logFile
    if (logFile) {
      rotateIfLarge(logFile)
      process.env.UIX_LOGFILE = logFile
    } else {
      delete process.env.UIX_LOGFILE
    }
  }

  getLogFile () {
    return LOGFILE
  }

  _getWriter () {
    if (LOGFILE) {
      if (!this.writer) {
        // only root reads the log (it can hold device names and the addresses of the home)
        this.writer = fs.createWriteStream(LOGFILE, { flags: 'a', mode: 0o600 })
        try {
          fs.chmodSync(LOGFILE, 0o600)
        } catch (e) {
          // not created yet or not ours; the stream creates it with mode 0600
        }
      }
      return this.writer
    }
  }

  close () {
    if (this.writer) {
      this.writer.end()
    }
  }

  debug (msg) {
    if (DEBUG_ENABLED) {
      this.log.apply(this, ['debug'].concat(Array.prototype.slice.call(arguments)))
    }
  }

  info (msg) {
    this.log.apply(this, ['info'].concat(Array.prototype.slice.call(arguments)))
  }

  warn (msg) {
    this.log.apply(this, ['warn'].concat(Array.prototype.slice.call(arguments)))
  }

  error (msg) {
    this.log.apply(this, ['error'].concat(Array.prototype.slice.call(arguments)))
  }

  log (level, msg) {
    const rawMsg = util.format.apply(util, Array.prototype.slice.call(arguments, 1))

    const toStderr = (level === 'warn') || (level === 'error')
    const func = toStderr ? console.error : console.log
    const stream = toStderr ? process.stderr : process.stdout

    if (level === 'debug') {
      msg = paint('gray', rawMsg, stream)
    } else if (level === 'warn') {
      msg = paint('yellow', rawMsg, stream)
    } else if (level === 'error') {
      msg = paint(['bold', 'red'], rawMsg, stream)
    } else {
      msg = rawMsg
    }

    // prepend prefix if applicable
    if (this.prefix) {
      msg = paint('cyan', '[' + this.prefix + ']', stream) + ' ' + msg
    }

    // prepend timestamp
    const date = new Date()
    msg = '[' + date.toLocaleString() + ']' + ' ' + msg
    try {
      const writer = this._getWriter()
      if (writer) {
        let lmsg = rawMsg
        if (this.prefix) {
          lmsg = '[' + this.prefix + '] ' + lmsg
        }
        lmsg = '[' + date.toLocaleString() + '] ' + level + ' - ' + lmsg
        if (writer.writable) {
          writer.write(lmsg + '\n')
        }
      }
    } catch (e) { }
    func(msg)
  }
}

module.exports = Logger
