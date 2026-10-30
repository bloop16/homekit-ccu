'use strict'

// HmIP-DRG-DALI (hap-homematic #721): every DALI channel is a UNIVERSAL_LIGHT_RECEIVER, whatever
// lamp is connected. UNIVERSAL_LIGHT_MAX_CAPABILITIES of the channel tells what the lamp can do,
// so a lamp without colour does not get a colour wheel in Apple Home.

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const HomeMaticTestCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticTestCCU.js'))
const { startServer, accessoryAt, shutdown, readAll, findService, read, settle } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const fixture = require(path.join(__dirname, 'devices', 'HmIP-DRG-DALI.json'))

const SERIAL = fixture.devices[0].address
const CHANNELS = { 1: 'DIMMER_RGBW', 2: 'DIMMER_RGB', 3: 'DIMMER_TUNABLE_WHITE', 4: 'DIMMER_ONE_CHANNEL', 5: 'SWITCH', 6: 'INACTIVE', 7: 3, 8: '2', 9: undefined }

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

describe('HomeKit-CCU HmIP-DRG-DALI lights', () => {
  let server
  const light = (channel) => findService(accessoryAt(server, SERIAL + ':' + channel), Service.Lightbulb)
  const has = (channel, characteristic) => light(channel).testCharacteristic(characteristic)

  before(async () => {
    const paramsets = {}
    const mappings = {}
    Object.keys(CHANNELS).forEach(channel => {
      mappings[SERIAL + ':' + channel] = { Service: 'HomeMaticIPRGBWAccessory', name: 'DALI lamp ' + channel }
      // channel 9 answers nothing: the CCU did not tell
      if (CHANNELS[channel] !== undefined) {
        paramsets[SERIAL + ':' + channel + '/MASTER'] = { UNIVERSAL_LIGHT_MAX_CAPABILITIES: CHANNELS[channel], HARDWARE_COLOR_TEMPERATURE_WARM_WHITE: 2000, HARDWARE_COLOR_TEMPERATURE_COLD_WHITE: 6500 }
      }
    })
    await withParamsets(paramsets, async () => {
      ({ server } = await startServer('HmIP-DRG-DALI.json', { mappings, config: { channels: Object.keys(mappings) } }))
      await settle(50)
    })
  })

  after(() => shutdown(server))

  it('offers every DALI channel as a light', () => {
    const lights = fixture.devices[0].channels.filter(channel => channel.type === 'UNIVERSAL_LIGHT_RECEIVER')
    expect(lights.length).to.be(48)
    expect(accessoryAt(server, SERIAL + ':1').serviceClass).to.be('HomeMaticIPRGBWAccessory')
  })

  it('RGBW: brightness, colour and white', () => {
    expect(has(1, Characteristic.Brightness)).to.be(true)
    expect(has(1, Characteristic.Hue)).to.be(true)
    expect(has(1, Characteristic.Saturation)).to.be(true)
    expect(has(1, Characteristic.ColorTemperature)).to.be(true)
  })

  it('RGB: brightness and colour, no white', () => {
    expect(has(2, Characteristic.Hue)).to.be(true)
    expect(has(2, Characteristic.Saturation)).to.be(true)
    expect(has(2, Characteristic.Brightness)).to.be(true)
    expect(has(2, Characteristic.ColorTemperature)).to.be(false)
  })

  it('tunable white: brightness and white, no colour', () => {
    expect(has(3, Characteristic.ColorTemperature)).to.be(true)
    expect(has(3, Characteristic.Brightness)).to.be(true)
    expect(has(3, Characteristic.Hue)).to.be(false)
    expect(has(3, Characteristic.Saturation)).to.be(false)
  })

  it('one channel dimmer: brightness only', () => {
    expect(has(4, Characteristic.Brightness)).to.be(true)
    expect(has(4, Characteristic.Hue)).to.be(false)
    expect(has(4, Characteristic.Saturation)).to.be(false)
    expect(has(4, Characteristic.ColorTemperature)).to.be(false)
  })

  it('switch: on and off only', () => {
    expect(has(5, Characteristic.On)).to.be(true)
    expect(has(5, Characteristic.Brightness)).to.be(false)
    expect(has(5, Characteristic.Hue)).to.be(false)
    expect(has(5, Characteristic.ColorTemperature)).to.be(false)
  })

  it('an inactive channel, an unknown answer and no answer keep every control', () => {
    ;[6, 9].forEach(channel => {
      expect(has(channel, Characteristic.Brightness)).to.be(true)
      expect(has(channel, Characteristic.Hue)).to.be(true)
    })
  })

  it('understands the capability as number or text of the ENUM index', () => {
    expect(has(7, Characteristic.Hue)).to.be(true)
    expect(has(7, Characteristic.ColorTemperature)).to.be(false)
    expect(has(8, Characteristic.ColorTemperature)).to.be(true)
    expect(has(8, Characteristic.Hue)).to.be(false)
  })

  it('answers every read with a valid value', async () => {
    for (const channel of [1, 3, 4, 5]) {
      expect(await readAll(accessoryAt(server, SERIAL + ':' + channel))).to.eql([])
    }
    expect(await read(light(3).getCharacteristic(Characteristic.On))).to.be(false)
  })
})
