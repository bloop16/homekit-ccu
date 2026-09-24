const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { read, write, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { readAll } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { simulateFixture } = require(path.join(__dirname, 'helpers', 'nativeHarness.js'))

const Current = Characteristic.LockCurrentState
const Target = Characteristic.LockTargetState
const Battery = Characteristic.StatusLowBattery

describe('Native: HmIP-DLP door lock drive (DOOR_LOCK_TRANSCEIVER)', () => {
  let sim
  let lock
  let current
  let target

  before(async () => {
    sim = await simulateFixture('HmIP-DLP.json', {
      channel: 12,
      service: 'HomeMaticIPDoorLockProAccessory',
      omit: ['12.LOCK_STATE', '12.ACTIVITY_STATE']
    })
    lock = findService(sim.accessory, Service.LockMechanism)
    current = lock.getCharacteristic(Current)
    target = lock.getCharacteristic(Target)
  })

  after(() => sim.shutdown())

  it('is published as a lock', () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticIPDoorLockProAccessory')
    expect(lock).to.be.ok()
  })

  it('answers every read before the CCU sent a lock state', async () => {
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(current)).to.be(Current.UNKNOWN)
    expect([Target.UNSECURED, Target.SECURED]).to.contain(await read(target))
    expect(sim.warnings).to.eql([])
  })

  it('maps LOCK_STATE LOCKED, UNLOCKED, UNKNOWN and INVALID', async () => {
    sim.fire('12.LOCK_STATE', 1)
    expect(current.value).to.be(Current.SECURED)
    expect(target.value).to.be(Target.SECURED)
    sim.fire('12.LOCK_STATE', 2)
    expect(current.value).to.be(Current.UNSECURED)
    expect(target.value).to.be(Target.UNSECURED)
    sim.fire('12.LOCK_STATE', 3)
    expect(current.value).to.be(Current.UNKNOWN)
    sim.fire('12.LOCK_STATE', 0)
    expect(await read(current)).to.be(Current.UNKNOWN)
    expect(target.value).to.be(Target.UNSECURED)
  })

  it('locks and unlocks with LOCK_TARGET_LEVEL LOCKED (0) and UNLOCKED (1)', async () => {
    await write(target, Target.SECURED)
    expect(sim.ccuValue('12.LOCK_TARGET_LEVEL')).to.be(0)
    sim.fire('12.ACTIVITY_STATE', 2)
    expect(await read(target)).to.be(Target.SECURED)
    sim.fire('12.LOCK_STATE', 1)
    sim.fire('12.ACTIVITY_STATE', 3)
    expect(current.value).to.be(Current.SECURED)

    await write(target, Target.UNSECURED)
    expect(sim.ccuValue('12.LOCK_TARGET_LEVEL')).to.be(1)
    sim.fire('12.LOCK_STATE', 2)
    sim.fire('12.ACTIVITY_STATE', 3)
    expect(current.value).to.be(Current.UNSECURED)
    expect(target.value).to.be(Target.UNSECURED)
  })

  it('shows ERROR_JAMMED of the lock channel as jammed', async () => {
    sim.fire('12.ERROR_JAMMED', true)
    expect(current.value).to.be(Current.JAMMED)
    expect(await read(current)).to.be(Current.JAMMED)
    sim.fire('12.ERROR_JAMMED', false)
    expect(current.value).to.be(Current.UNSECURED)
  })

  it('reports the battery of the maintenance channel', async () => {
    const battery = findService(sim.accessory, Service.Battery)
    sim.fire('0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Battery))).to.be(Battery.BATTERY_LEVEL_LOW)
    sim.fire('0.LOW_BAT', false)
    await settle()
    expect(sim.warnings).to.eql([])
  })
})

describe('Native: HmIP-DLP opening the door (unlock mode open)', () => {
  let sim

  before(async () => {
    sim = await simulateFixture('HmIP-DLP.json', {
      channel: 12,
      service: 'HomeMaticIPDoorLockProAccessory',
      settings: { unlockMode: 'open' }
    })
  })

  after(() => sim.shutdown())

  it('writes LOCK_TARGET_LEVEL OPEN (2) for unlock', async () => {
    const target = findService(sim.accessory, Service.LockMechanism).getCharacteristic(Target)
    await write(target, Target.UNSECURED)
    expect(sim.ccuValue('12.LOCK_TARGET_LEVEL')).to.be(2)
  })
})

describe('Native: HmIP-DLP door state (DOOR_STATE_TRANSCEIVER) as contact sensor', () => {
  let sim
  let state

  before(async () => {
    sim = await simulateFixture('HmIP-DLP.json', {
      channel: 3,
      service: 'HomeMaticContactSensorAccessory',
      omit: ['3.STATE']
    })
    state = findService(sim.accessory, Service.ContactSensor).getCharacteristic(Characteristic.ContactSensorState)
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent the door state', async () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticContactSensorAccessory')
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(state)).to.be(Characteristic.ContactSensorState.CONTACT_DETECTED)
  })

  it('maps STATE CLOSED (0) and OPEN (1)', async () => {
    sim.fire('3.STATE', 1)
    expect(state.value).to.be(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
    sim.fire('3.STATE', 0)
    expect(state.value).to.be(Characteristic.ContactSensorState.CONTACT_DETECTED)
    sim.fire('3.STATE', 1)
    expect(await read(state)).to.be(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
    expect(sim.warnings).to.eql([])
  })
})

describe('Native: HmIP-DLS door lock sensor as read-only lock', () => {
  let sim
  let lock
  let current
  let target

  before(async () => {
    sim = await simulateFixture('HmIP-DLS.json', {
      channel: 1,
      service: 'HomeMaticIPDoorLockSensorAccessory',
      omit: ['1.LOCK_STATE']
    })
    lock = findService(sim.accessory, Service.LockMechanism)
    current = lock.getCharacteristic(Current)
    target = lock.getCharacteristic(Target)
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a lock state', async () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticIPDoorLockSensorAccessory')
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(current)).to.be(Current.UNKNOWN)
    expect(sim.warnings).to.eql([])
  })

  it('follows LOCK_STATE with current and target state', async () => {
    sim.fire('1.LOCK_STATE', 1)
    expect(current.value).to.be(Current.SECURED)
    expect(target.value).to.be(Target.SECURED)
    sim.fire('1.LOCK_STATE', 2)
    expect(current.value).to.be(Current.UNSECURED)
    expect(target.value).to.be(Target.UNSECURED)
    expect(await read(target)).to.be(Target.UNSECURED)
    sim.fire('1.LOCK_STATE', 0)
    expect(current.value).to.be(Current.UNKNOWN)
    expect(target.value).to.be(Target.UNSECURED)
  })

  it('rejects HomeKit writes and writes nothing to the CCU', async () => {
    sim.fire('1.LOCK_STATE', 2)
    let status
    try {
      await write(target, Target.SECURED)
    } catch (e) {
      status = e
    }
    expect(status).to.be(-70404)
    expect(sim.ccuValue('1.LOCK_TARGET_LEVEL')).to.be(undefined)
    await settle()
    expect(target.value).to.be(Target.UNSECURED)
  })

  it('reports the battery of the maintenance channel', async () => {
    const battery = findService(sim.accessory, Service.Battery)
    sim.fire('0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Battery))).to.be(Battery.BATTERY_LEVEL_LOW)
    expect(sim.warnings).to.eql([])
  })
})
