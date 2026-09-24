'use strict'

// An async read handler whose CCU read failed rejected before it called back: hap-nodejs waited
// 10 s for the answer ("didn't respond at all"), Apple Home showed "No Response" and the rejection
// went unhandled. HomeMaticAccessory.guardedGet answers such a read with the last known value.

const path = require('path')
const fs = require('fs')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const HomeMaticAccessory = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticAccessory.js'))
const { simulateDevice, read, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

const SERVICES_DIR = path.join(__dirname, '..', 'lib', 'services')

/** rejects when a read handler did not answer in time (hap-nodejs itself waits 10 s) */
function readWithin (characteristic, ms = 500) {
  return Promise.race([
    read(characteristic),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('read handler did not answer')), ms))
  ])
}

function bareAccessory () {
  const accessory = Object.create(HomeMaticAccessory.prototype)
  accessory.logs = []
  accessory.debugLog = (...args) => accessory.logs.push(args)
  return accessory
}

describe('HomeKit-CCU guarded read handlers', () => {
  describe('guardedGet', () => {
    it('answers with the value of the handler', async () => {
      const accessory = bareAccessory()
      const on = new Characteristic.On()
      on.on('get', accessory.guardedGet(async callback => callback(null, true)))
      expect(await readWithin(on)).to.be(true)
      expect(accessory.logs).to.eql([])
    })

    it('answers with the last known value when the handler rejects', async () => {
      const accessory = bareAccessory()
      const level = new Characteristic.Brightness()
      level.updateValue(42)
      level.on('get', accessory.guardedGet(async callback => {
        callback(null, await Promise.reject(new Error('socket hang up')))
      }))
      expect(await readWithin(level)).to.be(42)
      expect(accessory.logs.length).to.be(1)
      expect(accessory.logs[0].join(' ')).to.contain('socket hang up')
    })

    it('answers with the last known value when the handler throws synchronously', async () => {
      const accessory = bareAccessory()
      const on = new Characteristic.On()
      on.updateValue(true)
      on.on('get', accessory.guardedGet(() => { throw new Error('no address') }))
      expect(await readWithin(on)).to.be(true)
    })

    it('answers only once when the handler fails after it answered', async () => {
      const accessory = bareAccessory()
      const on = new Characteristic.On()
      let answers = 0
      on.on('get', accessory.guardedGet(async callback => {
        callback(null, true)
        throw new Error('late failure')
      }))
      // count the answers hap-nodejs receives
      const listener = on.listeners('get')[0]
      await new Promise(resolve => {
        listener.call(on, () => { answers++ }, undefined, undefined)
        setTimeout(resolve, 20)
      })
      expect(answers).to.be(1)
      expect(accessory.logs.length).to.be(1)
    })

    it('leaves an answer given later by the handler untouched', async () => {
      const accessory = bareAccessory()
      const on = new Characteristic.On()
      on.on('get', accessory.guardedGet(callback => {
        setTimeout(() => callback(null, true), 10)
      }))
      expect(await readWithin(on)).to.be(true)
      expect(accessory.logs).to.eql([])
    })

    it('passes a HomeKit error status of the handler on', async () => {
      const accessory = bareAccessory()
      const on = new Characteristic.On()
      on.on('get', accessory.guardedGet(async callback => callback(new Error('failed'))))
      let status
      await readWithin(on).catch(error => { status = error })
      expect(status).to.be.a('number')
    })
  })

  describe('read handlers of the accessories', () => {
    it('are all registered through guardedGet', () => {
      const unguarded = []
      fs.readdirSync(SERVICES_DIR).filter(file => file.endsWith('.js')).forEach(file => {
        fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8').split('\n').forEach((line, index) => {
          if (/\.on\('get', async/.test(line)) {
            unguarded.push(file + ':' + (index + 1))
          }
        })
      })
      expect(unguarded).to.eql([])
    })
  })

  describe('an accessory whose CCU reads fail', () => {
    let sim

    before(async () => {
      sim = await simulateDevice({
        type: 'HmIP-SWDO-PL-2',
        address: '0001D3C99C1234',
        channels: ['MAINTENANCE', 'SHUTTER_CONTACT_TRANSCEIVER'],
        channel: 1,
        service: 'HomeMaticContactSensorAccessory',
        values: { '0.LOW_BAT': false, '0.OPERATING_VOLTAGE': 3, '0.SABOTAGE': false, '0.UNREACH': false }
      })
    })

    after(() => sim.shutdown())

    it('still answers every read with the last known value', async () => {
      const contact = findService(sim.accessory, Service.ContactSensor)
      const state = contact.getCharacteristic(Characteristic.ContactSensorState)
      sim.fire('1.STATE', 2)
      expect(state.value).to.be(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
      sim.server._ccu.getValue = () => Promise.reject(new Error('socket hang up'))
      expect(await readWithin(state)).to.be(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
      const tampered = contact.getCharacteristic(Characteristic.StatusTampered)
      expect(await readWithin(tampered)).to.be(tampered.value)
    })
  })
})
