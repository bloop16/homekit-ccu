'use strict'

/*
 * HM-LC-Ja1PBU-FM (JALOUSIE): the slats are the horizontal tilt of the window covering
 * (LEVEL_SLATS 0..1 = -90..90 degrees); a BLIND channel stays a plain window covering.
 */

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, read, settle, watchWarnings } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { simulateDevice } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

const JA = '1097176715ABCD'
const DP = (name) => 'BidCos-RF.' + JA + ':1.' + name

describe('Refine: HM-LC-Ja1PBU-FM jalousie slats', () => {
  let server
  let accessory
  let blind
  let warnings

  before(async () => {
    ({ server } = await startServer('HM-LC-Ja1PBU-FM.json', { values: { [DP('LEVEL')]: 0.5, [DP('LEVEL_SLATS')]: 0.5 } }))
    accessory = accessoryAt(server, JA + ':1')
    accessory.delayOnSet = 0
    blind = findService(accessory, Service.WindowCovering)
    warnings = watchWarnings(accessory)
  })

  after(() => {
    warnings.stop()
    shutdown(server)
  })

  it('adds the horizontal tilt to the window covering', () => {
    expect(blind.testCharacteristic(Characteristic.CurrentHorizontalTiltAngle)).to.be(true)
    expect(blind.testCharacteristic(Characteristic.TargetHorizontalTiltAngle)).to.be(true)
    expect(blind.isPrimaryService).to.be(true)
  })

  it('answers every read with a valid value', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('reads LEVEL_SLATS 0..1 as -90..90 degrees', async () => {
    server._ccu.dummyValues[DP('LEVEL_SLATS')] = 0
    expect(await read(blind.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle))).to.be(-90)
    server._ccu.dummyValues[DP('LEVEL_SLATS')] = 1
    expect(await read(blind.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle))).to.be(90)
    server._ccu.dummyValues[DP('LEVEL_SLATS')] = 0.25
    expect(await read(blind.getCharacteristic(Characteristic.TargetHorizontalTiltAngle))).to.be(-45)
  })

  it('keeps the last angle when the CCU has no value and clamps 1.01 (no change)', async () => {
    server._ccu.dummyValues[DP('LEVEL_SLATS')] = ''
    expect(await read(blind.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle))).to.be.a('number')
    server._ccu.fireEvent(DP('LEVEL_SLATS'), 1.01)
    expect(blind.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle).value).to.be(90)
  })

  it('updates the tilt on a LEVEL_SLATS event', () => {
    server._ccu.fireEvent(DP('LEVEL_SLATS'), 0.75)
    expect(blind.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle).value).to.be(45)
    expect(blind.getCharacteristic(Characteristic.TargetHorizontalTiltAngle).value).to.be(45)
  })

  it('sends a new tilt as LEVEL_SLATS', async () => {
    await blind.getCharacteristic(Characteristic.TargetHorizontalTiltAngle).handleSetRequest(0)
    await settle(20)
    expect(server._ccu.dummyValues[DP('LEVEL_SLATS')]).to.be(0.5)
    await blind.getCharacteristic(Characteristic.TargetHorizontalTiltAngle).handleSetRequest(-90)
    await settle(20)
    expect(server._ccu.dummyValues[DP('LEVEL_SLATS')]).to.be(0)
  })

  it('stops on HoldPosition', async () => {
    await blind.getCharacteristic(Characteristic.HoldPosition).handleSetRequest(true)
    expect(server._ccu.dummyValues[DP('STOP')]).to.be(true)
  })

  it('sends no illegal values to HomeKit', () => {
    expect(warnings.list).to.eql([])
  })
})

describe('Refine: HM-LC-Ja1PBU-FM with slats switched off', () => {
  let sim

  before(async () => {
    sim = await simulateDevice({
      intf: 'BidCos-RF',
      type: 'HM-LC-Ja1PBU-FM',
      address: 'NEQ0181002',
      channels: ['MAINTENANCE', 'JALOUSIE'],
      channel: 1,
      service: 'HomeMaticBlindAccessory',
      settings: { useSlats: false }
    })
  })

  after(() => sim.shutdown())

  it('keeps the stored choice', () => {
    const blind = sim.accessory.homeKitAccessory.getService(Service.WindowCovering)
    expect(blind.testCharacteristic(Characteristic.CurrentHorizontalTiltAngle)).to.be(false)
  })
})

describe('Refine: HM-LC-Bl1PBU-FM blind without slats', () => {
  let sim

  before(async () => {
    sim = await simulateDevice({
      intf: 'BidCos-RF',
      type: 'HM-LC-Bl1PBU-FM',
      address: 'NEQ0181001',
      channels: ['MAINTENANCE', 'BLIND'],
      channel: 1,
      service: 'HomeMaticBlindAccessory'
    })
  })

  after(() => sim.shutdown())

  it('has no tilt characteristics', () => {
    const blind = sim.accessory.homeKitAccessory.getService(Service.WindowCovering)
    expect(blind.testCharacteristic(Characteristic.CurrentHorizontalTiltAngle)).to.be(false)
    expect(blind.testCharacteristic(Characteristic.TargetHorizontalTiltAngle)).to.be(false)
  })
})
