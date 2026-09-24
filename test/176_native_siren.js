const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { read, write, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { readAll } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { simulateFixture } = require(path.join(__dirname, 'helpers', 'nativeHarness.js'))

const SIREN_VALUES = { '0.LOW_BAT': false, '0.SABOTAGE': false, '0.UNREACH': false }

describe('Native: HmIP-ASIR-2 siren as alarm switch (defaults)', () => {
  let sim
  let alarm
  let on

  before(async () => {
    sim = await simulateFixture('HmIP-ASIR-2.json', {
      channel: 3,
      service: 'HomeMaticIPSirenAccessory',
      values: SIREN_VALUES
    })
    alarm = findService(sim.accessory, Service.Switch)
    on = alarm.getCharacteristic(Characteristic.On)
  })

  after(() => sim.shutdown())

  it('is ONE switch named "<name> Alarm"', () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticIPSirenAccessory')
    const switches = sim.accessory.homeKitAccessory.services.filter(s => s.UUID === Service.Switch.UUID)
    expect(switches.length).to.be(1)
    expect(alarm.getCharacteristic(Characteristic.Name).value).to.be(sim.accessory.getName() + ' Alarm')
  })

  it('answers every read before the CCU sent a value', async () => {
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(on)).to.be(false)
    expect(sim.warnings).to.eql([])
  })

  it('starts a rising tone with alternating light for 180 s by default', async () => {
    await write(on, true)
    expect(sim.ccuValue('3.DURATION_UNIT')).to.be(0)
    expect(sim.ccuValue('3.DURATION_VALUE')).to.be(180)
    expect(sim.ccuValue('3.OPTICAL_ALARM_SELECTION')).to.be(1)
    expect(sim.ccuValue('3.ACOUSTIC_ALARM_SELECTION')).to.be(1)
  })

  it('shows a running alarm from ACOUSTIC_ALARM_ACTIVE or OPTICAL_ALARM_ACTIVE', async () => {
    sim.fire('3.ACOUSTIC_ALARM_ACTIVE', true)
    sim.fire('3.OPTICAL_ALARM_ACTIVE', true)
    expect(on.value).to.be(true)
    sim.fire('3.ACOUSTIC_ALARM_ACTIVE', false)
    expect(on.value).to.be(true)
    sim.fire('3.OPTICAL_ALARM_ACTIVE', false)
    expect(on.value).to.be(false)
    expect(await read(on)).to.be(false)
  })

  it('stops the alarm with the disable signals and duration 0', async () => {
    await write(on, false)
    expect(sim.ccuValue('3.DURATION_VALUE')).to.be(0)
    expect(sim.ccuValue('3.OPTICAL_ALARM_SELECTION')).to.be(0)
    expect(sim.ccuValue('3.ACOUSTIC_ALARM_SELECTION')).to.be(0)
  })

  it('reports the battery', async () => {
    const battery = findService(sim.accessory, Service.Battery)
    sim.fire('0.LOW_BAT', true)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
    expect(sim.warnings).to.eql([])
  })
})

describe('Native: HmIP-ASIR-2 siren with configured signals', () => {
  let sim

  before(async () => {
    sim = await simulateFixture('HmIP-ASIR-2.json', {
      channel: 3,
      service: 'HomeMaticIPSirenAccessory',
      values: SIREN_VALUES,
      settings: { acoustic: 'DISABLE_ACOUSTIC_SIGNAL', optical: 'FLASHING_BOTH_REPEATING', duration: '30' }
    })
  })

  after(() => sim.shutdown())

  it('writes the configured selection and duration', async () => {
    const on = findService(sim.accessory, Service.Switch).getCharacteristic(Characteristic.On)
    await write(on, true)
    expect(sim.ccuValue('3.DURATION_VALUE')).to.be(30)
    expect(sim.ccuValue('3.OPTICAL_ALARM_SELECTION')).to.be(4)
    expect(sim.ccuValue('3.ACOUSTIC_ALARM_SELECTION')).to.be(0)
  })
})

describe('Native: HmIP-ASIR-2 siren with invalid settings', () => {
  let sim

  before(async () => {
    sim = await simulateFixture('HmIP-ASIR-2.json', {
      channel: 3,
      service: 'HomeMaticIPSirenAccessory',
      values: SIREN_VALUES,
      settings: { acoustic: 'LOUDER', optical: 42, duration: 'forever' }
    })
  })

  after(() => sim.shutdown())

  it('falls back to the safe defaults', async () => {
    const on = findService(sim.accessory, Service.Switch).getCharacteristic(Characteristic.On)
    await write(on, true)
    expect(sim.ccuValue('3.DURATION_VALUE')).to.be(180)
    expect(sim.ccuValue('3.OPTICAL_ALARM_SELECTION')).to.be(1)
    expect(sim.ccuValue('3.ACOUSTIC_ALARM_SELECTION')).to.be(1)
  })
})
