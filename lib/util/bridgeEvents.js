'use strict'

// Pairing and characteristic warnings of a bridge in the add-on log. Without a listener hap-nodejs
// writes the warnings to the console, and a failed "Add Accessory" in Apple Home leaves no trace at all.

// warnings that point at a real problem; slow reads and writes of the CCU and debug messages
// are only of interest when debugging
const WARN_TYPES = ['warn-message', 'error-message', 'timeout-read', 'timeout-write']
// a busy CCU lets many characteristics time out at once; the same warning once a minute is enough
const REPEAT_AFTER_MS = 60000

function describeWarning (warning) {
  const chain = Array.isArray(warning.originatorChain) ? warning.originatorChain.join(' > ') : ''
  return chain ? chain + ': ' + warning.message : String(warning.message)
}

function attachBridgeLogging (bridge, bridgeName, log, now = Date.now) {
  const lastLogged = new Map()
  bridge.on('paired', () => log.info('[Server] bridge %s was paired with Apple Home', bridgeName))
  bridge.on('unpaired', () => log.info('[Server] bridge %s was unpaired from Apple Home', bridgeName))
  bridge.on('characteristic-warning', (warning) => {
    if (!warning) return
    const text = describeWarning(warning)
    if (WARN_TYPES.indexOf(warning.type) === -1) {
      log.debug('[Server] bridge %s: %s', bridgeName, text)
      return
    }
    const time = now()
    if (lastLogged.has(text) && (time - lastLogged.get(text) < REPEAT_AFTER_MS)) return
    lastLogged.set(text, time)
    log.warn('[Server] bridge %s: %s', bridgeName, text)
  })
}

module.exports = { attachBridgeLogging }
