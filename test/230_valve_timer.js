'use strict'

// The valve (a switch the CCU runs as HomeKit valve, e.g. the HmIP-MOD-OC8) counts its
// RemainingDuration down every second and closes the valve itself at 0. Another Active=1 while it
// runs (HomeKit and scenes send it) started a second countdown beside the first: the display went
// down twice as fast and the valve was closed after half the time (hap-homematic #692).

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, read, write, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

const { Active, SetDuration, RemainingDuration } = Characteristic

describe('HomeKit-CCU valve countdown', function () {
  this.timeout(20000)
  let sim
  let valve

  beforeEach(async () => {
    sim = await simulateDevice({
      type: 'HmIP-MOD-OC8',
      address: '0002DD89A1B2C3',
      channels: ['MAINTENANCE', 'SWITCH_VIRTUAL_RECEIVER'],
      channel: 1,
      service: 'HomeMaticValveAccessory',
      values: { '1.STATE': false }
    })
    valve = findService(sim.accessory, Service.Valve)
  })
  afterEach(() => sim.shutdown())

  const remaining = () => read(valve.getCharacteristic(RemainingDuration))
  const open = (seconds) => write(valve.getCharacteristic(SetDuration), seconds).then(() => write(valve.getCharacteristic(Active), Active.ACTIVE))

  it('counts down one second per second', async () => {
    await open(30)
    await settle(2300)
    expect(await remaining()).to.within(27, 28)
  })

  it('counts on at the same speed when Active=1 comes again while it runs', async () => {
    await open(30)
    await write(valve.getCharacteristic(Active), Active.ACTIVE)
    await write(valve.getCharacteristic(Active), Active.ACTIVE)
    await settle(2300)
    expect(await remaining()).to.within(27, 28)
  })

  it('closes the valve after the whole time, not after half of it', async () => {
    await open(2)
    await write(valve.getCharacteristic(Active), Active.ACTIVE)
    await settle(1300)
    expect(Boolean(sim.ccuValue('1.STATE'))).to.be(true)
    await settle(1200)
    expect(Boolean(sim.ccuValue('1.STATE'))).to.be(false)
    expect(await remaining()).to.be(0)
  })

  it('counts at the same speed when the valve is opened again right after it closed', async () => {
    await open(30)
    sim.fire('1.STATE', false)
    await write(valve.getCharacteristic(Active), Active.ACTIVE)
    await settle(2300)
    expect(await remaining()).to.within(27, 28)
  })

  it('stops counting when the valve is closed from HomeKit', async () => {
    await open(30)
    await write(valve.getCharacteristic(Active), Active.INACTIVE)
    await settle(1300)
    expect(await remaining()).to.be(0)
    expect(Boolean(sim.ccuValue('1.STATE'))).to.be(false)
  })
})
