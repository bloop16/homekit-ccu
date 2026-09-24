const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, read, write, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

const PositionState = Characteristic.PositionState

describe('Openings: HM-LC-Bl1PBU-FM blind', () => {
  let sim
  let blind

  before(async () => {
    sim = await simulateDevice({
      intf: 'BidCos-RF',
      type: 'HM-LC-Bl1PBU-FM',
      address: 'NEQ0123401',
      channels: ['MAINTENANCE', 'BLIND'],
      channel: 1,
      service: 'HomeMaticBlindAccessory'
    })
    blind = findService(sim.accessory, Service.WindowCovering)
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a value', async () => {
    expect(await read(blind.getCharacteristic(Characteristic.CurrentPosition))).to.be(0)
    expect(await read(blind.getCharacteristic(Characteristic.TargetPosition))).to.be(0)
    expect(await read(blind.getCharacteristic(Characteristic.PositionState))).to.be(PositionState.STOPPED)
    expect(await read(blind.getCharacteristic(Characteristic.ObstructionDetected))).to.be(false)
    expect(sim.warnings).to.eql([])
  })

  it('reads DIRECTION up as opening and down as closing', async () => {
    const state = blind.getCharacteristic(Characteristic.PositionState)
    sim.server._ccu.dummyValues[sim.dp('1.DIRECTION')] = 1
    expect(await read(state)).to.be(PositionState.INCREASING)
    sim.server._ccu.dummyValues[sim.dp('1.DIRECTION')] = '2'
    expect(await read(state)).to.be(PositionState.DECREASING)
    sim.server._ccu.dummyValues[sim.dp('1.DIRECTION')] = 0
    expect(await read(state)).to.be(PositionState.STOPPED)
  })

  it('reads INHIBIT as obstruction', async () => {
    sim.server._ccu.dummyValues[sim.dp('1.INHIBIT')] = true
    expect(await read(blind.getCharacteristic(Characteristic.ObstructionDetected))).to.be(true)
    sim.fire('1.INHIBIT', false)
    expect(await read(blind.getCharacteristic(Characteristic.ObstructionDetected))).to.be(false)
  })

  it('stops the blind on HoldPosition', async () => {
    await write(blind.getCharacteristic(Characteristic.HoldPosition), true)
    expect(sim.ccuValue('1.STOP')).to.be(true)
    expect(sim.warnings).to.eql([])
  })
})

describe('Openings: HmIP-BROLL shutter', () => {
  let sim
  let blind

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-BROLL',
      address: '0001D3C99CE001',
      channels: ['MAINTENANCE', 'KEY_TRANSCEIVER', 'KEY_TRANSCEIVER', 'SHUTTER_TRANSMITTER', 'SHUTTER_VIRTUAL_RECEIVER', 'SHUTTER_VIRTUAL_RECEIVER', 'SHUTTER_VIRTUAL_RECEIVER'],
      channel: 4,
      service: 'HomeMaticBlindIPAccessory'
    })
    blind = findService(sim.accessory, Service.WindowCovering)
    sim.accessory.delayOnSet = 5
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a value', async () => {
    expect(await read(blind.getCharacteristic(Characteristic.CurrentPosition))).to.be(0)
    expect(await read(blind.getCharacteristic(Characteristic.TargetPosition))).to.be(0)
    expect(await read(blind.getCharacteristic(Characteristic.PositionState))).to.be(PositionState.STOPPED)
    expect(sim.warnings).to.eql([])
  })

  it('reads ACTIVITY_STATE up as opening and down as closing', async () => {
    const state = blind.getCharacteristic(Characteristic.PositionState)
    sim.server._ccu.dummyValues[sim.dp('3.ACTIVITY_STATE')] = 1
    expect(await read(state)).to.be(PositionState.INCREASING)
    sim.server._ccu.dummyValues[sim.dp('3.ACTIVITY_STATE')] = '2'
    expect(await read(state)).to.be(PositionState.DECREASING)
    sim.server._ccu.dummyValues[sim.dp('3.ACTIVITY_STATE')] = 3
    expect(await read(state)).to.be(PositionState.STOPPED)
  })

  it('keeps the HomeKit target while the shutter moves', async () => {
    sim.fire('3.LEVEL', 1)
    sim.fire('3.PROCESS', 0)
    await write(blind.getCharacteristic(Characteristic.TargetPosition), 30)
    await settle(20)
    expect(sim.ccuValue('4.LEVEL')).to.be(0.3)
    sim.fire('3.PROCESS', 1)
    sim.fire('3.ACTIVITY_STATE', 2)
    sim.fire('3.LEVEL', 0.8)
    expect(blind.getCharacteristic(Characteristic.CurrentPosition).value).to.be(80)
    expect(blind.getCharacteristic(Characteristic.PositionState).value).to.be(PositionState.DECREASING)
    expect(await read(blind.getCharacteristic(Characteristic.TargetPosition))).to.be(30)
    sim.fire('3.LEVEL', 0.3)
    sim.fire('3.ACTIVITY_STATE', 3)
    sim.fire('3.PROCESS', 0)
    await settle(20)
    expect(blind.getCharacteristic(Characteristic.CurrentPosition).value).to.be(30)
    expect(await read(blind.getCharacteristic(Characteristic.TargetPosition))).to.be(30)
  })

  it('stops the shutter on HoldPosition', async () => {
    expect(blind.testCharacteristic(Characteristic.HoldPosition)).to.be(true)
    await write(blind.getCharacteristic(Characteristic.HoldPosition), true)
    expect(sim.ccuValue('4.STOP')).to.be(true)
    expect(sim.warnings).to.eql([])
  })
})

describe('Openings: HmIP-BBL blind with slats', () => {
  let sim
  let blind

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-BBL',
      address: '0001D3C99CE002',
      channels: ['MAINTENANCE', 'KEY_TRANSCEIVER', 'KEY_TRANSCEIVER', 'BLIND_TRANSMITTER', 'BLIND_VIRTUAL_RECEIVER', 'BLIND_VIRTUAL_RECEIVER', 'BLIND_VIRTUAL_RECEIVER'],
      channel: 4,
      service: 'HomeMaticBlindIPAccessory',
      settings: { useSlats: true }
    })
    blind = findService(sim.accessory, Service.WindowCovering)
  })

  after(() => sim.shutdown())

  it('answers the slat reads before the CCU sent a value', async () => {
    expect(await read(blind.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle))).to.be(-90)
    expect(await read(blind.getCharacteristic(Characteristic.TargetHorizontalTiltAngle))).to.be(-90)
    expect(sim.warnings).to.eql([])
  })

  it('reads the slat position', async () => {
    sim.fire('4.LEVEL_2', 0.5)
    expect(await read(blind.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle))).to.be(0)
  })
})
