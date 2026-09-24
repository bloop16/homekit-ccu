'use strict'

/*
 * UNIVERSAL_LIGHT_RECEIVER (HmIP-RGBW, HmIP-LSC, E27, GU10): white (colour temperature) next to
 * colour (hue / saturation). COLOR_TEMPERATURE is Kelvin at the CCU, mired in HomeKit, limited to
 * the white range of the device (HARDWARE_COLOR_TEMPERATURE_WARM_WHITE / _COLD_WHITE).
 */

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const HomeMaticTestCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticTestCCU.js'))
const { startServer, accessoryAt, shutdown, readAll, findService, read, settle, watchWarnings } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

const LSC = '0031A0A9B18001'
const RGBW = '0031A0A9B1C2D3'
const LSC_DP = (name) => 'HmIP.' + LSC + ':1.' + name
const RGBW_DP = (name) => 'HmIP.' + RGBW + ':1.' + name

// answers getParamset like the CCU; everything else like the test CCU
function withParamsets (paramsets, run) {
  const original = HomeMaticTestCCU.prototype.sendInterfaceCommand
  HomeMaticTestCCU.prototype.sendInterfaceCommand = function (interfaceId, command, parameters) {
    if (command === 'getParamset') {
      return Promise.resolve(paramsets[parameters[0] + '/' + parameters[1]])
    }
    return original.call(this, interfaceId, command, parameters)
  }
  return run().finally(() => { HomeMaticTestCCU.prototype.sendInterfaceCommand = original })
}

describe('Refine: HmIP-LSC colour temperature', () => {
  let server
  let accessory
  let light
  let warnings

  before(async () => {
    const paramsets = {
      [LSC + ':1/MASTER']: { HARDWARE_COLOR_TEMPERATURE_WARM_WHITE: 2000, HARDWARE_COLOR_TEMPERATURE_COLD_WHITE: 6500 }
    }
    await withParamsets(paramsets, async () => {
      ({ server } = await startServer('HmIP-LSC.json', { values: { [LSC_DP('LEVEL')]: 0, [LSC_DP('COLOR_TEMPERATURE')]: '' } }))
      await settle(20)
    })
    accessory = accessoryAt(server, LSC + ':1')
    light = findService(accessory, Service.Lightbulb)
    warnings = watchWarnings(accessory)
  })

  after(() => {
    warnings.stop()
    shutdown(server)
  })

  it('has hue, saturation and colour temperature', () => {
    expect(light.testCharacteristic(Characteristic.Hue)).to.be(true)
    expect(light.testCharacteristic(Characteristic.Saturation)).to.be(true)
    expect(light.testCharacteristic(Characteristic.ColorTemperature)).to.be(true)
  })

  it('limits the colour temperature to the white range of the device', () => {
    const props = light.getCharacteristic(Characteristic.ColorTemperature).props
    // 6500 K = 153.8 mired, 2000 K = 500 mired
    expect(props.minValue).to.be(154)
    expect(props.maxValue).to.be(500)
  })

  it('answers every read with a valid value while the lamp shows a colour', async () => {
    expect(await readAll(accessory)).to.eql([])
    const ct = await read(light.getCharacteristic(Characteristic.ColorTemperature))
    expect(Number.isFinite(ct)).to.be(true)
  })

  it('reads COLOR_TEMPERATURE in Kelvin as mired', async () => {
    server._ccu.dummyValues[LSC_DP('COLOR_TEMPERATURE')] = 4000
    expect(await read(light.getCharacteristic(Characteristic.ColorTemperature))).to.be(250)
    server._ccu.fireEvent(LSC_DP('COLOR_TEMPERATURE'), 2700)
    expect(light.getCharacteristic(Characteristic.ColorTemperature).value).to.be(370)
  })

  it('clamps colour temperatures outside the device range', async () => {
    server._ccu.fireEvent(LSC_DP('COLOR_TEMPERATURE'), 10000)
    expect(light.getCharacteristic(Characteristic.ColorTemperature).value).to.be(154)
    server._ccu.dummyValues[LSC_DP('COLOR_TEMPERATURE')] = 1000
    expect(await read(light.getCharacteristic(Characteristic.ColorTemperature))).to.be(500)
  })

  it('switches to white: sends COLOR_TEMPERATURE in Kelvin within the device range', async () => {
    await light.getCharacteristic(Characteristic.ColorTemperature).handleSetRequest(200)
    await settle(20)
    expect(server._ccu.dummyValues[LSC_DP('COLOR_TEMPERATURE')]).to.be(5000)
    await light.getCharacteristic(Characteristic.ColorTemperature).handleSetRequest(140)
    await settle(20)
    expect(server._ccu.dummyValues[LSC_DP('COLOR_TEMPERATURE')]).to.be(6500)
  })

  it('switches back to colour with hue and saturation', async () => {
    server._ccu.fireEvent(LSC_DP('LEVEL'), 0.5)
    await light.getCharacteristic(Characteristic.Saturation).handleSetRequest(100)
    await light.getCharacteristic(Characteristic.Hue).handleSetRequest(240)
    const combined = server._ccu.dummyValues[LSC_DP('COMBINED_PARAMETER')]
    expect(combined).to.contain('H=240,SAT=100')
    expect(combined).not.to.contain('NaN')
  })

  it('ignores an empty COLOR_TEMPERATURE (colour mode) and an empty HUE (white mode)', () => {
    const ct = light.getCharacteristic(Characteristic.ColorTemperature).value
    server._ccu.fireEvent(LSC_DP('COLOR_TEMPERATURE'), '')
    server._ccu.fireEvent(LSC_DP('HUE'), '')
    expect(light.getCharacteristic(Characteristic.ColorTemperature).value).to.be(ct)
    expect(Number.isFinite(light.getCharacteristic(Characteristic.Hue).value)).to.be(true)
  })

  it('sends no illegal values to HomeKit', () => {
    expect(warnings.list).to.eql([])
  })
})

