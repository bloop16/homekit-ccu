'use strict'

// Reads many datapoints of the CCU with a few Rega scripts instead of one request each:
// Rega runs one script at a time, so single reads of every value queue up for many seconds.

// printable separators: Rega string literals know no escapes for control characters
const FIELD_SEP = '|#hk#|'
const RECORD_SEP = '|;hk;|'
const CHUNK_SIZE = 50
// channel datapoints like HmIP-RF.000A60C9A06093:1.STATE; anything else never goes into a script
const DATAPOINT = /^[\w-]+\.[\w-]+:\d+\.[\w-]+$/
// actions, not states: their last value read again would look like a new key press
const ACTION = /\.(PRESS_[\w]+|INSTALL_TEST|EVENT)$/

function bulkReadScripts (addresses) {
  const valid = [...new Set(addresses)].filter(address => DATAPOINT.test(address) && !ACTION.test(address))
  const scripts = []
  for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
    const lines = valid.slice(i, i + CHUNK_SIZE).map(address =>
      `o = dom.GetObject('${address}'); if (o) { Write('${address}${FIELD_SEP}'); Write(o.Value()); Write('${RECORD_SEP}'); }`
    )
    scripts.push('object o;\n' + lines.join('\n'))
  }
  return scripts
}

// { address: value } of the answer, only for the addresses that were asked for
function parseBulkRead (answer, addresses) {
  const asked = new Set(addresses)
  const values = {}
  String(answer || '').split(RECORD_SEP).forEach(record => {
    const index = record.indexOf(FIELD_SEP)
    if (index < 0) return
    const address = record.slice(0, index).trim()
    if (asked.has(address)) {
      values[address] = record.slice(index + FIELD_SEP.length)
    }
  })
  return values
}

module.exports = { bulkReadScripts, parseBulkRead, FIELD_SEP, RECORD_SEP, CHUNK_SIZE }
