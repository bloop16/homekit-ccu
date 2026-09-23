const assert = require('assert')
const path = require('path')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const Service = require('@homebridge/hap-nodejs').Service
const Characteristic = require('@homebridge/hap-nodejs').Characteristic
const expect = require('expect.js')

const fs = require('fs')
let log = new Logger('HAP Test')
log.setDebugEnabled(false)

const testCase = 'HmIP-SWDO-I.json'

describe('HomeKit-CCU Tests ' + testCase + ' as a Window', () => {
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
      mappings: that.data.mappings
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

  it('HomeKit-CCU check STATE 0', (done) => {
    that.server._ccu.fireEvent('HmIP.5962284199ABCD:1.STATE', false)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.Window, 'TestDevice', false, '', true)
    assert.ok(service, 'Window Service not found')
    let chTar = service.getCharacteristic(Characteristic.TargetPosition)
    let chCur = service.getCharacteristic(Characteristic.CurrentPosition)
    assert.ok(chTar, 'Window  TargetPosition not found')
    assert.ok(chCur, 'Window  CurrentPosition not found')
    try {
      expect(chTar.value).to.be(0)
      expect(chCur.value).to.be(0)
      done()
    } catch (e) {
      done(e)
    }
  })

  it('HomeKit-CCU check STATE 1', (done) => {
    that.server._ccu.fireEvent('HmIP.5962284199ABCD:1.STATE', true)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.Window)
    let chTar = service.getCharacteristic(Characteristic.TargetPosition)
    let chCur = service.getCharacteristic(Characteristic.CurrentPosition)
    try {
      expect(chTar.value).to.be(100)
      // expect 0 cause CurrentPosition will be set delayed by 100ms
      expect(chCur.value).to.be(0)
      // we have to wait > 100ms
      setTimeout(() => {
        expect(chCur.value).to.be(100)
        done()
      }, 110)
    } catch (e) {
      done(e)
    }
  })
})
