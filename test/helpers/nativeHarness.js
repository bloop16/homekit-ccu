'use strict'

/*
 * Helpers for the 17x_native_* tests: powers up one device of a fixture in test/devices (channel
 * layout and datapoints taken from the eQ-3 device definitions) through the openings harness.
 */

const path = require('path')
const fs = require('fs')
const { simulateDevice } = require(path.join(__dirname, 'openingsHarness.js'))

function loadFixture (fileName) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'devices', fileName)).toString())
}

/**
 * @param {string} fileName fixture in test/devices
 * @param {object} options
 * @param {number} options.channel channel that gets the accessory
 * @param {string} options.service accessory class name
 * @param {object} [options.settings] device settings of the accessory
 * @param {object} [options.values] datapoints to add or override (short form 'channel.DP')
 * @param {string[]} [options.omit] datapoints the CCU has not reported yet
 */
function simulateFixture (fileName, options) {
  const fixture = loadFixture(fileName)
  const device = fixture.devices[0]
  const values = Object.assign({}, fixture.values || {}, options.values || {})
  ;(options.omit || []).forEach(key => { delete values[key] })
  return simulateDevice({
    type: device.type,
    address: device.address,
    intf: device.intfName,
    channels: device.channels.map(channel => channel.type),
    channel: options.channel,
    service: options.service,
    settings: options.settings,
    values
  })
}

/** the channel types of a fixture, index = channel number */
function fixtureChannels (fileName) {
  return loadFixture(fileName).devices[0].channels.map(channel => channel.type)
}

module.exports = { simulateFixture, fixtureChannels, loadFixture }
