'use strict'

const util = require('util')

/**
 * Logger stand-in that records every formatted line (debug included) for assertions.
 */
function recordingLog () {
  const lines = []
  const record = (level) => (...args) => lines.push({ level, text: util.format(...args) })
  return {
    lines,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    text: (level) => lines.filter(l => !level || l.level === level).map(l => l.text).join('\n')
  }
}

module.exports = { recordingLog }
