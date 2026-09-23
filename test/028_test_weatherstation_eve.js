const assert = require('assert')
const path = require('path')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const Characteristic = require('@homebridge/hap-nodejs').Characteristic
const { getCharacteristicValue } = require(path.join(__dirname, 'helpers', 'characteristicValue.js'))
const expect = require('expect.js')

const fs = require('fs')
let log = new Logger('HAP Test')
log.setDebugEnabled(false)

const testCase = 'HmIP-SWO-B.json'

describe('HomeKit-CCU Tests ' + testCase, () => {
  let that = this

  before(async () => {
    log.debug('preparing tests')
    let datapath = path.join(__dirname, 'devices', testCase)
    let strData = fs.readFileSync(datapath).toString()
    if (strData) {
      that.data = JSON.parse(strData)

      that.server = new Server(log)

      await that.server.simulate(undefined, {config: {
        channels: Object.keys(that.data.ccu)
      },
      devices: that.data.devices})
    } else {
      assert.ok(false, 'Unable to load Test data')
    }
  })

  after(() => {
    Object.keys(that.server._publishedAccessories).map(key => {
      let accessory = that.server._publishedAccessories[key]
      accessory.shutdown()
    })
  })

  it('HomeKit-CCU check test mode', (done) => {
    expect(that.server.isTestMode).to.be(true)
    done()
  })

  it('HomeKit-CCU check number of ccu devices', (done) => {
    expect(that.server._ccu.getCCUDevices().length).to.be(1)
    done()
  })

  it('HomeKit-CCU check number of mappend devices', (done) => {
    expect(Object.keys(that.server._publishedAccessories).length).to.be(1)
    done()
  })

  it('HomeKit-CCU check assigned services', (done) => {
    Object.keys(that.server._publishedAccessories).map(key => {
      let accessory = that.server._publishedAccessories[key]
      expect(accessory.serviceClass).to.be(that.data.ccu[accessory.address()])
    })
    done()
  })

  it('HomeKit-CCU check ACTUAL_TEMPERATURE 10', (done) => {
    that.server._ccu.fireEvent('HmIP.1916894937ABCD:1.ACTUAL_TEMPERATURE', 10.0)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(accessory.eveWeatherProg.Service.EveWeather, 'TestDevice', false, '', true)
    assert.ok(service, 'WeatherStation Service not found')
    let ch = service.getCharacteristic(Characteristic.CurrentTemperature)
    assert.ok(ch, 'CurrentTemperature State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(10)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check HUMIDITY 34', (done) => {
    that.server._ccu.fireEvent('HmIP.1916894937ABCD:1.HUMIDITY', 34.0)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(accessory.eveWeatherProg.Service.EveWeather)
    assert.ok(service, 'WeatherStation Service not found')
    let ch = service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
    assert.ok(ch, 'CurrentRelativeHumidity State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(34)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check ILLUMINATION 140', (done) => {
    that.server._ccu.fireEvent('HmIP.1916894937ABCD:1.ILLUMINATION', 140)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(accessory.eveWeatherProg.Service.EveWeather)
    assert.ok(service, 'WeatherStation Service not found')
    let ch = service.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
    assert.ok(ch, 'CurrentAmbientLightLevel State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(140)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check SUNSHINEDURATION 340 min which are 5.7 hours', (done) => {
    that.server._ccu.setVariable('svHmIPSunshineCounterToday_1002', 340.0)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(accessory.eveWeatherProg.Service.EveWeather)
    assert.ok(service, 'WeatherStation Service not found')
    let ch = service.getCharacteristic(accessory.eveWeatherProg.Characteristic.SunShineDuration)
    assert.ok(ch, 'SunShineDuration State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(5.7)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check WIND_SPEED 98', (done) => {
    that.server._ccu.fireEvent('HmIP.1916894937ABCD:1.WIND_SPEED', 98)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(accessory.eveWeatherProg.Service.EveWeather)
    assert.ok(service, 'WeatherStation Service not found')
    let ch = service.getCharacteristic(accessory.eveWeatherProg.Characteristic.WindSpeed)
    assert.ok(ch, 'WindSpeedCharacteristic State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(98)
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})
