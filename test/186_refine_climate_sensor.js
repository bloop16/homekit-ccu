'use strict'

/*
 * CLIMATE_TRANSCEIVER sensors (HmIP-STHO, ELV-SH-CTH, ELV-SH-CAP): a primary temperature sensor
 * and a humidity sensor fed by ACTUAL_TEMPERATURE / HUMIDITY, never NaN; the air pressure of the
 * ELV-SH-CAP goes to the Eve air pressure characteristic.
 */

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const EveHomeKitWeatherTypes = require(path.join(__dirname, '..', 'lib', 'services', 'EveWeather.js'))
const { startServer, accessoryAt, shutdown, readAll, findService, read, settle, watchWarnings } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

function describeClimateSensor (fixture, address) {
  const DP = (name) => 'HmIP.' + address + ':' + name

  describe('Refine: ' + fixture + ' climate sensor', () => {
    let server
    let accessory
    let warnings

    before(async () => {
      ({ server } = await startServer(fixture + '.json', { values: { [DP('0.LOW_BAT')]: false, [DP('0.OPERATING_VOLTAGE')]: 2.9 } }))
      await settle(20)
      accessory = accessoryAt(server, address + ':1')
      warnings = watchWarnings(accessory)
    })

    after(() => {
      warnings.stop()
      shutdown(server)
    })

    it('has a primary temperature sensor and a humidity sensor', () => {
      expect(findService(accessory, Service.TemperatureSensor).isPrimaryService).to.be(true)
      expect(findService(accessory, Service.HumiditySensor)).to.be.ok()
    })

    it('answers every read with a valid value before the CCU sent a value', async () => {
      expect(await readAll(accessory)).to.eql([])
    })

    it('reads ACTUAL_TEMPERATURE and HUMIDITY', async () => {
      server._ccu.fireEvent(DP('1.ACTUAL_TEMPERATURE'), -3.5)
      server._ccu.fireEvent(DP('1.HUMIDITY'), 91)
      const temperature = findService(accessory, Service.TemperatureSensor).getCharacteristic(Characteristic.CurrentTemperature)
      const humidity = findService(accessory, Service.HumiditySensor).getCharacteristic(Characteristic.CurrentRelativeHumidity)
      expect(temperature.value).to.be(-3.5)
      expect(humidity.value).to.be(91)
      expect(await read(temperature)).to.be(-3.5)
      expect(await read(humidity)).to.be(91)
    })

    it('keeps the last value on an empty or invalid value', async () => {
      server._ccu.fireEvent(DP('1.ACTUAL_TEMPERATURE'), '')
      server._ccu.fireEvent(DP('1.HUMIDITY'), 'NaN')
      server._ccu.dummyValues[DP('1.ACTUAL_TEMPERATURE')] = undefined
      const temperature = findService(accessory, Service.TemperatureSensor).getCharacteristic(Characteristic.CurrentTemperature)
      expect(await read(temperature)).to.be(-3.5)
      expect(await readAll(accessory)).to.eql([])
    })

    it('reports the battery', () => {
      expect(findService(accessory, Service.Battery)).to.be.ok()
    })

    it('sends no illegal values to HomeKit', () => {
      expect(warnings.list).to.eql([])
    })
  })
}

describeClimateSensor('HmIP-STHO', '0007A0A9B18004')
describeClimateSensor('ELV-SH-CTH', '0007A0A9B18005')

describe('Refine: ELV-SH-CAP air pressure', () => {
  const CAP = '0007A0A9B18006'
  const DP = (name) => 'HmIP.' + CAP + ':' + name
  let server
  let accessory
  let pressure

  before(async () => {
    ({ server } = await startServer('ELV-SH-CAP.json', { values: { [DP('1.ACTUAL_TEMPERATURE')]: 20.5, [DP('1.AIR_PRESSURE')]: 1013.4 } }))
    await settle(20)
    accessory = accessoryAt(server, CAP + ':1')
    const eve = new EveHomeKitWeatherTypes(accessory.gatoHomeBridge.hap)
    const temperature = findService(accessory, Service.TemperatureSensor)
    pressure = temperature.characteristics.find(characteristic => characteristic.UUID === eve.Characteristic.AirPressure.UUID)
  })

  after(() => shutdown(server))

  it('adds the Eve air pressure to the temperature sensor', async () => {
    expect(pressure).to.be.ok()
    expect(await read(pressure)).to.be(1013)
  })

  it('updates the air pressure on an event', () => {
    server._ccu.fireEvent(DP('1.AIR_PRESSURE'), 998.6)
    expect(pressure.value).to.be(999)
  })

  it('answers every read with a valid value', async () => {
    expect(await readAll(accessory)).to.eql([])
  })
})
