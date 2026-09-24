const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { read, write, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { readAll } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { simulateFixture } = require(path.join(__dirname, 'helpers', 'nativeHarness.js'))

const Active = Characteristic.Active
const InUse = Characteristic.InUse
const Fault = Characteristic.StatusFault
const Battery = Characteristic.StatusLowBattery

describe('Native: HmIP-WSM watering controller as irrigation valve', () => {
  let sim
  let valve

  before(async () => {
    sim = await simulateFixture('HmIP-WSM.json', {
      channel: 4,
      service: 'HomeMaticIPIrrigationValveAccessory',
      omit: ['4.STATE']
    })
    valve = findService(sim.accessory, Service.Valve)
  })

  after(() => sim.shutdown())

  it('is published as primary irrigation valve', async () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticIPIrrigationValveAccessory')
    expect(valve.isPrimaryService).to.be(true)
    expect(await read(valve.getCharacteristic(Characteristic.ValveType))).to.be(Characteristic.ValveType.IRRIGATION)
  })

  it('answers every read before the CCU sent STATE', async () => {
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(valve.getCharacteristic(Active))).to.be(Active.INACTIVE)
    expect(await read(valve.getCharacteristic(InUse))).to.be(InUse.NOT_IN_USE)
    expect(await read(valve.getCharacteristic(Characteristic.SetDuration))).to.be(600)
    expect(await read(valve.getCharacteristic(Characteristic.RemainingDuration))).to.be(0)
    expect(sim.warnings).to.eql([])
  })

  it('follows STATE events with Active and InUse', async () => {
    sim.fire('4.STATE', true)
    expect(valve.getCharacteristic(Active).value).to.be(Active.ACTIVE)
    expect(valve.getCharacteristic(InUse).value).to.be(InUse.IN_USE)
    sim.fire('4.STATE', false)
    expect(valve.getCharacteristic(Active).value).to.be(Active.INACTIVE)
    expect(await read(valve.getCharacteristic(InUse))).to.be(InUse.NOT_IN_USE)
  })

  it('opens with STATE true and closes by itself after SetDuration', async () => {
    await write(valve.getCharacteristic(Characteristic.SetDuration), 1)
    await write(valve.getCharacteristic(Active), Active.ACTIVE)
    expect(sim.ccuValue('4.STATE')).to.be(true)
    const remaining = await read(valve.getCharacteristic(Characteristic.RemainingDuration))
    expect(remaining >= 0 && remaining <= 1).to.be(true)
    sim.fire('4.STATE', true)
    await settle(1100)
    expect(sim.ccuValue('4.STATE')).to.be(false)
    expect(valve.getCharacteristic(Active).value).to.be(Active.INACTIVE)
    expect(await read(valve.getCharacteristic(Characteristic.RemainingDuration))).to.be(0)
  })

  it('closes with STATE false and stops the timer', async () => {
    await write(valve.getCharacteristic(Characteristic.SetDuration), 3600)
    await write(valve.getCharacteristic(Active), Active.ACTIVE)
    expect(await read(valve.getCharacteristic(Characteristic.RemainingDuration))).to.be.greaterThan(3500)
    await write(valve.getCharacteristic(Active), Active.INACTIVE)
    expect(sim.ccuValue('4.STATE')).to.be(false)
    expect(sim.accessory.durationTimer).to.be(undefined)
    expect(await read(valve.getCharacteristic(Characteristic.RemainingDuration))).to.be(0)
  })

  it('does not close by itself with a run time of 0', async () => {
    await write(valve.getCharacteristic(Characteristic.SetDuration), 0)
    await write(valve.getCharacteristic(Active), Active.ACTIVE)
    expect(sim.accessory.durationTimer).to.be(undefined)
    await write(valve.getCharacteristic(Active), Active.INACTIVE)
  })

  it('reports valve errors of the maintenance channel as fault', async () => {
    const fault = valve.getCharacteristic(Fault)
    sim.fire('0.ERROR_VALVE_FAILURE', true)
    expect(fault.value).to.be(Fault.GENERAL_FAULT)
    sim.fire('0.ERROR_VALVE_FAILURE', false)
    sim.fire('0.ERROR_WATER_FAILURE', true)
    expect(await read(fault)).to.be(Fault.GENERAL_FAULT)
    sim.fire('0.ERROR_WATER_FAILURE', false)
    expect(fault.value).to.be(Fault.NO_FAULT)
  })

  it('reports the battery', async () => {
    const battery = findService(sim.accessory, Service.Battery)
    sim.fire('0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Battery))).to.be(Battery.BATTERY_LEVEL_LOW)
    expect(sim.warnings).to.eql([])
  })

  it('clears the run timer on shutdown', async () => {
    await write(valve.getCharacteristic(Characteristic.SetDuration), 3600)
    await write(valve.getCharacteristic(Active), Active.ACTIVE)
    sim.shutdown()
    expect(sim.accessory.durationTimer._destroyed).to.be(true)
  })
})

describe('Native: HmIP-WSS water stop as valve', () => {
  let sim
  let valve

  before(async () => {
    sim = await simulateFixture('HmIP-WSS.json', {
      channel: 2,
      service: 'HomeMaticIPWaterStopAccessory',
      omit: ['2.LEVEL']
    })
    valve = findService(sim.accessory, Service.Valve)
  })

  after(() => sim.shutdown())

  it('is published as primary generic valve', async () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticIPWaterStopAccessory')
    expect(valve.isPrimaryService).to.be(true)
    expect(await read(valve.getCharacteristic(Characteristic.ValveType))).to.be(Characteristic.ValveType.GENERIC_VALVE)
  })

  it('answers every read before the CCU sent LEVEL', async () => {
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(valve.getCharacteristic(Active))).to.be(Active.INACTIVE)
    expect(sim.warnings).to.eql([])
  })

  it('shows LEVEL 1 as open and LEVEL 0 as closed', async () => {
    sim.fire('2.LEVEL', 1)
    expect(valve.getCharacteristic(Active).value).to.be(Active.ACTIVE)
    expect(valve.getCharacteristic(InUse).value).to.be(InUse.IN_USE)
    sim.fire('2.LEVEL', 0)
    expect(valve.getCharacteristic(Active).value).to.be(Active.INACTIVE)
    expect(await read(valve.getCharacteristic(InUse))).to.be(InUse.NOT_IN_USE)
  })

  it('writes LEVEL 1 to open and 0 to close', async () => {
    await write(valve.getCharacteristic(Active), Active.ACTIVE)
    expect(sim.ccuValue('2.LEVEL')).to.be(1)
    expect(await read(valve.getCharacteristic(Active))).to.be(Active.ACTIVE)
    await write(valve.getCharacteristic(Active), Active.INACTIVE)
    expect(sim.ccuValue('2.LEVEL')).to.be(0)
  })

  it('reports valve errors as fault and the battery', async () => {
    const fault = valve.getCharacteristic(Fault)
    sim.fire('0.ERROR_MAX_WATER_FLOW', true)
    expect(fault.value).to.be(Fault.GENERAL_FAULT)
    sim.fire('0.ERROR_MAX_WATER_FLOW', false)
    expect(await read(fault)).to.be(Fault.NO_FAULT)
    const battery = findService(sim.accessory, Service.Battery)
    sim.fire('0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Battery))).to.be(Battery.BATTERY_LEVEL_LOW)
    expect(sim.warnings).to.eql([])
  })
})
