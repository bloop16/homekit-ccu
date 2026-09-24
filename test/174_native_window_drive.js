const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { read, write, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { readAll } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { simulateFixture } = require(path.join(__dirname, 'helpers', 'nativeHarness.js'))

const PositionState = Characteristic.PositionState

describe('Native: HmIP-MOD-WD-VK window drive', () => {
  let sim
  let window
  let current
  let target
  let state

  before(async () => {
    sim = await simulateFixture('HmIP-MOD-WD-VK.json', {
      channel: 2,
      service: 'HomeMaticIPWindowDriveAccessory',
      omit: ['2.LEVEL', '2.ACTIVITY_STATE']
    })
    window = findService(sim.accessory, Service.Window)
    current = window.getCharacteristic(Characteristic.CurrentPosition)
    target = window.getCharacteristic(Characteristic.TargetPosition)
    state = window.getCharacteristic(PositionState)
  })

  after(() => sim.shutdown())

  it('is published as a window', () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticIPWindowDriveAccessory')
    expect(window).to.be.ok()
  })

  it('answers every read before the CCU sent a value', async () => {
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(current)).to.be(0)
    expect(await read(state)).to.be(PositionState.STOPPED)
    expect(sim.warnings).to.eql([])
  })

  it('shows LEVEL as position and follows it with the target', async () => {
    sim.fire('2.LEVEL', 0.5)
    expect(current.value).to.be(50)
    expect(target.value).to.be(50)
    sim.fire('2.LEVEL', 1.2)
    expect(await read(current)).to.be(100)
    sim.fire('2.LEVEL', 0)
    expect(current.value).to.be(0)
    expect(sim.warnings).to.eql([])
  })

  it('writes the target as LEVEL and keeps it while the drive runs', async () => {
    await write(target, 30)
    expect(sim.ccuValue('2.LEVEL')).to.be(0.3)
    sim.fire('2.ACTIVITY_STATE', 1)
    expect(state.value).to.be(PositionState.INCREASING)
    sim.fire('2.LEVEL', 0.1)
    expect(current.value).to.be(10)
    expect(target.value).to.be(30)
    expect(await read(target)).to.be(30)
    sim.fire('2.LEVEL', 0.3)
    sim.fire('2.ACTIVITY_STATE', 3)
    expect(state.value).to.be(PositionState.STOPPED)
    expect(current.value).to.be(30)
    expect(target.value).to.be(30)
    expect(sim.accessory.pendingTarget).to.be(undefined)
  })

  it('shows closing while the drive moves down', async () => {
    await write(target, 0)
    sim.fire('2.ACTIVITY_STATE', 2)
    expect(state.value).to.be(PositionState.DECREASING)
    sim.fire('2.LEVEL', 0)
    sim.fire('2.ACTIVITY_STATE', 3)
    expect(target.value).to.be(0)
  })

  it('stops the drive with HoldPosition', async () => {
    await write(target, 80)
    sim.fire('2.ACTIVITY_STATE', 1)
    sim.fire('2.LEVEL', 0.4)
    await write(window.getCharacteristic(Characteristic.HoldPosition), true)
    expect(sim.ccuValue('2.STOP')).to.be(true)
    sim.fire('2.ACTIVITY_STATE', 3)
    expect(target.value).to.be(40)
  })

  it('follows the position again when the drive never reports', async () => {
    sim.accessory.driveTimeout = 20
    await write(target, 60)
    await settle(60)
    expect(sim.accessory.pendingTarget).to.be(undefined)
    expect(target.value).to.be(40)
    expect(sim.warnings).to.eql([])
  })

  it('clears the drive timer on shutdown', async () => {
    sim.accessory.driveTimeout = 60000
    await write(target, 70)
    sim.shutdown()
    expect(sim.accessory.driveTimer._destroyed).to.be(true)
  })
})
