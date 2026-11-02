'use strict'

// HmIP-MP3P combined signal giver (hap-homematic #624): its light channels (6, 7, 8) are
// DIMMER_VIRTUAL_RECEIVERs with the eight colours of the HmIP-BSL (COLOR 0 black .. 7 white).
// The sound channels have no HomeKit counterpart.

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, read, settle, watchWarnings } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { buildDeviceCatalog } = require(path.join(__dirname, '..', 'lib', 'util', 'newDeviceCatalog.js'))
const fixture = require(path.join(__dirname, 'devices', 'HmIP-MP3P.json'))

const SERIAL = fixture.devices[0].address
const dp = (name) => 'HmIP.' + SERIAL + ':6.' + name

describe('HomeKit-CCU HmIP-MP3P light', () => {
  let server
  let accessory
  let light
  let warnings

  before(async () => {
    ({ server } = await startServer('HmIP-MP3P.json', { values: { [dp('LEVEL')]: 0, [dp('COLOR')]: 0 } }))
    await settle(20)
    accessory = accessoryAt(server, SERIAL + ':6')
    light = findService(accessory, Service.Lightbulb)
    warnings = watchWarnings(accessory)
  })

  after(() => {
    warnings.stop()
    shutdown(server)
  })

  it('is a lightbulb with brightness, hue and saturation', () => {
    expect(light.testCharacteristic(Characteristic.Brightness)).to.be(true)
    expect(light.testCharacteristic(Characteristic.Hue)).to.be(true)
    expect(light.testCharacteristic(Characteristic.Saturation)).to.be(true)
  })

  it('answers every read with a valid value', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('reads the colour of the CCU as hue and saturation', async () => {
    server._ccu.fireEvent(dp('COLOR'), 1)
    expect(light.getCharacteristic(Characteristic.Hue).value).to.be(241)
    expect(light.getCharacteristic(Characteristic.Saturation).value).to.be(100)
    server._ccu.dummyValues[dp('COLOR')] = 4
    expect(await read(light.getCharacteristic(Characteristic.Hue))).to.be(0)
    expect(await read(light.getCharacteristic(Characteristic.Saturation))).to.be(100)
    server._ccu.fireEvent(dp('COLOR'), 7)
    expect(light.getCharacteristic(Characteristic.Saturation).value).to.be(0)
  })

  it('writes hue and saturation as one of the eight colours', async () => {
    const hue = light.getCharacteristic(Characteristic.Hue)
    const saturation = light.getCharacteristic(Characteristic.Saturation)
    await saturation.handleSetRequest(100)
    await hue.handleSetRequest(125)
    expect(Number(server._ccu.dummyValues[dp('COLOR')])).to.be(2) // green
    await hue.handleSetRequest(0)
    expect(Number(server._ccu.dummyValues[dp('COLOR')])).to.be(4) // red
    await saturation.handleSetRequest(0)
    expect(Number(server._ccu.dummyValues[dp('COLOR')])).to.be(7) // white
  })

  it('offers the first light channel only, and no sound channel', () => {
    const devices = fixture.devices.map(device => ({
      ...device,
      channels: device.channels.map(channel => ({ ...channel, isSuported: channel.type === 'DIMMER_VIRTUAL_RECEIVER' }))
    }))
    const serviceTable = { DIMMER_VIRTUAL_RECEIVER: [{ serviceClazz: 'HomeMaticDimmerAccessory', description: 'dimmer' }] }
    const channels = buildDeviceCatalog(devices, {}, { serviceTable, rooms: [], functions: [], icons: {} })[0].channels
    expect(channels.map(channel => [channel.number, channel.secondary])).to.eql([[6, false], [7, true], [8, true]])
  })
})
