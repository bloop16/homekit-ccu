const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, read, settle } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

describe('HomeKit-CCU sensors: HmIP-BSL dimmer with signal colour', () => {
  const BSL = '7068778492ABCD'
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HmIP-BSL.json'))
    accessory = accessoryAt(server, BSL + ':8')
  })

  after(() => shutdown(server))

  it('answers every read with a valid value before the CCU sent any event', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('reads the colour the CCU answers as text (ReGa)', async () => {
    server._ccu.dummyValues['HmIP.' + BSL + ':8.COLOR'] = '5'
    const lightbulb = findService(accessory, Service.Lightbulb)
    expect(await read(lightbulb.getCharacteristic(Characteristic.Hue))).to.be(308)
    expect(await read(lightbulb.getCharacteristic(Characteristic.Saturation))).to.be(100)
  })
})

describe('HomeKit-CCU sensors: HM-LC-DW-WM dual white dimmer', () => {
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HM-LC-DW-WM.json'))
    accessory = accessoryAt(server, '1357501497ABCD:1')
  })

  after(() => shutdown(server))

  it('answers every read with a valid value before the CCU sent any event', async () => {
    expect(await readAll(accessory)).to.eql([])
  })
})

describe('HomeKit-CCU sensors: VIR-LG-RGB-DIM colour light', () => {
  const RGB = '1079891752ABCD'
  const colorDP = 'VirtualDevices.' + RGB + ':1.RGB'
  let server
  let accessory
  let lightbulb

  before(async () => {
    ({ server } = await startServer('VIR-LG-RGB-DIM.json'))
    accessory = accessoryAt(server, RGB + ':1')
    lightbulb = findService(accessory, Service.Lightbulb)
  })

  after(() => shutdown(server))

  it('answers every read with a valid value before the CCU sent any event', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('sets pure red (hue 0) as rgb(255, 0, 0)', async () => {
    await lightbulb.getCharacteristic(Characteristic.Hue).handleSetRequest(0)
    await lightbulb.getCharacteristic(Characteristic.Saturation).handleSetRequest(100)
    expect(server._ccu.dummyValues[colorDP]).to.be('rgb(255, 0, 0)')
  })

  it('sets green as rgb(0, 255, 0)', async () => {
    await lightbulb.getCharacteristic(Characteristic.Hue).handleSetRequest(120)
    expect(server._ccu.dummyValues[colorDP]).to.be('rgb(0, 255, 0)')
  })

  it('reads the colour from the CCU', async () => {
    server._ccu.fireEvent(colorDP, 'rgb(0, 0, 255)')
    expect(await read(lightbulb.getCharacteristic(Characteristic.Hue))).to.be(240)
    expect(await read(lightbulb.getCharacteristic(Characteristic.Saturation))).to.be(100)
  })
})

describe('HomeKit-CCU sensors: HmIP-RGBW universal light', () => {
  const RGBW = '0031A0A9B1C2D3'
  const DP = (name) => 'HmIP.' + RGBW + ':1.' + name
  let server
  let accessory
  let lightbulb

  before(async () => {
    ({ server } = await startServer('HmIP-RGBW.json'))
    accessory = accessoryAt(server, RGBW + ':1')
    lightbulb = findService(accessory, Service.Lightbulb)
  })

  after(() => shutdown(server))

  it('answers every read with a valid value before the CCU sent any event', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('updates Saturation (not Hue) on a SATURATION event', () => {
    server._ccu.fireEvent(DP('HUE'), 200)
    server._ccu.fireEvent(DP('SATURATION'), 0.5)
    expect(lightbulb.getCharacteristic(Characteristic.Hue).value).to.be(200)
    expect(lightbulb.getCharacteristic(Characteristic.Saturation).value).to.be(50)
  })

  it('sends a complete COMBINED_PARAMETER when only the hue changes', async () => {
    server._ccu.fireEvent(DP('LEVEL'), 0.8)
    await settle()
    await lightbulb.getCharacteristic(Characteristic.Hue).handleSetRequest(120)
    const combined = server._ccu.dummyValues[DP('COMBINED_PARAMETER')]
    expect(combined).to.be.a('string')
    expect(combined).not.to.contain('undefined')
    expect(combined).to.contain('L=80,H=120,SAT=50')
  })
})
