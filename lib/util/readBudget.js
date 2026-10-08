'use strict'

/*
 * Every read of Apple Home is answered in time. hap-nodejs warns after 3 s that a read handler
 * "was slow to respond" and gives up after 9 s ("didn't respond at all", "No Response" in Apple
 * Home). A read that waits for the CCU (Rega runs one script at a time; after a start it reads the
 * databases and the values of all devices) is answered after BUDGET_MS with the last known value
 * of the characteristic instead; the value read from the CCU follows when it comes and is
 * reported to Apple Home like an event.
 *
 * This is done once for all characteristics at Characteristic.handleGetRequest, where hap-nodejs
 * asks the read handler ('get' listener or onGet) of every characteristic.
 */

const BUDGET_MS = 2500
const LATE = Symbol('late')

/**
 * @param {function} Characteristic the Characteristic class of hap-nodejs
 * @param {object} log the logger (debug)
 * @param {number} budgetMs how long a read may wait for its handler
 */
function installReadBudget (Characteristic, log, budgetMs = BUDGET_MS) {
  const proto = Characteristic.prototype
  if (proto.handleGetRequest.withReadBudget) {
    proto.handleGetRequest.withReadBudget.budgetMs = budgetMs
    return
  }
  const original = proto.handleGetRequest
  const settings = { budgetMs }
  const handleGetRequest = function (connection, context) {
    const characteristic = this
    const pending = original.call(this, connection, context)
    // nothing known to answer with: the read waits as before
    if ((characteristic.value === null) || (characteristic.value === undefined)) {
      return pending
    }
    let timer
    const late = new Promise(resolve => { timer = setTimeout(() => resolve(LATE), settings.budgetMs) })
    return Promise.race([pending, late]).then((value) => {
      if (value !== LATE) {
        clearTimeout(timer)
        return value
      }
      const known = characteristic.value
      if (log) {
        log.debug('[HAP] %s did not answer within %s ms, answering the last known value %s', characteristic.displayName, settings.budgetMs, known)
      }
      // the late answer of the handler updates the value. hap-nodejs reports that change to every
      // device but the one that read (the originator), which got the last known value: it is told
      // here, as for an event of the CCU
      pending.then((value) => {
        if (value !== known) {
          characteristic.emit('change', { originator: undefined, oldValue: known, newValue: value, reason: 'event', context: undefined })
        }
      }, (error) => {
        if (log) {
          log.debug('[HAP] the late read of %s failed: %s', characteristic.displayName, (error && error.message) || error)
        }
      })
      return known
    }, (error) => {
      clearTimeout(timer)
      throw error
    })
  }
  handleGetRequest.withReadBudget = settings
  proto.handleGetRequest = handleGetRequest
}

module.exports = { installReadBudget, BUDGET_MS }
