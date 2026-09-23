const assert = require('assert')
const path = require('path')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const Service = require('@homebridge/hap-nodejs').Service
const Characteristic = require('@homebridge/hap-nodejs').Characteristic
const expect = require('expect.js')

const fs = require('fs')
const log = new Logger('HAP Test')
log.setDebugEnabled()

const testCase = 'HM-Sec-Sir-WM.json'

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
    Object.keys(that.server._publishedAccessories).map(key => {
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
    Object.keys(that.server._publishedAccessories).map(key => {
      const accessory = that.server._publishedAccessories[key]
      expect(accessory.serviceClass).to.be(that.data.ccu[accessory.address()])
    })
    done()
  })

  it('HomeKit-CCU check ARMSTATE 0', (done) => {
    that.server._ccu.fireEvent('BidCos-RF.5820259065ABCD:4.ARMSTATE', 0)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.SecuritySystem, 'TestDevice', false, '', true)
    assert.ok(service, 'SecuritySystem Service not found')
    const chCur = service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
    const chTar = service.getCharacteristic(Characteristic.SecuritySystemTargetState)
    assert.ok(chCur, 'SecuritySystemCurrentState Characteristics not found')
    assert.ok(chTar, 'SecuritySystemTargetState Characteristics not found')
    try {
      expect(chTar.value).to.be(Characteristic.SecuritySystemTargetState.STAY_ARM)
      expect(chCur.value).to.be(Characteristic.SecuritySystemCurrentState.STAY_ARM)
      done()
    } catch (e) {
      done(e)
    }
  })

  it('HomeKit-CCU check ARMSTATE 1', (done) => {
    that.server._ccu.fireEvent('BidCos-RF.5820259065ABCD:4.ARMSTATE', 1)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.SecuritySystem)
    const chCur = service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
    const chTar = service.getCharacteristic(Characteristic.SecuritySystemTargetState)
    try {
      expect(chTar.value).to.be(Characteristic.SecuritySystemTargetState.NIGHT_ARM)
      expect(chCur.value).to.be(Characteristic.SecuritySystemCurrentState.STAY_ARM) // we have to wait 100ms
      setTimeout(() => {
        expect(chCur.value).to.be(Characteristic.SecuritySystemCurrentState.NIGHT_ARM)
        done()
      }, 110)
    } catch (e) {
      done(e)
    }
  })

  it('HomeKit-CCU check ARMSTATE 2', (done) => {
    that.server._ccu.fireEvent('BidCos-RF.5820259065ABCD:4.ARMSTATE', 2)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.SecuritySystem)
    const chCur = service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
    const chTar = service.getCharacteristic(Characteristic.SecuritySystemTargetState)
    try {
      expect(chTar.value).to.be(Characteristic.SecuritySystemTargetState.AWAY_ARM)
      expect(chCur.value).to.be(Characteristic.SecuritySystemCurrentState.NIGHT_ARM) // we have to wait 100ms
      setTimeout(() => {
        expect(chCur.value).to.be(Characteristic.SecuritySystemCurrentState.AWAY_ARM)
        done()
      }, 110)
    } catch (e) {
      done(e)
    }
  })

  it('HomeKit-CCU check ARMSTATE 3', (done) => {
    that.server._ccu.fireEvent('BidCos-RF.5820259065ABCD:4.ARMSTATE', 3)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.SecuritySystem)
    const chCur = service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
    const chTar = service.getCharacteristic(Characteristic.SecuritySystemTargetState)
    try {
      expect(chTar.value).to.be(Characteristic.SecuritySystemTargetState.DISARM)
      expect(chCur.value).to.be(Characteristic.SecuritySystemCurrentState.AWAY_ARM) // we have to wait 100ms
      setTimeout(() => {
        expect(chCur.value).to.be(Characteristic.SecuritySystemCurrentState.DISARMED)
        done()
      }, 110)
    } catch (e) {
      done(e)
    }
  })

  it('HomeKit-CCU check alarm goes off', (done) => {
    that.server._ccu.fireEvent('BidCos-RF.5820259065ABCD:3.STATE', true)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.SecuritySystem)
    const ch = service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
    try {
      expect(ch.value).to.be(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED)
      done()
    } catch (e) {
      done(e)
    }
  })

  it('HomeKit-CCU check HomeKit Switch Alarm Off', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.SecuritySystem)
    const ch = service.getCharacteristic(Characteristic.SecuritySystemTargetState)
    ch.emit('set', Characteristic.SecuritySystemTargetState.DISARM, async () => {
      const value = await that.server._ccu.getValue('BidCos-RF.5820259065ABCD:4.ARMSTATE')
      try {
        expect(parseInt(value)).to.be(3)
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})
