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

const testCase = 'HmIP-DLD.json'

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
        devices: that.data.devices
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

  it('HomeKit-CCU check LOCK_STATE 0 (unknown) Cur sould be UNKNOWN', (done) => {
    that.server._ccu.fireEvent('HmIP.7316163726ABCD:1.LOCK_STATE', 0)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.LockMechanism, 'TestDevice', false, '', true)
    assert.ok(service, 'LockMechanism Service not found')
    const ch = service.getCharacteristic(Characteristic.LockCurrentState)
    assert.ok(ch, 'LockCurrentState State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(Characteristic.LockCurrentState.UNKNOWN)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check LOCK_STATE 1 Cur sould be LOCKED', (done) => {
    that.server._ccu.fireEvent('HmIP.7316163726ABCD:1.LOCK_STATE', 1)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.LockMechanism, 'TestDevice', false, '', true)
    assert.ok(service, 'LockMechanism Service not found')
    const ch = service.getCharacteristic(Characteristic.LockCurrentState)
    assert.ok(ch, 'LockCurrentState State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(Characteristic.LockCurrentState.SECURED)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check LOCK_STATE 2 Cur sould be UNSECURED', (done) => {
    that.server._ccu.fireEvent('HmIP.7316163726ABCD:1.LOCK_STATE', 2)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.LockMechanism, 'TestDevice', false, '', true)
    assert.ok(service, 'LockMechanism Service not found')
    const ch = service.getCharacteristic(Characteristic.LockCurrentState)
    assert.ok(ch, 'LockCurrentState State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(Characteristic.LockCurrentState.UNSECURED)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HAP-Homematic set LockTargetState to SECURED (-> 0 LOCKED)', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.LockMechanism)
    assert.ok(service, 'LockMechanism not found')
    const chTar = service.getCharacteristic(Characteristic.LockTargetState)
    chTar.setValue(Characteristic.LockTargetState.SECURED, () => {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue('HmIP.7316163726ABCD:1.LOCK_TARGET_LEVEL')
        try {
          expect(value).to.be(0)
          done()
        } catch (e) {
          done(e)
        }
      }, 15) // default delay is 500ms
    })
  })

  it('HAP-Homematic set LockTargetState to UNSECURED (-> 1 LOCKED)', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.LockMechanism)
    assert.ok(service, 'LockMechanism not found')
    const chTar = service.getCharacteristic(Characteristic.LockTargetState)
    chTar.setValue(Characteristic.LockTargetState.UNSECURED, () => {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue('HmIP.7316163726ABCD:1.LOCK_TARGET_LEVEL')
        try {
          expect(value).to.be(1)
          done()
        } catch (e) {
          done(e)
        }
      }, 15) // default delay is 500ms
    })
  })
})
