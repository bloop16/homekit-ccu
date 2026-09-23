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

const testCase = 'HmIP-BROLL.json'

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

  it('HomeKit-CCU check LEVEL 0%', (done) => {
    that.server._ccu.fireEvent('HmIP.7877899276ABCD:3.LEVEL', 0)
    that.server._ccu.fireEvent('HmIP.7877899276ABCD:4.LEVEL', 0)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.WindowCovering, 'TestDevice', false, '', true)
    assert.ok(service, 'WindowCovering not found')
    let chCur = service.getCharacteristic(Characteristic.CurrentPosition)
    assert.ok(chCur, 'CurrentPosition Characteristics not found')
    let chTar = service.getCharacteristic(Characteristic.TargetPosition)
    assert.ok(chCur, 'TargetPosition Characteristics not found')
    try {
      expect(chCur.value).to.be(0)
      expect(chTar.value).to.be(0)
      done()
    } catch (e) {
      done(e)
    }
  })

  it('HomeKit-CCU check LEVEL 50%', (done) => {
    that.server._ccu.fireEvent('HmIP.7877899276ABCD:3.LEVEL', 0.5)
    that.server._ccu.fireEvent('HmIP.7877899276ABCD:4.LEVEL', 0.5)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.WindowCovering)
    assert.ok(service, 'WindowCovering not found')
    let chCur = service.getCharacteristic(Characteristic.CurrentPosition)
    assert.ok(chCur, 'CurrentPosition Characteristics not found')
    let chTar = service.getCharacteristic(Characteristic.TargetPosition)
    assert.ok(chCur, 'TargetPosition Characteristics not found')
    try {
      expect(chCur.value).to.be(50)
      expect(chTar.value).to.be(50)
      done()
    } catch (e) {
      done(e)
    }
  })

  it('HomeKit-CCU check LEVEL 100%', (done) => {
    that.server._ccu.fireEvent('HmIP.7877899276ABCD:3.LEVEL', 1)
    that.server._ccu.fireEvent('HmIP.7877899276ABCD:4.LEVEL', 1)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.WindowCovering)
    assert.ok(service, 'WindowCovering not found')
    let chCur = service.getCharacteristic(Characteristic.CurrentPosition)
    assert.ok(chCur, 'CurrentPosition Characteristics not found')
    let chTar = service.getCharacteristic(Characteristic.TargetPosition)
    assert.ok(chCur, 'TargetPosition Characteristics not found')
    try {
      expect(chCur.value).to.be(100)
      expect(chTar.value).to.be(100)
      done()
    } catch (e) {
      done(e)
    }
  })

  it('HomeKit-CCU check getter LEVEL 100%', (done) => {
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.WindowCovering)
    assert.ok(service, 'WindowCovering not found')
    let chCur = service.getCharacteristic(Characteristic.CurrentPosition)
    assert.ok(chCur, 'CurrentPosition Characteristics not found')
    getCharacteristicValue(chCur, (context, value) => {
      try {
        expect(value).to.be(100)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HAP-Homematic set LEVEL 50%', (done) => {
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    accessory.delayOnSet = 10
    let service = accessory.getService(Service.WindowCovering)
    assert.ok(service, 'WindowCovering not found')
    let chTar = service.getCharacteristic(Characteristic.TargetPosition)
    chTar.setValue(50, () => {
      setTimeout(async () => {
        let value = await that.server._ccu.getValue('HmIP.7877899276ABCD:4.LEVEL')
        try {
          expect(value).to.be(0.5)
          done()
        } catch (e) {
          done(e)
        }
      }, 20) // default delay is 750ms
    })
  })

  it('HAP-Homematic set LEVEL 100%', (done) => {
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.WindowCovering)
    assert.ok(service, 'WindowCovering not found')
    let chTar = service.getCharacteristic(Characteristic.TargetPosition)
    chTar.setValue(100, () => {
      setTimeout(async () => {
        let value = await that.server._ccu.getValue('HmIP.7877899276ABCD:4.LEVEL')
        try {
          expect(value).to.be(1)
          done()
        } catch (e) {
          done(e)
        }
      }, 20)
    })
  })
})
