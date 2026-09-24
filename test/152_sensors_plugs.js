const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, read, settle, watchWarnings } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

const PSM = '5857734983ABCD'

describe('HomeKit-CCU sensors: HMIP-PSM switch and measuring plug', () => {
  let server
  let accessory
  let warnings

  before(async () => {
    ({ server } = await startServer('HmIP-PSM.json'))
    accessory = accessoryAt(server, PSM + ':6')
  })

  after(() => shutdown(server))

  beforeEach(() => { warnings = watchWarnings(accessory) })
  afterEach(function () {
    warnings.stop()
    if (this.currentTest.state === 'passed') expect(warnings.list).to.eql([])
  })

  const outlet = () => findService(accessory, Service.Outlet)

  it('keeps the Outlet as the service of the plug', () => {
    expect(accessory.serviceClass).to.be('HomeMaticIPPowerMeterSwitchAccessory')
    expect(outlet()).to.be.ok()
  })

  it('answers every read with a valid value before the CCU sent any event', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('switches channel 3 (the first virtual switch channel)', async () => {
    await outlet().getCharacteristic(Characteristic.On).handleSetRequest(true)
    expect(server._ccu.dummyValues['HmIP.' + PSM + ':3.STATE']).to.be(true)
    await outlet().getCharacteristic(Characteristic.On).handleSetRequest(false)
    expect(server._ccu.dummyValues['HmIP.' + PSM + ':3.STATE']).to.be(false)
  })

  it('reports OutletInUse when POWER is drawn', async () => {
    const inUse = outlet().getCharacteristic(Characteristic.OutletInUse)
    server._ccu.fireEvent('HmIP.' + PSM + ':6.POWER', 23.7)
    expect(inUse.value).to.be(true)
    expect(await read(inUse)).to.be(true)
  })

  it('reports OutletInUse false for standby power below the threshold', async () => {
    const inUse = outlet().getCharacteristic(Characteristic.OutletInUse)
    server._ccu.fireEvent('HmIP.' + PSM + ':6.POWER', 0.3)
    expect(inUse.value).to.be(false)
    expect(await read(inUse)).to.be(false)
  })

  it('reports OutletInUse false when nothing is drawn', async () => {
    const inUse = outlet().getCharacteristic(Characteristic.OutletInUse)
    server._ccu.fireEvent('HmIP.' + PSM + ':6.POWER', 25)
    server._ccu.fireEvent('HmIP.' + PSM + ':6.POWER', 0)
    expect(inUse.value).to.be(false)
    expect(await read(inUse)).to.be(false)
  })

  it('reports the Eve measurements as numbers', async () => {
    server._ccu.fireEvent('HmIP.' + PSM + ':6.POWER', 60.4)
    server._ccu.fireEvent('HmIP.' + PSM + ':6.CURRENT', 270)
    server._ccu.fireEvent('HmIP.' + PSM + ':6.VOLTAGE', 229.6)
    server._ccu.fireEvent('HmIP.' + PSM + ':6.ENERGY_COUNTER', 12345)
    expect(await read(outlet().getCharacteristic(accessory.eve.Characteristic.ElectricPower))).to.be(60)
    expect(await read(outlet().getCharacteristic(accessory.eve.Characteristic.ElectricCurrent))).to.be(0.27)
    expect(await read(outlet().getCharacteristic(accessory.eve.Characteristic.TotalConsumption))).to.be(12.35)
    expect(outlet().getCharacteristic(accessory.eve.Characteristic.TotalConsumption).value).to.be(12.35)
    expect(typeof (await read(outlet().getCharacteristic(accessory.eve.Characteristic.Voltage)))).to.be('number')
  })
})

describe('HomeKit-CCU sensors: HmIP-FSM16 switch actuator with power measurement', () => {
  const FSM = '0001D5A9B1C2D3'
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HmIP-FSM16.json'))
    accessory = accessoryAt(server, FSM + ':5')
  })

  after(() => shutdown(server))

  it('switches the first virtual switch channel in front of the meter channel', async () => {
    const outlet = findService(accessory, Service.Outlet)
    await outlet.getCharacteristic(Characteristic.On).handleSetRequest(true)
    expect(server._ccu.dummyValues['HmIP.' + FSM + ':2.STATE']).to.be(true)
    server._ccu.fireEvent('HmIP.' + FSM + ':2.STATE', false)
    expect(await read(outlet.getCharacteristic(Characteristic.On))).to.be(false)
  })
})

describe('HomeKit-CCU sensors: HmIP-PS-2 plug as Outlet', () => {
  const PS = '0001D709A1B2C3'
  let server
  let accessory
  let warnings

  before(async () => {
    ({ server } = await startServer('HmIP-PS-2.json'))
    accessory = accessoryAt(server, PS + ':3')
  })

  after(() => shutdown(server))

  beforeEach(() => { warnings = watchWarnings(accessory) })
  afterEach(function () {
    warnings.stop()
    if (this.currentTest.state === 'passed') expect(warnings.list).to.eql([])
  })

  it('is an Outlet', () => {
    expect(accessory.serviceClass).to.be('HomeMaticSwitchAccessory')
    expect(findService(accessory, Service.Outlet)).to.be.ok()
  })

  it('answers every read with a valid value before the CCU sent any event', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('reports OutletInUse while switched on (there is no power measurement)', async () => {
    const outlet = findService(accessory, Service.Outlet)
    const inUse = outlet.getCharacteristic(Characteristic.OutletInUse)
    server._ccu.fireEvent('HmIP.' + PS + ':3.STATE', true)
    await settle()
    expect(inUse.value).to.be(true)
    expect(await read(inUse)).to.be(true)
    server._ccu.fireEvent('HmIP.' + PS + ':3.STATE', false)
    expect(inUse.value).to.be(false)
    expect(await read(inUse)).to.be(false)
  })
})
