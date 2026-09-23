'use strict'

/**
 * Current time as unix timestamp in whole seconds (replacement for moment().unix()).
 */
function nowUnix () {
  return Math.floor(Date.now() / 1000)
}

module.exports = { nowUnix }