describe('Refine: HmIP-RGBW in RGBW mode', () => {
  let server
  let accessory

  before(async () => {
    const paramsets = { [RGBW + ':0/MASTER']: { DEVICE_OPERATION_MODE: 0 } }
    await withParamsets(paramsets, async () => {
      ({ server } = await startServer('HmIP-RGBW.json'))
      await settle(20)
    })
    accessory = accessoryAt(server, RGBW + ':1')
  })

  after(() => shutdown(server))

  it('keeps hue and saturation only (the device has no white channel in this mode)', async () => {
    const light = findService(accessory, Service.Lightbulb)
    expect(light.testCharacteristic(Characteristic.Hue)).to.be(true)
    expect(light.testCharacteristic(Characteristic.ColorTemperature)).to.be(false)
    expect(await readAll(accessory)).to.eql([])
  })
})

describe('Refine: HmIP-RGBW in tunable white mode', () => {
  let server
  let accessory

  before(async () => {
    const paramsets = {
      [RGBW + ':0/MASTER']: { DEVICE_OPERATION_MODE: '2_TUNABLE_WHITE' },
      [RGBW + ':1/MASTER']: { HARDWARE_COLOR_TEMPERATURE_WARM_WHITE: 2700, HARDWARE_COLOR_TEMPERATURE_COLD_WHITE: 5000 }
    }
    await withParamsets(paramsets, async () => {
      ({ server } = await startServer('HmIP-RGBW.json', { values: { [RGBW_DP('COLOR_TEMPERATURE')]: 3000 } }))
      await settle(20)
    })
    accessory = accessoryAt(server, RGBW + ':1')
  })

  after(() => shutdown(server))

  it('adds the colour temperature with the range of the stripe', async () => {
    const light = findService(accessory, Service.Lightbulb)
    const ct = light.getCharacteristic(Characteristic.ColorTemperature)
    expect(light.testCharacteristic(Characteristic.ColorTemperature)).to.be(true)
    expect(ct.props.minValue).to.be(200)
    expect(ct.props.maxValue).to.be(370)
    expect(await read(ct)).to.be(333)
    expect(await readAll(accessory)).to.eql([])
  })
})

describe('Refine: HmIP-LSC with colour temperature switched off', () => {
  let server
  let accessory

  before(async () => {
    const mappings = { [LSC + ':1']: { Service: 'HomeMaticIPRGBWAccessory', settings: { colorTemperature: false } } }
    ;({ server } = await startServer('HmIP-LSC.json', { mappings }))
    await settle(20)
    accessory = accessoryAt(server, LSC + ':1')
  })

  after(() => shutdown(server))

  it('keeps the stored choice', () => {
    const light = findService(accessory, Service.Lightbulb)
    expect(light.testCharacteristic(Characteristic.ColorTemperature)).to.be(false)
  })
})
