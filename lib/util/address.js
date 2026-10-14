'use strict'

/*
 * Helpers for the addresses of the CCU: a channel (SERIAL:1), or a datapoint with its interface
 * (HmIP-RF.SERIAL:1.STATE).
 */

/** the part before the channel number: the serial of a channel, interface and serial of a datapoint */
const serialOf = (address) => String(address).split(':')[0]

module.exports = { serialOf }
