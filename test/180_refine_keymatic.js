'use strict'

/*
 * HM-Sec-Key (KEYMATIC): a plain lock mechanism in Apple Home. TargetDoorState does not belong to a
 * LockMechanism; opening the latch is an optional momentary switch '<name> Open'.
 */

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, read, settle, watchWarnings } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

const KEY = 'NEQ0180001'
const DP = (name) => 'BidCos-RF.' + KEY + ':' + name
const Current = Characteristic.LockCurrentState
const Target = Characteristic.LockTargetState

function openSwitch (accessory) {
  return findService(accessory, Service.Switch, 'Open')
}

async function startKey (settings) {
  const mappings = { [KEY + ':1']: { Service: 'HomeMaticKeyMaticAccessory', settings } }
  const values = { [DP('0.LOWBAT')]: false, [DP('1.STATE')]: false, [DP('1.ERROR')]: 0, [DP('1.STATE_UNCERTAIN')]: false }
  const { server } = await startServer('HM-Sec-Key.json', { mappings, values })
  await settle(20)
  return { server, accessory: accessoryAt(server, KEY + ':1') }
}

describe('Refine: HM-Sec-Key KeyMatic (default settings)', () => {
  let server
  let accessory
  let lock
  let warnings

  before(async () => {
    ({ server, accessory } = await startKey({}))
    lock = findService(accessory, Service.LockMechanism)
    warnings = watchWarnings(accessory)
  })

  after(() => {
    warnings.stop()
    shutdown(server)
  })

  it('keeps the lock mechanism as primary service and drops TargetDoorState', () => {
    expect(lock).to.be.ok()
    expect(lock.isPrimaryService).to.be(true)
    expect(lock.testCharacteristic(Characteristic.TargetDoorState)).to.be(false)
  })

  it('answers every read with a valid value', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('maps STATE true to unlocked and false to locked', async () => {
    server._ccu.fireEvent(DP('1.STATE'), true)
    expect(lock.getCharacteristic(Current).value).to.be(Current.UNSECURED)
    expect(lock.getCharacteristic(Target).value).to.be(Target.UNSECURED)
    server._ccu.fireEvent(DP('1.STATE'), false)
    expect(lock.getCharacteristic(Current).value).to.be(Current.SECURED)
    expect(await read(lock.getCharacteristic(Current))).to.be(Current.SECURED)
  })

  it('shows a jammed lock while ERROR is not NO_ERROR', async () => {
    server._ccu.fireEvent(DP('1.ERROR'), 1)
    expect(lock.getCharacteristic(Current).value).to.be(Current.JAMMED)
    expect(await read(lock.getCharacteristic(Current))).to.be(Current.JAMMED)
    server._ccu.fireEvent(DP('1.ERROR'), '2')
    expect(await read(lock.getCharacteristic(Current))).to.be(Current.JAMMED)
    server._ccu.fireEvent(DP('1.ERROR'), 0)
    expect(lock.getCharacteristic(Current).value).to.be(Current.SECURED)
  })

  it('shows an unknown state while STATE_UNCERTAIN is set', async () => {
    server._ccu.fireEvent(DP('1.STATE_UNCERTAIN'), true)
    expect(lock.getCharacteristic(Current).value).to.be(Current.UNKNOWN)
    expect(await read(lock.getCharacteristic(Current))).to.be(Current.UNKNOWN)
    server._ccu.fireEvent(DP('1.STATE_UNCERTAIN'), false)
    expect(lock.getCharacteristic(Current).value).to.be(Current.SECURED)
  })

  it('reports the battery from LOWBAT', async () => {
    const battery = findService(accessory, Service.Battery)
    expect(battery).to.be.ok()
    server._ccu.fireEvent(DP('0.LOWBAT'), true)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
    server._ccu.fireEvent(DP('0.LOWBAT'), false)
  })

  it('has a momentary switch that opens the latch', async () => {
    const open = openSwitch(accessory)
    expect(open).to.be.ok()
    expect(open.isPrimaryService).to.not.be(true)
    expect(open.getCharacteristic(Characteristic.Name).value).to.contain('Open')
    const on = open.getCharacteristic(Characteristic.On)
    expect(await read(on)).to.be(false)
    accessory.openResetDelay = 30
    await on.handleSetRequest(true)
    expect(server._ccu.dummyValues[DP('1.OPEN')]).to.be(true)
    // the switch turns itself off again
    await settle(80)
    expect(on.value).to.be(false)
  })

  it('sends no illegal values to HomeKit', () => {
    expect(warnings.list).to.eql([])
  })
})

describe('Refine: HM-Sec-Key KeyMatic with unlock mode "open"', () => {
  let server
  let accessory

  before(async () => {
    ({ server, accessory } = await startKey({ unlockMode: 'open' }))
  })

  after(() => shutdown(server))

  it('has no open switch, unlocking already opens the door', () => {
    expect(openSwitch(accessory)).to.be(undefined)
  })

  it('opens the door on unlock', async () => {
    const lock = findService(accessory, Service.LockMechanism)
    await lock.getCharacteristic(Target).handleSetRequest(Target.UNSECURED)
    expect(server._ccu.dummyValues[DP('1.OPEN')]).to.be(true)
  })
})

describe('Refine: HM-Sec-Key KeyMatic with the open switch switched off', () => {
  let server
  let accessory

  before(async () => {
    ({ server, accessory } = await startKey({ addOpenSwitch: false }))
  })

  after(() => shutdown(server))

  it('keeps the stored choice', () => {
    expect(openSwitch(accessory)).to.be(undefined)
  })
})

describe('Refine: HM-Sec-Key KeyMatic with the open switch and unlock mode "open"', () => {
  let server
  let accessory

  before(async () => {
    ({ server, accessory } = await startKey({ unlockMode: 'open', addOpenSwitch: true }))
  })

  after(() => shutdown(server))

  it('adds the switch when the user asked for it', () => {
    expect(openSwitch(accessory)).to.be.ok()
  })
})
