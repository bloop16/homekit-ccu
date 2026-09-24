const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, read, watchWarnings } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

const SWO = '00185A49B1C2D3'
const DP = (name) => 'HmIP.' + SWO + ':1.' + name
const BATTERY_VALUES = {
  ['HmIP.' + SWO + ':0.LOW_BAT']: false
}

function describeWeatherStation (mode, config) {
  describe('HomeKit-CCU sensors: HmIP-SWO-PL weather sensor (' + mode + ')', () => {
    let server
    let accessory
    let warnings

    before(async () => {
      ({ server } = await startServer('HmIP-SWO-PL.json', { values: BATTERY_VALUES, config }))
      accessory = accessoryAt(server, SWO + ':1')
    })

    after(() => shutdown(server))

    beforeEach(() => { warnings = watchWarnings(accessory) })
    afterEach(function () {
      warnings.stop()
      if (this.currentTest.state === 'passed') expect(warnings.list).to.eql([])
    })

    const temperatureService = () => (mode === 'Eve')
      ? findService(accessory, accessory.eveWeatherProg.Service.EveWeather)
      : findService(accessory, Service.TemperatureSensor)
    const lightService = () => (mode === 'Eve')
      ? findService(accessory, accessory.eveWeatherProg.Service.EveWeather)
      : findService(accessory, Service.LightSensor)

    it('is mapped to HomeMaticWeatherStationAccessory', () => {
      expect(accessory.serviceClass).to.be('HomeMaticWeatherStationAccessory')
    })

    it('answers every read with a valid value before the CCU sent any event', async () => {
      expect(await readAll(accessory)).to.eql([])
    })

    it('reports frost (negative ACTUAL_TEMPERATURE)', async () => {
      const temperature = temperatureService().getCharacteristic(Characteristic.CurrentTemperature)
      expect(temperature.props.minValue).to.be.lessThan(-40)
      server._ccu.fireEvent(DP('ACTUAL_TEMPERATURE'), -12.5)
      expect(temperature.value).to.be(-12.5)
      expect(await read(temperature)).to.be(-12.5)
    })

    it('reports darkness (ILLUMINATION 0) as 0.0001 lx', async () => {
      const level = lightService().getCharacteristic(Characteristic.CurrentAmbientLightLevel)
      server._ccu.fireEvent(DP('ILLUMINATION'), 0)
      expect(level.value).to.be(0.0001)
      expect(await read(level)).to.be(0.0001)
    })

    it('reports ILLUMINATION', async () => {
      const level = lightService().getCharacteristic(Characteristic.CurrentAmbientLightLevel)
      server._ccu.fireEvent(DP('ILLUMINATION'), 15321.3)
      expect(level.value).to.be(15321.3)
      expect(await read(level)).to.be(15321.3)
    })

    it('reports HUMIDITY', async () => {
      const service = (mode === 'Eve') ? temperatureService() : findService(accessory, Service.HumiditySensor)
      const humidity = service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
      server._ccu.fireEvent(DP('HUMIDITY'), 87)
      expect(humidity.value).to.be(87)
      expect(await read(humidity)).to.be(87)
    })

    it('has a battery service fed by LOW_BAT', async () => {
      const battery = findService(accessory, Service.Battery)
      expect(battery).to.be.ok()
      server._ccu.fireEvent('HmIP.' + SWO + ':0.LOW_BAT', true)
      expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
      server._ccu.fireEvent('HmIP.' + SWO + ':0.LOW_BAT', false)
      expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
    })

    if (mode === 'Eve') {
      it('sends wind speed events as numbers', () => {
        const wind = temperatureService().getCharacteristic(accessory.eveWeatherProg.Characteristic.WindSpeed)
        server._ccu.fireEvent(DP('WIND_SPEED'), '23.4')
        expect(wind.value).to.be(23)
      })

      it('reports RAINING', async () => {
        const rain = temperatureService().getCharacteristic(accessory.eveWeatherProg.Characteristic.RainBool)
        server._ccu.fireEvent(DP('RAINING'), true)
        expect(await read(rain)).to.be(true)
      })

      it('reports the rain of today from the CCU system variable', async () => {
        const rain = temperatureService().getCharacteristic(accessory.eveWeatherProg.Characteristic.RainDay)
        server._ccu.setVariable('svHmIPRainCounterToday_' + accessory._ccuChannelId, 3.4)
        // HAP rounds to the 0.1 mm step of RainDay
        expect(Math.abs(await read(rain) - 3.4)).to.be.lessThan(0.001)
      })
    }
  })
}

describeWeatherStation('Eve', {})
describeWeatherStation('Apple Home', { disableHistory: true })
