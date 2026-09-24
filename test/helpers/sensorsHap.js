'use strict'

/*
 * Helpers for the 15x_sensors_* tests: power up a fixture in test mode and read every readable
 * characteristic the way a HomeKit controller does, reporting values HAP-NodeJS had to reject or
 * correct (NaN, undefined, out of range) and read handlers that never answer.
 */

const path = require('path')
const fs = require('fs')
const Logger = require(path.join(__dirname, '..', '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', '..', 'lib', 'Server.js'))
const { Characteristic } = require('@homebridge/hap-nodejs')

const READ_TIMEOUT_MS = 500

function loadFixture (fileName) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'devices', fileName)).toString())
}

async function startServer (fileName, options = {}) {
  const data = loadFixture(fileName)
  const log = new Logger('HAP Test')
  log.setDebugEnabled(false)
  const server = new Server(log)
  await server.simulate(undefined, {
    config: Object.assign({ channels: Object.keys(data.ccu || {}) }, options.config || {}),
    devices: data.devices,
    mappings: options.mappings || data.mappings,
    values: Object.assign({}, options.values || {})
  })
  return { server, data }
}

function accessories (server) {
  return Object.keys(server._publishedAccessories).map(key => server._publishedAccessories[key])
}

function accessoryAt (server, address) {
  return accessories(server).find(accessory => accessory.address() === address)
}

function shutdown (server) {
  accessories(server).forEach(accessory => accessory.shutdown())
}

function withTimeout (promise, ms) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('read handler did not answer within ' + ms + ' ms')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function isReadable (characteristic) {
  return characteristic.props.perms.includes('pr') &&
    characteristic.UUID !== Characteristic.ProgrammableSwitchEvent.UUID
}

// reads one characteristic; resolves { value, problems }
async function readCharacteristic (characteristic, service) {
  const problems = []
  const label = (service.displayName || service.UUID) + ' / ' + characteristic.displayName
  const onWarning = (type, message) => problems.push(label + ': ' + message)
  characteristic.on('characteristic-warning', onWarning)
  let value
  try {
    value = await withTimeout(characteristic.handleGetRequest(), READ_TIMEOUT_MS)
  } catch (e) {
    problems.push(label + ': ' + (e.message || ('HAP status ' + e)))
  } finally {
    characteristic.removeListener('characteristic-warning', onWarning)
  }
  return { value, problems }
}

// reads all readable characteristics of an accessory and returns the list of problems
async function readAll (accessory) {
  const problems = []
  for (const service of accessory.getHomeKitAccessory().services) {
    for (const characteristic of service.characteristics) {
      if (isReadable(characteristic)) {
        const result = await readCharacteristic(characteristic, service)
        problems.push(...result.problems)
      }
    }
  }
  return problems
}

// the first service with the given type and subtype (subtype undefined = any)
function findService (accessory, serviceType, subtype) {
  return accessory.getHomeKitAccessory().services.find(service =>
    service.UUID === serviceType.UUID && ((subtype === undefined) || (service.subtype === subtype)))
}

async function read (characteristic) {
  return withTimeout(characteristic.handleGetRequest(), READ_TIMEOUT_MS)
}

// records every HAP warning (illegal value, NaN, ...) raised on the accessory in list until stop() is called
function watchWarnings (accessory) {
  const list = []
  const listeners = []
  accessory.getHomeKitAccessory().services.forEach(service => {
    service.characteristics.forEach(characteristic => {
      const listener = (type, message) => list.push(characteristic.displayName + ': ' + message)
      characteristic.on('characteristic-warning', listener)
      listeners.push(() => characteristic.removeListener('characteristic-warning', listener))
    })
  })
  return { list, stop: () => listeners.forEach(remove => remove()) }
}

// lets pending promise callbacks (async read handlers, event handlers) run
function settle (ms = 10) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = { startServer, accessoryAt, shutdown, readAll, findService, read, settle, watchWarnings }
