'use strict'

/*
 * Weather stations: Apple Home shows the native sensors (temperature primary, humidity, light in
 * lux) in both modes; the Eve mode keeps the Eve weather service for wind, rain and pressure.
 * Classic stations report BRIGHTNESS as a raw 0..255 value, which is no lux: no light sensor then.
 */

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, read, watchWarnings } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

const SWO = '00185A49B1C2D3'
const SWO_DP = (name) => 'HmIP.' + SWO + ':1.' + name
const WDS = 'NEQ0180003'
const WDS_DP = (name) => 'BidCos-RF.' + WDS + ':' + name

function describeSwo (mode, config) {
  describe('Refine: HmIP-SWO-PL weather station (' + mode + ')', () => {
    let server
    let accessory
    let warnings

    before(async () => {
      ({ server } = await startServer('HmIP-SWO-PL.json', { values: { ['HmIP.' + SWO + ':0.LOW_BAT']: false }, config }))
      accessory = accessoryAt(server, SWO + ':1')
      warnings = watchWarnings(accessory)
    })

    after(() => {
      warnings.stop()
      shutdown(server)
    })

    it('has a primary temperature sensor', () => {
      const temperature = findService(accessory, Service.TemperatureSensor)
      expect(temperature).to.be.ok()
      expect(temperature.isPrimaryService).to.be(true)
      const primaries = accessory.getHomeKitAccessory().services.filter(service => service.isPrimaryService)
      expect(primaries.length).to.be(1)
    })

    it('has a humidity sensor and a light sensor', () => {
      expect(findService(accessory, Service.HumiditySensor)).to.be.ok()
      expect(findService(accessory, Service.LightSensor)).to.be.ok()
    })

    it('feeds the Apple Home sensors from the CCU', async () => {
      server._ccu.fireEvent(SWO_DP('ACTUAL_TEMPERATURE'), 21.5)
      server._ccu.fireEvent(SWO_DP('HUMIDITY'), 55)
      server._ccu.fireEvent(SWO_DP('ILLUMINATION'), 1234.5)
      expect(findService(accessory, Service.TemperatureSensor).getCharacteristic(Characteristic.CurrentTemperature).value).to.be(21.5)
      expect(findService(accessory, Service.HumiditySensor).getCharacteristic(Characteristic.CurrentRelativeHumidity).value).to.be(55)
      expect(findService(accessory, Service.LightSensor).getCharacteristic(Characteristic.CurrentAmbientLightLevel).value).to.be(1234.5)
      server._ccu.dummyValues[SWO_DP('ACTUAL_TEMPERATURE')] = 19
      expect(await read(findService(accessory, Service.TemperatureSensor).getCharacteristic(Characteristic.CurrentTemperature))).to.be(19)
    })

    if (mode === 'Eve') {
      it('keeps the Eve weather service with wind and rain', async () => {
        const eve = findService(accessory, accessory.eveWeatherProg.Service.EveWeather)
        expect(eve).to.be.ok()
        expect(eve.isPrimaryService).to.not.be(true)
        server._ccu.fireEvent(SWO_DP('WIND_SPEED'), 12)
        expect(eve.getCharacteristic(accessory.eveWeatherProg.Characteristic.WindSpeed).value).to.be(12)
        server._ccu.fireEvent(SWO_DP('RAINING'), true)
        expect(await read(eve.getCharacteristic(accessory.eveWeatherProg.Characteristic.RainBool))).to.be(true)
        expect(eve.getCharacteristic(Characteristic.CurrentTemperature).value).to.be(21.5)
      })
    } else {
      it('has no Eve weather service', () => {
        expect(findService(accessory, accessory.eveWeatherProg.Service.EveWeather)).to.be(undefined)
      })
    }

    it('answers every read with a valid value', async () => {
      expect(await readAll(accessory)).to.eql([])
      expect(warnings.list).to.eql([])
    })
  })
}

describeSwo('Eve', {})
describeSwo('Apple Home', { disableHistory: true })

function describeWds (mode, config) {
  describe('Refine: HM-WDS100-C6-O-2 classic weather station (' + mode + ')', () => {
    let server
    let accessory
    let warnings

    before(async () => {
      const values = {
        [WDS_DP('0.LOWBAT')]: false,
        [WDS_DP('1.TEMPERATURE')]: 12.3,
        [WDS_DP('1.HUMIDITY')]: 80,
        [WDS_DP('1.BRIGHTNESS')]: 200,
        [WDS_DP('1.RAINING')]: false,
        [WDS_DP('1.WIND_SPEED')]: 10.5
      }
      ;({ server } = await startServer('HM-WDS100-C6-O-2.json', { values, config }))
      accessory = accessoryAt(server, WDS + ':1')
      warnings = watchWarnings(accessory)
    })

    after(() => {
      warnings.stop()
      shutdown(server)
    })

    it('is covered by the weather station class', () => {
      expect(accessory.serviceClass).to.be('HomeMaticWeatherStationAccessory')
    })

    it('has a primary temperature sensor and a humidity sensor', async () => {
      const temperature = findService(accessory, Service.TemperatureSensor)
      expect(temperature.isPrimaryService).to.be(true)
      expect(Math.abs(await read(temperature.getCharacteristic(Characteristic.CurrentTemperature)) - 12.3)).to.be.lessThan(0.001)
      expect(await read(findService(accessory, Service.HumiditySensor).getCharacteristic(Characteristic.CurrentRelativeHumidity))).to.be(80)
    })

    it('shows no raw BRIGHTNESS as lux', () => {
      expect(findService(accessory, Service.LightSensor)).to.be(undefined)
      const eve = findService(accessory, accessory.eveWeatherProg.Service.EveWeather)
      if (eve) {
        expect(eve.testCharacteristic(Characteristic.CurrentAmbientLightLevel)).to.be(false)
      }
    })

    if (mode === 'Eve') {
      it('keeps wind and rain in the Eve weather service', async () => {
        const eve = findService(accessory, accessory.eveWeatherProg.Service.EveWeather)
        expect(await read(eve.getCharacteristic(accessory.eveWeatherProg.Characteristic.WindSpeed))).to.be(10)
        expect(await read(eve.getCharacteristic(accessory.eveWeatherProg.Characteristic.RainBool))).to.be(false)
      })
    }

    it('reports the battery from LOWBAT', () => {
      expect(findService(accessory, Service.Battery)).to.be.ok()
    })

    it('answers every read with a valid value', async () => {
      expect(await readAll(accessory)).to.eql([])
      expect(warnings.list).to.eql([])
    })
  })
}

describeWds('Eve', {})
describeWds('Apple Home', { disableHistory: true })
