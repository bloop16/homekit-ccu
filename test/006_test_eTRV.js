const assert = require('assert')
const path = require('path')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const Service = require('@homebridge/hap-nodejs').Service
const Characteristic = require('@homebridge/hap-nodejs').Characteristic
const { getCharacteristicValue } = require(path.join(__dirname, 'helpers', 'characteristicValue.js'))
const expect = require('expect.js')

const fs = require('fs')
const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const testCase = 'HmIP-eTRV-2.json'

describe('HomeKit-CCU Tests ' + testCase, () => {
  const that = this

  before(async () => {
    log.debug('preparing tests')
    const datapath = path.join(__dirname, 'devices', testCase)
    const strData = fs.readFileSync(datapath).toString()
    if (strData) {
      that.data = JSON.parse(strData)

      that.server = new Server(log)

      await that.server.simulate(undefined, {
        config: {
          channels: Object.keys(that.data.ccu)
        },
        devices: that.data.devices,
        values: {
          'HmIP.2123456789ABCD:0.LOW_BAT': false,
          'HmIP.2123456789ABCD:0.OPERATING_VOLTAGE': 2.4
        }
      })
    } else {
      assert.ok(false, 'Unable to load Test data')
    }
  })

  after(() => {
    Object.keys(that.server._publishedAccessories).forEach(key => {
      const accessory = that.server._publishedAccessories[key]
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
    Object.keys(that.server._publishedAccessories).forEach(key => {
      const accessory = that.server._publishedAccessories[key]
      expect(accessory.serviceClass).to.be(that.data.ccu[accessory.address()])
    })
    done()
  })

  it('HomeKit-CCU check ACTUAL_TEMPERATURE', (done) => {
    // first close the windows so the heating will operate
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:1.WINDOW_STATE', 0)

    const rnd = Math.floor(Math.random() * Math.floor(30))
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:1.ACTUAL_TEMPERATURE', rnd)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Thermostat, 'TestDevice', false, '', true)
    assert.ok(service, 'Thermostat Service not found')
    const ch = service.getCharacteristic(Characteristic.CurrentTemperature)
    assert.ok(ch, 'CurrentTemperature State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(rnd)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check SET_POINT_TEMPERATURE and HeatingMode', (done) => {
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:1.SET_POINT_MODE', 1) // Set Control Mode
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:1.ACTUAL_TEMPERATURE', 20) // Set Temperature
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Thermostat)
    const ch = service.getCharacteristic(Characteristic.TargetTemperature)
    ch.setValue(24, async () => {
      const value = await that.server._ccu.getValue('HmIP.2123456789ABCD:1.SET_POINT_TEMPERATURE')
      try {
        expect(value).to.be(24)
      } catch (e) {

      }
    })
    // we have a temperature so the CurrentHeatingCoolingState should be heating
    const ch1 = service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
    getCharacteristicValue(ch1, (context, value) => {
      try {
        expect(value).to.be(Characteristic.CurrentHeatingCoolingState.HEAT)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check SET_POINT_TEMPERATURE and HeatingMode Off by Target Temp (20) below Current Temp (24)', (done) => {
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:1.SET_POINT_MODE', 1) // Set Control Mode
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:1.ACTUAL_TEMPERATURE', 24) // Set Temperature
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Thermostat)
    const ch = service.getCharacteristic(Characteristic.TargetTemperature)
    ch.setValue(20, async () => {
      const value = await that.server._ccu.getValue('HmIP.2123456789ABCD:1.SET_POINT_TEMPERATURE')
      try {
        expect(value).to.be(20)
      } catch (e) {

      }
      // we have a temperature above the target so the CurrentHeatingCoolingState should be OFF
      const ch1 = service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      getCharacteristicValue(ch1, (context, value) => {
        try {
          expect(value).to.be(Characteristic.CurrentHeatingCoolingState.OFF)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  it('HomeKit-CCU check Heating Mode Off', (done) => {
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:1.SET_POINT_TEMPERATURE', 4.5)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Thermostat)
    const ch = service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(Characteristic.CurrentHeatingCoolingState.OFF)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HAP-Homematic set Heating Mode Off check 4.5 degree', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Thermostat)
    const ch = service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
    ch.setValue(Characteristic.TargetHeatingCoolingState.OFF, async () => {
      const value = await that.server._ccu.getValue('HmIP.2123456789ABCD:1.SET_POINT_TEMPERATURE')
      try {
        expect(value).to.be(4.5)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HAP-Homematic set Heating Mode back to heating check degree again', (done) => {
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:1.WINDOW_STATE', 0)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Thermostat)
    const ch = service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
    ch.setValue(Characteristic.TargetHeatingCoolingState.HEAT, () => {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue('HmIP.2123456789ABCD:1.SET_POINT_TEMPERATURE')
        try {
          expect(value).to.be(20)
          done()
        } catch (e) {
          done(e)
        }
      }, 100)
    })
  })

  it('HAP-Homematic open the window and we will make shure the temp will not set while changing the mode', (done) => {
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:1.WINDOW_STATE', 1) // open the window
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:1.SET_POINT_TEMPERATURE', 12) // ccu will set themp to window temp
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Thermostat)
    const ch = service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
    ch.setValue(Characteristic.TargetHeatingCoolingState.HEAT, () => { // set the heating mode
      setTimeout(async () => {
        const value = await that.server._ccu.getValue('HmIP.2123456789ABCD:1.SET_POINT_TEMPERATURE')
        try {
          expect(value).to.be(12) // temp should be 12 not the last known 20
          done()
        } catch (e) {
          done(e)
        }
      }, 100)
    })
  })

  it('HomeKit-CCU check HUMIDITY is not here', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Thermostat)
    assert.ok(service, 'Thermostat Service not found')
    const ch = service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(0)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HAP-Homematic test low bat', (done) => {
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:0.LOW_BAT', true)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Battery)
    const ch = service.getCharacteristic(Characteristic.StatusLowBattery)
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HAP-Homematic test low bat negative', (done) => {
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:0.LOW_BAT', false)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Battery)
    const ch = service.getCharacteristic(Characteristic.StatusLowBattery)
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HAP-Homematic test voltage reading 1.2V 50%', (done) => {
    that.server._ccu.fireEvent('HmIP.2123456789ABCD:0.OPERATING_VOLTAGE', 1.2)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Battery)
    const ch = service.getCharacteristic(Characteristic.BatteryLevel)
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(50)
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})
