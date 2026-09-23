'use strict'

const chalk = require('chalk')
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
        this.writer = fs.createWriteStream(LOGFILE, { flags: 'a' })
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

    let func = console.log

    if (level === 'debug') {
      msg = chalk.gray(rawMsg)
    } else if (level === 'warn') {
      msg = chalk.yellow(rawMsg)
      func = console.error
    } else if (level === 'error') {
      msg = chalk.bold.red(rawMsg)
      func = console.error
    } else {
      msg = rawMsg
    }

    // prepend prefix if applicable
    if (this.prefix) {
      msg = chalk.cyan('[' + this.prefix + ']') + ' ' + msg
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
