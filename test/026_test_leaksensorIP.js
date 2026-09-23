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

const testCase = 'HmIP-SWD.json'

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

  it('HomeKit-CCU check STATE 0', (done) => {
    that.server._ccu.fireEvent('HmIP.5704833150ABCD:1.WATERLEVEL_DETECTED', false)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.LeakSensor, 'TestDevice', false, '', true)
    assert.ok(service, 'LeakSensor Service not found')
    let ch = service.getCharacteristic(Characteristic.LeakDetected)
    assert.ok(ch, 'LeakDetected State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(0)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check STATE 1', (done) => {
    that.server._ccu.fireEvent('HmIP.5704833150ABCD:1.WATERLEVEL_DETECTED', true)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.LeakSensor)
    let ch = service.getCharacteristic(Characteristic.LeakDetected)
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(1)
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})
