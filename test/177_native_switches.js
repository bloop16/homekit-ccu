const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { read, write, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { readAll } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { simulateFixture } = require(path.join(__dirname, 'helpers', 'nativeHarness.js'))
const HomeMaticSwitchAccessory = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticSwitchAccessory.js'))

describe('Native: switch channel types', () => {
  it('handles the HM-Sec-SFA-SM ALARMACTUATOR and the HmIP-FLC/FDC SWITCH_TRANSCEIVER', () => {
    expect(HomeMaticSwitchAccessory.channelTypes()).to.contain('ALARMACTUATOR')
    expect(HomeMaticSwitchAccessory.channelTypes()).to.contain('SWITCH_TRANSCEIVER')
  })
})

describe('Native: HM-Sec-SFA-SM siren/flash actuator as switch', () => {
  let sim
  let on

  before(async () => {
    sim = await simulateFixture('HM-Sec-SFA-SM.json', {
      channel: 1,
      service: 'HomeMaticSwitchAccessory',
      settings: { Type: 'Switch' },
      omit: ['1.STATE']
    })
    on = findService(sim.accessory, Service.Switch).getCharacteristic(Characteristic.On)
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a value', async () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticSwitchAccessory')
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(on)).to.be(false)
  })

  it('follows STATE and writes it', async () => {
    sim.fire('1.STATE', true)
    expect(on.value).to.be(true)
    await write(on, false)
    expect(sim.ccuValue('1.STATE')).to.be(0)
    await write(on, true)
    expect(sim.ccuValue('1.STATE')).to.be(1)
    expect(sim.warnings).to.eql([])
  })
})

describe('Native: HmIP-FLC output (SWITCH_TRANSCEIVER) as outlet', () => {
  let sim
  let outlet

  before(async () => {
    sim = await simulateFixture('HmIP-FLC.json', {
      channel: 13,
      service: 'HomeMaticSwitchAccessory',
      settings: { Type: 'Outlet' },
      omit: ['13.STATE']
    })
    outlet = findService(sim.accessory, Service.Outlet)
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a value', async () => {
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(outlet.getCharacteristic(Characteristic.On))).to.be(false)
    expect(sim.warnings).to.eql([])
  })

  it('follows STATE and writes it', async () => {
    const on = outlet.getCharacteristic(Characteristic.On)
    sim.fire('13.STATE', true)
    expect(on.value).to.be(true)
    expect(outlet.getCharacteristic(Characteristic.OutletInUse).value).to.be(true)
    await write(on, false)
    expect(sim.ccuValue('13.STATE')).to.be(0)
    expect(sim.warnings).to.eql([])
  })
})
