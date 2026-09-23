const assert = require('assert')
const path = require('path')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const Service = require('@homebridge/hap-nodejs').Service
const Characteristic = require('@homebridge/hap-nodejs').Characteristic
const expect = require('expect.js')

const fs = require('fs')
const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const testCase = 'HmIP-MOD-HO.json'

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
        mappings: that.data.mappings
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

  it('HAP-Homematic open the door', (done) => {
    that.server._ccu.fireEvent('HmIP.3123456789ABCD:1.DOOR_STATE', 3)
    that.server._ccu.fireEvent('HmIP.3123456789ABCD:1.PROCESS', 0)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.GarageDoorOpener, 'TestDevice', false, '', true)
    assert.ok(service, 'GarageDoorOpener Service not found')
    const chCur = service.getCharacteristic(Characteristic.CurrentDoorState)
    const chTar = service.getCharacteristic(Characteristic.TargetDoorState)
    assert.ok(chCur, 'CurrentDoorState Characteristics not found')
    assert.ok(chTar, 'TargetDoorState Characteristics not found')
    try {
      expect(chTar.value).to.be(Characteristic.TargetDoorState.OPEN)
      setTimeout(() => {
        expect(chCur.value).to.be(Characteristic.CurrentDoorState.OPEN)
        done()
      }, 110)
    } catch (e) {
      done(e)
    }
  })

  it('HAP-Homematic close the door', (done) => {
    that.server._ccu.fireEvent('HmIP.3123456789ABCD:1.DOOR_STATE', 0)
    that.server._ccu.fireEvent('HmIP.3123456789ABCD:1.PROCESS', 0)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.GarageDoorOpener)
    assert.ok(service, 'GarageDoorOpener Service not found')
    const chCur = service.getCharacteristic(Characteristic.CurrentDoorState)
    const chTar = service.getCharacteristic(Characteristic.TargetDoorState)
    assert.ok(chCur, 'CurrentDoorState Characteristics not found')
    assert.ok(chTar, 'TargetDoorState Characteristics not found')
    try {
      // it takes 100ms so the state should be the previous
      setTimeout(() => {
        expect(chCur.value).to.be(Characteristic.CurrentDoorState.CLOSED)
        // expect(chTar.value).to.be(Characteristic.TargetDoorState.CLOSED) // we have to ignore the target state cause it will be set by homekit
        done()
      }, 110)
    } catch (e) {
      done(e)
    }
  })

  it('HAP-Homematic test hk close the door', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.GarageDoorOpener)
    const chTar = service.getCharacteristic(Characteristic.TargetDoorState)
    chTar.emit('set', Characteristic.TargetDoorState.CLOSED)
    try {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue('HmIP.3123456789ABCD:1.DOOR_COMMAND')
        expect(value).to.be(3)
        done()
      }, 10)
    } catch (e) {
      done(e)
    }
  })

  it('HAP-Homematic test hk open the door', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.GarageDoorOpener)
    const chTar = service.getCharacteristic(Characteristic.TargetDoorState)
    chTar.emit('set', Characteristic.TargetDoorState.OPEN)
    try {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue('HmIP.3123456789ABCD:1.DOOR_COMMAND')
        expect(value).to.be(1)
        done()
      }, 10)
    } catch (e) {
      done(e)
    }
  })

  it('HAP-Homematic test hk ventilation', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Switch)
    const chTar = service.getCharacteristic(Characteristic.On)
    chTar.emit('set', true)
    try {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue('HmIP.3123456789ABCD:1.DOOR_COMMAND')
        expect(value).to.be(4)
        done()
      }, 10)
    } catch (e) {
      done(e)
    }
  })
})
