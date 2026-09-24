const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, read, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

describe('Openings: HmIP-SRH as window', () => {
  let sim
  let window

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-SRH',
      address: '0001D3C99CA001',
      channels: ['MAINTENANCE', 'ROTARY_HANDLE_TRANSCEIVER'],
      channel: 1,
      service: 'HomeMaticRotaryWindowAccessory',
      values: { '0.LOW_BAT': false, '0.OPERATING_VOLTAGE': 1.4 }
    })
    window = findService(sim.accessory, Service.Window)
  })

  after(() => sim.shutdown())

  it('reads valid positions before the CCU sent a value', async () => {
    expect(await read(window.getCharacteristic(Characteristic.CurrentPosition))).to.be(0)
    expect(await read(window.getCharacteristic(Characteristic.TargetPosition))).to.be(0)
    expect(await read(window.getCharacteristic(Characteristic.PositionState))).to.be(Characteristic.PositionState.STOPPED)
    expect(sim.warnings).to.eql([])
  })

  it('maps closed, tilted and open', async () => {
    const current = window.getCharacteristic(Characteristic.CurrentPosition)
    const target = window.getCharacteristic(Characteristic.TargetPosition)
    sim.fire('1.STATE', 1)
    await settle(150)
    expect(target.value).to.be(25)
    expect(current.value).to.be(25)
    sim.fire('1.STATE', 2)
    await settle(150)
    expect(current.value).to.be(100)
    sim.fire('1.STATE', 0)
    await settle(150)
    expect(current.value).to.be(0)
    expect(sim.warnings).to.eql([])
  })

  it('reads the string the CCU script interface returns', async () => {
    sim.server._ccu.dummyValues[sim.dp('1.STATE')] = '2'
    expect(await read(window.getCharacteristic(Characteristic.CurrentPosition))).to.be(100)
    sim.server._ccu.dummyValues[sim.dp('1.STATE')] = '0'
    expect(await read(window.getCharacteristic(Characteristic.CurrentPosition))).to.be(0)
  })

  it('keeps the Eve durations finite', async () => {
    const eve = sim.accessory.eve.Characteristic
    expect(Number.isFinite(window.getCharacteristic(eve.OpenDuration).value)).to.be(true)
    expect(Number.isFinite(window.getCharacteristic(eve.ClosedDuration).value)).to.be(true)
    const opened = window.getCharacteristic(eve.TimesOpened).value
    sim.fire('1.STATE', 1)
    sim.fire('1.STATE', 2)
    expect(window.getCharacteristic(eve.TimesOpened).value).to.be(opened + 1)
    await settle(150)
    expect(sim.warnings).to.eql([])
  })
})

describe('Openings: HmIP-SWDO-PL as window', () => {
  let sim
  let window

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-SWDO-PL',
      address: '0001D3C99CA002',
      channels: ['MAINTENANCE', 'SHUTTER_CONTACT'],
      channel: 1,
      service: 'HomeMaticWindowAccessory',
      values: { '0.LOW_BAT': false }
    })
    window = findService(sim.accessory, Service.Window)
  })

  after(() => sim.shutdown())

  it('shows STATE 2 as open', async () => {
    sim.fire('1.STATE', 2)
    await settle(150)
    expect(window.getCharacteristic(Characteristic.CurrentPosition).value).to.be(100)
    expect(await read(window.getCharacteristic(Characteristic.TargetPosition))).to.be(100)
    sim.fire('1.STATE', 0)
    await settle(150)
    expect(window.getCharacteristic(Characteristic.CurrentPosition).value).to.be(0)
  })
})

describe('Openings: reversed door', () => {
  let sim
  let door

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-SCI',
      address: '0001D3C99CA003',
      channels: ['MAINTENANCE', 'MULTI_MODE_INPUT_TRANSMITTER'],
      channel: 1,
      service: 'HomeMaticDoorAccessory',
      settings: { reverse: true },
      values: { '0.LOW_BAT': false }
    })
    door = findService(sim.accessory, Service.Door)
  })

  after(() => sim.shutdown())

  it('reverses the contact', async () => {
    sim.fire('1.STATE', 0)
    await settle(150)
    expect(door.getCharacteristic(Characteristic.CurrentPosition).value).to.be(100)
    sim.fire('1.STATE', 1)
    await settle(150)
    expect(door.getCharacteristic(Characteristic.CurrentPosition).value).to.be(0)
    expect(await read(door.getCharacteristic(Characteristic.CurrentPosition))).to.be(0)
  })

  it('does not reverse the battery warning', async () => {
    const battery = findService(sim.accessory, Service.Battery)
    sim.fire('0.LOW_BAT', false)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
  })
})
