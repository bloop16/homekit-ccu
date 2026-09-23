const assert = require('assert')
const path = require('path')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const Service = require('@homebridge/hap-nodejs').Service
const Characteristic = require('@homebridge/hap-nodejs').Characteristic
const { getCharacteristicValue } = require(path.join(__dirname, 'helpers', 'characteristicValue.js'))
const expect = require('expect.js')

const fs = require('fs')
let log = new Logger('HAP Test')
log.setDebugEnabled(false)

const testCase = 'HMW-Sen-SC-12-DR.json'

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
      devices: that.data.devices,
      mappings: that.data.mappings,
      values: { // add dummy values so hazDatapoint will find this DP and the device will get HMIP Style battery checks

      }
      })
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

  it('HomeKit-CCU check SENSOR 0', (done) => {
    that.server._ccu.fireEvent('BidCos-Wired.7348266248ABCD:1.SENSOR', false)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.ContactSensor, 'TestDevice', false, '', true)
    assert.ok(service, 'Contact Service not found')
    let ch = service.getCharacteristic(Characteristic.ContactSensorState)
    assert.ok(ch, 'Contact State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(0)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check SENSOR 1', (done) => {
    that.server._ccu.fireEvent('BidCos-Wired.7348266248ABCD:1.SENSOR', true)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.ContactSensor)
    let ch = service.getCharacteristic(Characteristic.ContactSensorState)
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(1)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check SENSOR back to 0', (done) => {
    that.server._ccu.fireEvent('BidCos-Wired.7348266248ABCD:1.SENSOR', false)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.ContactSensor)
    assert.ok(service, 'Contact Service not found')
    let ch = service.getCharacteristic(Characteristic.ContactSensorState)
    assert.ok(ch, 'Contact State Characteristics not found')
    expect(ch.value).to.be(0)
    done()
  })
})
