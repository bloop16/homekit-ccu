const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, read, write, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

const Current = Characteristic.LockCurrentState
const Target = Characteristic.LockTargetState

describe('Openings: HmIP-DLD door lock drive', () => {
  let sim
  let lock
  let current
  let target

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-DLD',
      address: '0001D3C99CC001',
      channels: ['MAINTENANCE', 'DOOR_LOCK_STATE_TRANSMITTER', 'ACCESS_RECEIVER'],
      channel: 1,
      service: 'HomeMaticKeyMaticIPAccessory',
      values: { '0.LOW_BAT': false, '0.OPERATING_VOLTAGE': 4.5, '0.ERROR_JAMMED': false }
    })
    lock = findService(sim.accessory, Service.LockMechanism)
    current = lock.getCharacteristic(Current)
    target = lock.getCharacteristic(Target)
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a value', async () => {
    expect(await read(current)).to.be(Current.UNKNOWN)
    expect([Target.UNSECURED, Target.SECURED]).to.contain(await read(target))
    expect(sim.warnings).to.eql([])
  })

  it('maps LOCK_STATE 1 to locked and 2 to unlocked', async () => {
    sim.fire('1.LOCK_STATE', 1)
    expect(current.value).to.be(Current.SECURED)
    expect(target.value).to.be(Target.SECURED)
    sim.fire('1.LOCK_STATE', 2)
    expect(current.value).to.be(Current.UNSECURED)
    expect(target.value).to.be(Target.UNSECURED)
    expect(await read(current)).to.be(Current.UNSECURED)
  })

  it('maps LOCK_STATE 0 to unknown and keeps the target', async () => {
    sim.fire('1.LOCK_STATE', 0)
    expect(current.value).to.be(Current.UNKNOWN)
    expect(target.value).to.be(Target.UNSECURED)
    expect(await read(current)).to.be(Current.UNKNOWN)
    expect(await read(target)).to.be(Target.UNSECURED)
  })

  it('reads the string the CCU script interface returns', async () => {
    sim.server._ccu.dummyValues[sim.dp('1.LOCK_STATE')] = '1'
    expect(await read(current)).to.be(Current.SECURED)
    expect(await read(target)).to.be(Target.SECURED)
    sim.fire('1.LOCK_STATE', 2)
  })

  it('locks from HomeKit and keeps the HomeKit target while the drive runs', async () => {
    await write(target, Target.SECURED)
    expect(sim.ccuValue('1.LOCK_TARGET_LEVEL')).to.be(0)
    sim.fire('1.ACTIVITY_STATE', 2)
    // the drive has not finished; HomeKit must not see its target jump back
    expect(await read(target)).to.be(Target.SECURED)
    expect(target.value).to.be(Target.SECURED)
    sim.fire('1.LOCK_STATE', 1)
    sim.fire('1.ACTIVITY_STATE', 3)
    expect(current.value).to.be(Current.SECURED)
    expect(target.value).to.be(Target.SECURED)
  })

  it('follows the lock again when the drive never reports the end of a command', async () => {
    sim.accessory.commandTimeout = 30
    await write(target, Target.UNSECURED)
    expect(sim.ccuValue('1.LOCK_TARGET_LEVEL')).to.be(1)
    await settle(80)
    // turned by hand afterwards
    sim.fire('1.LOCK_STATE', 1)
    expect(current.value).to.be(Current.SECURED)
    expect(target.value).to.be(Target.SECURED)
  })

  it('shows a jammed lock', async () => {
    sim.fire('0.ERROR_JAMMED', true)
    expect(current.value).to.be(Current.JAMMED)
    expect(await read(current)).to.be(Current.JAMMED)
    sim.fire('0.ERROR_JAMMED', false)
    expect(current.value).to.be(Current.SECURED)
  })

  it('reports the battery', async () => {
    const battery = findService(sim.accessory, Service.Battery)
    expect(battery).to.be.ok()
    sim.fire('0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
    expect(sim.warnings).to.eql([])
  })
})
