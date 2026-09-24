const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, read, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

const SWDO_CHANNELS = ['MAINTENANCE', 'SHUTTER_CONTACT_TRANSCEIVER']
const SWDO_VALUES = { '0.LOW_BAT': false, '0.OPERATING_VOLTAGE': 3, '0.SABOTAGE': false, '0.UNREACH': false }

describe('Openings: HmIP-SWDO-PL-2 as contact sensor', () => {
  let sim
  let contact

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-SWDO-PL-2',
      address: '0001D3C99C1234',
      channels: SWDO_CHANNELS,
      channel: 1,
      service: 'HomeMaticContactSensorAccessory',
      values: SWDO_VALUES
    })
    contact = findService(sim.accessory, Service.ContactSensor)
  })

  after(() => sim.shutdown())

  it('reads a valid closed state before the CCU sent a value', async () => {
    expect(await read(contact.getCharacteristic(Characteristic.ContactSensorState))).to.be(0)
    expect(sim.warnings).to.eql([])
  })

  it('shows STATE 2 (open) as open', async () => {
    sim.fire('1.STATE', 2)
    const ch = contact.getCharacteristic(Characteristic.ContactSensorState)
    expect(ch.value).to.be(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
    expect(await read(ch)).to.be(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
  })

  it('shows STATE 1 (tilted) as open and STATE 0 as closed', async () => {
    const ch = contact.getCharacteristic(Characteristic.ContactSensorState)
    sim.fire('1.STATE', 0)
    expect(ch.value).to.be(0)
    sim.fire('1.STATE', 1)
    expect(ch.value).to.be(1)
    sim.fire('1.STATE', 0)
    expect(await read(ch)).to.be(0)
  })

  it('reads the string the CCU script interface returns', async () => {
    sim.server._ccu.dummyValues[sim.dp('1.STATE')] = '2'
    expect(await read(contact.getCharacteristic(Characteristic.ContactSensorState))).to.be(1)
    sim.server._ccu.dummyValues[sim.dp('1.STATE')] = 'false'
    expect(await read(contact.getCharacteristic(Characteristic.ContactSensorState))).to.be(0)
  })

  it('keeps the Eve durations finite while opening and closing', async () => {
    sim.fire('1.STATE', 2)
    sim.fire('1.STATE', 0)
    sim.fire('1.STATE', 2)
    await settle()
    expect(sim.warnings).to.eql([])
    const eve = sim.accessory.eve.Characteristic
    expect(Number.isFinite(contact.getCharacteristic(eve.OpenDuration).value)).to.be(true)
    expect(Number.isFinite(contact.getCharacteristic(eve.ClosedDuration).value)).to.be(true)
  })

  it('reports SABOTAGE as tampered', async () => {
    expect(contact.testCharacteristic(Characteristic.StatusTampered)).to.be(true)
    const ch = contact.getCharacteristic(Characteristic.StatusTampered)
    sim.fire('0.SABOTAGE', true)
    expect(ch.value).to.be(Characteristic.StatusTampered.TAMPERED)
    expect(await read(ch)).to.be(Characteristic.StatusTampered.TAMPERED)
    sim.fire('0.SABOTAGE', false)
    expect(ch.value).to.be(Characteristic.StatusTampered.NOT_TAMPERED)
  })

  it('reports an unreachable sensor as fault', async () => {
    const ch = contact.getCharacteristic(Characteristic.StatusFault)
    sim.fire('0.UNREACH', true)
    expect(ch.value).to.be(Characteristic.StatusFault.GENERAL_FAULT)
    sim.fire('0.UNREACH', false)
    expect(await read(ch)).to.be(Characteristic.StatusFault.NO_FAULT)
  })

  it('reports the battery', async () => {
    const battery = findService(sim.accessory, Service.Battery)
    sim.fire('0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(1)
    sim.fire('0.LOW_BAT', false)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(0)
    expect(sim.warnings).to.eql([])
  })
})

describe('Openings: reversed contact sensor', () => {
  let sim
  let contact

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-SCI',
      address: '0001D3C99C5678',
      channels: ['MAINTENANCE', 'MULTI_MODE_INPUT_TRANSMITTER'],
      channel: 1,
      service: 'HomeMaticContactSensorAccessory',
      settings: { reverse: true },
      values: { '0.LOW_BAT': false, '0.OPERATING_VOLTAGE': 3 }
    })
    contact = findService(sim.accessory, Service.ContactSensor)
  })

  after(() => sim.shutdown())

  it('reverses the contact', async () => {
    const ch = contact.getCharacteristic(Characteristic.ContactSensorState)
    sim.fire('1.STATE', 0)
    expect(ch.value).to.be(1)
    sim.fire('1.STATE', 1)
    expect(ch.value).to.be(0)
    expect(await read(ch)).to.be(0)
  })

  it('does not reverse the battery warning', async () => {
    const battery = findService(sim.accessory, Service.Battery)
    sim.fire('0.LOW_BAT', false)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
    sim.fire('0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
  })

  it('has no tamper or fault state without the datapoints', () => {
    expect(contact.testCharacteristic(Characteristic.StatusTampered)).to.be(false)
    expect(contact.testCharacteristic(Characteristic.StatusFault)).to.be(false)
  })
})

describe('Openings: HmIP-SRH as contact sensor', () => {
  let sim
  let contact

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-SRH',
      address: '0001D3C99C9ABC',
      channels: ['MAINTENANCE', 'ROTARY_HANDLE_TRANSCEIVER'],
      channel: 1,
      service: 'HomeMaticRotarySensorAccessory',
      values: { '0.LOW_BAT': false }
    })
    contact = findService(sim.accessory, Service.ContactSensor)
  })

  after(() => sim.shutdown())

  it('reads a valid state before the first value', async () => {
    expect(await read(contact.getCharacteristic(Characteristic.ContactSensorState))).to.be(0)
    expect(sim.warnings).to.eql([])
  })

  it('maps tilted and open to open', async () => {
    const ch = contact.getCharacteristic(Characteristic.ContactSensorState)
    sim.fire('1.STATE', 1)
    expect(ch.value).to.be(1)
    sim.fire('1.STATE', 0)
    expect(ch.value).to.be(0)
    sim.fire('1.STATE', 2)
    expect(await read(ch)).to.be(1)
    sim.fire('1.STATE', 0)
    await settle()
    expect(sim.warnings).to.eql([])
  })
})
