'use strict'

/*
 * Test harness for the opening and security accessories (test/14x_openings_*.js):
 * builds a one-device CCU from a compact description, collects every HAP characteristic
 * warning (an illegal value HomeKit would reject) and reads characteristics the way a
 * HomeKit controller does.
 */

const path = require('path')
const Logger = require(path.join(__dirname, '..', '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', '..', 'lib', 'Server.js'))

const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * @param {object} spec
 * @param {string} spec.type device type, e.g. HmIP-SWDO-PL-2
 * @param {string} spec.address device serial
 * @param {string[]} spec.channels channel types, index = channel number
 * @param {number} spec.channel channel that gets the accessory
 * @param {string} spec.service accessory class name
 * @param {object} [spec.settings] device settings of the accessory
 * @param {object} [spec.values] datapoints the CCU knows (short form 'channel.DP')
 * @param {string} [spec.intf] interface name, default HmIP
 */
async function simulateDevice (spec) {
  const intf = spec.intf || 'HmIP'
  const channels = spec.channels.map((type, index) => ({
    id: 2001 + index,
    name: spec.address + ':' + index,
    intf: 0,
    address: spec.address + ':' + index,
    type,
    access: 255
  }))
  const devices = [{
    id: 2000,
    intf: 0,
    intfName: intf,
    name: spec.type,
    address: spec.address,
    type: spec.type,
    channels
  }]
  const address = spec.address + ':' + spec.channel
  const mappings = { [address]: { Service: spec.service, settings: spec.settings || {} } }
  const values = {}
  Object.keys(spec.values || {}).forEach(key => {
    values[intf + '.' + spec.address + ':' + key] = spec.values[key]
  })
  const server = new Server(log)
  await server.simulate(undefined, { config: { channels: [address] }, devices, mappings, values })
  const accessory = server._publishedAccessories[Object.keys(server._publishedAccessories)[0]]
  const warnings = collectWarnings(accessory)
  await settle()
  const dp = (short) => intf + '.' + spec.address + ':' + short
  return {
    server,
    accessory,
    warnings,
    dp,
    fire: (short, value) => server._ccu.fireEvent(dp(short), value),
    ccuValue: (short) => server._ccu.dummyValues[dp(short)],
    shutdown: () => Object.keys(server._publishedAccessories).forEach(key => server._publishedAccessories[key].shutdown())
  }
}

/** HAP characteristic warnings (illegal values HomeKit would reject) of an accessory, as short text */
function collectWarnings (accessory) {
  const warnings = []
  accessory.homeKitAccessory.on('characteristic-warning', warning => {
    warnings.push(warning.characteristic.displayName + ': ' + warning.message)
  })
  return warnings
}

/** reads a characteristic through its get handler like a HomeKit controller */
function read (characteristic) {
  return characteristic.handleGetRequest()
}

/** writes a characteristic like a HomeKit controller */
function write (characteristic, value) {
  return characteristic.handleSetRequest(value)
}

function findService (accessory, serviceType, subtype) {
  return accessory.homeKitAccessory.services.find(s => s.UUID === serviceType.UUID && (subtype === undefined || s.subtype === subtype))
}

module.exports = { simulateDevice, collectWarnings, read, write, settle, findService }
