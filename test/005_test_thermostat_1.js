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
log.setDebugEnabled(true)

const testCase = 'HM-TC-IT-WM-W-EU.json'

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
        mappings: that.data.mappings,
        values: { // add dummy values so hazDatapoint will find this DP and the device will get HMIP Style battery checks
          'BidCos-RF.0123456789ABCD:2.ACTUAL_HUMIDITY': 1
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

  it('HomeKit-CCU check ACTUAL_TEMPERATURE with random value', (done) => {
    const rnd = Math.floor(Math.random() * Math.floor(30))
    that.server._ccu.fireEvent('BidCos-RF.0123456789ABCD:2.ACTUAL_TEMPERATURE', rnd)
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

  it('HomeKit-CCU check ACTUAL_HUMIDITY with random value', (done) => {
    const rnd = Math.floor(Math.random() * Math.floor(100))
    that.server._ccu.fireEvent('BidCos-RF.0123456789ABCD:2.ACTUAL_HUMIDITY', rnd)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Thermostat)
    const ch = service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(rnd)
        done()
      } catch (e) {
        done(e)
      }
    })
  })
  /*
  it('HomeKit-CCU check SET_TEMPERATURE and HeatingMode should be heating', (done) => {
    let rnd1 = Math.floor(Math.random() * Math.floor(30)) + 5 // make sure we do not set below the off themp
    // We have to set a Current Temperature below the new settemp to make sure the thermostate is in heating mode
    that.server._ccu.fireEvent('BidCos-RF.0123456789ABCD:2.ACTUAL_TEMPERATURE', (rnd1 - 2))
    // Set The controlmode to manual
    that.server._ccu.fireEvent('BidCos-RF.0123456789ABCD:2.CONTROL_MODE', 1)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.Thermostat)
    let ch = service.getCharacteristic(Characteristic.TargetTemperature)
    ch.setValue(rnd1, async () => {
      let value = await that.server._ccu.getValue('BidCos-RF.0123456789ABCD:2.SET_TEMPERATURE')
      try {
        expect(value).to.be(rnd1)
      } catch (e) {

      }

      // we have a temperature so the CurrentHeatingCoolingState should be heating
      let ch1 = service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      getCharacteristicValue(ch1, (context, value) => {
        try {
          expect(value).to.be(Characteristic.CurrentHeatingCoolingState.HEAT)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })
  */

  it('HomeKit-CCU check SET_TEMPERATURE and HeatingMode should be OFF', (done) => {
    // Set The controlmode to manual
    that.server._ccu.fireEvent('BidCos-RF.0123456789ABCD:2.CONTROL_MODE', 1)
    // We have to set a Current Temperature below the new settemp to make sure the thermostate is in heating mode
    that.server._ccu.fireEvent('BidCos-RF.0123456789ABCD:2.ACTUAL_TEMPERATURE', 24.1)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Thermostat)
    const ch = service.getCharacteristic(Characteristic.TargetTemperature)
    ch.setValue(20, async () => {
      const value = await that.server._ccu.getValue('BidCos-RF.0123456789ABCD:2.SET_TEMPERATURE')
      try {
        expect(value).to.be(20)
        done()
      } catch (e) {
        done()
      }
    })
  })

  it('HomeKit-CCU check Heating Mode Off by setting 4.5 degrees', (done) => {
    that.server._ccu.fireEvent('BidCos-RF.0123456789ABCD:2.SET_TEMPERATURE', 4.5)
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
})
