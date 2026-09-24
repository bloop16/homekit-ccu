const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, read, write, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

const Current = Characteristic.CurrentDoorState
const Target = Characteristic.TargetDoorState

describe('Openings: HmIP-MOD-TM garage door', () => {
  let sim
  let garage
  let current
  let target
  let vent

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-MOD-TM',
      address: '0001D3C99CB001',
      channels: ['MAINTENANCE', 'DOOR_RECEIVER', 'SIMPLE_SWITCH_RECEIVER'],
      channel: 1,
      service: 'HomeMaticGarageDoorOpenerAccessory',
      settings: { addventilation: true },
      values: { '0.UNREACH': false }
    })
    garage = findService(sim.accessory, Service.GarageDoorOpener)
    current = garage.getCharacteristic(Current)
    target = garage.getCharacteristic(Target)
    vent = findService(sim.accessory, Service.Switch).getCharacteristic(Characteristic.On)
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a value', async () => {
    expect(Current.OPEN <= await read(current) && await read(current) <= Current.STOPPED).to.be(true)
    expect([Target.OPEN, Target.CLOSED]).to.contain(await read(target))
    expect(await read(garage.getCharacteristic(Characteristic.ObstructionDetected))).to.be(false)
    expect(await read(vent)).to.be(false)
    expect(sim.warnings).to.eql([])
  })

  it('shows an open door', async () => {
    sim.fire('1.DOOR_STATE', 1)
    sim.fire('1.PROCESS', 0)
    await settle(150)
    expect(current.value).to.be(Current.OPEN)
    expect(target.value).to.be(Target.OPEN)
    expect(await read(current)).to.be(Current.OPEN)
  })

  it('shows a door stopped half way (position unknown) as stopped', async () => {
    sim.fire('1.DOOR_STATE', 3)
    sim.fire('1.PROCESS', 0)
    await settle(150)
    expect(current.value).to.be(Current.STOPPED)
    expect(target.value).to.be(Target.OPEN)
    expect(await read(current)).to.be(Current.STOPPED)
  })

  it('shows the ventilation position as open with the ventilation switch on', async () => {
    sim.fire('1.DOOR_STATE', 2)
    sim.fire('1.PROCESS', 0)
    await settle(150)
    expect(current.value).to.be(Current.OPEN)
    expect(vent.value).to.be(true)
    expect(await read(vent)).to.be(true)
  })

  it('switches ventilation off when the door closes', async () => {
    sim.fire('1.DOOR_STATE', 0)
    sim.fire('1.PROCESS', 0)
    await settle(150)
    expect(current.value).to.be(Current.CLOSED)
    expect(target.value).to.be(Target.CLOSED)
    expect(vent.value).to.be(false)
    expect(await read(vent)).to.be(false)
  })

  it('opens the door from HomeKit and shows it opening', async () => {
    await write(target, Target.OPEN)
    expect(sim.ccuValue('1.DOOR_COMMAND')).to.be(1)
    expect(current.value).to.be(Current.OPENING)
    // the door has not moved yet; HomeKit must keep its target
    expect(await read(target)).to.be(Target.OPEN)
    expect(await read(current)).to.be(Current.OPENING)
    sim.fire('1.PROCESS', 1)
    await settle(150)
    expect(current.value).to.be(Current.OPENING)
    sim.fire('1.DOOR_STATE', 1)
    sim.fire('1.PROCESS', 0)
    await settle(150)
    expect(current.value).to.be(Current.OPEN)
    expect(target.value).to.be(Target.OPEN)
  })

  it('closes the door from HomeKit and shows it closing', async () => {
    await write(target, Target.CLOSED)
    expect(sim.ccuValue('1.DOOR_COMMAND')).to.be(3)
    expect(current.value).to.be(Current.CLOSING)
    sim.fire('1.PROCESS', 1)
    sim.fire('1.DOOR_STATE', 3)
    await settle(150)
    expect(current.value).to.be(Current.CLOSING)
    expect(await read(target)).to.be(Target.CLOSED)
    sim.fire('1.DOOR_STATE', 0)
    sim.fire('1.PROCESS', 0)
    await settle(150)
    expect(current.value).to.be(Current.CLOSED)
    expect(target.value).to.be(Target.CLOSED)
  })

  it('shows a door opened by its remote control as opening', async () => {
    sim.fire('1.PROCESS', 1)
    await settle(150)
    expect(target.value).to.be(Target.OPEN)
    expect(current.value).to.be(Current.OPENING)
    sim.fire('1.DOOR_STATE', 1)
    sim.fire('1.PROCESS', 0)
    await settle(150)
    expect(current.value).to.be(Current.OPEN)
  })

  it('reads the string the CCU script interface returns', async () => {
    sim.server._ccu.dummyValues[sim.dp('1.DOOR_STATE')] = '0'
    expect(await read(current)).to.be(Current.CLOSED)
    expect(await read(target)).to.be(Target.CLOSED)
    sim.server._ccu.dummyValues[sim.dp('1.DOOR_STATE')] = '2'
    expect(await read(current)).to.be(Current.OPEN)
    expect(await read(vent)).to.be(true)
  })

  it('sends ventilation from HomeKit', async () => {
    await write(vent, true)
    expect(sim.ccuValue('1.DOOR_COMMAND')).to.be(4)
    await settle(50)
    expect(sim.warnings).to.eql([])
  })
})
