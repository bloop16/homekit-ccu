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

const testCase = 'HmIP-KRCA.json'

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
          'HmIP.4436784678ABCD:0.LOW_BAT': false,
          'HmIP.4436784678ABCD:0.OPERATING_VOLTAGE': 0
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

  it('HAP-Homematic test low bat', (done) => {
    that.server._ccu.fireEvent('HmIP.4436784678ABCD:0.LOW_BAT', true)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Battery, 'TestDevice', false, '', true)
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
    that.server._ccu.fireEvent('HmIP.4436784678ABCD:0.LOW_BAT', false)
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

  it('HAP-Homematic test voltage reading: one cell at 1.3 V is half full', (done) => {
    that.server._ccu.fireEvent('HmIP.4436784678ABCD:0.OPERATING_VOLTAGE', 1.3)
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
