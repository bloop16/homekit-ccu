'use strict'

const TAIL_LINES = 8
const TAIL_MAX_CHARS = 2048

/**
 * Remove secrets from an ffmpeg command line or log line: URL credentials and SRTP keys.
 * @param {string} text
 * @returns {string}
 */
function redact (text) {
  return String(text)
    .replace(/\/\/[^\s/@]+@/g, '//***@')
    .replace(/(-srtp_out_params\s+)\S+/g, '$1***')
    .replace(/(inline:)\S+/g, '$1***')
}

/**
 * Ring buffer for the last stderr lines of an ffmpeg process, redacted, for error messages.
 */
class StderrTail {
  constructor () {
    this.lines = []
    this.partial = ''
  }

  /**
   * Add a stderr chunk; chunks may end in the middle of a line.
   */
  push (chunk) {
    const parts = (this.partial + String(chunk)).split(/\r?\n/)
    this.partial = parts.pop()
    for (const line of parts) {
      if (line.trim()) {
        this.lines.push(redact(line.trim()))
      }
    }
    this.lines = this.lines.slice(-TAIL_LINES)
    this.partial = this.partial.slice(-TAIL_MAX_CHARS)
  }

  /**
   * @returns {string} the kept lines joined with " | ", at most about 2 KB
   */
  text () {
    const lines = this.partial.trim() ? [...this.lines, redact(this.partial.trim())].slice(-TAIL_LINES) : this.lines
    const joined = lines.join(' | ')
    return joined.length > TAIL_MAX_CHARS ? '...' + joined.slice(-TAIL_MAX_CHARS) : joined
  }
}

module.exports = { redact, StderrTail }
