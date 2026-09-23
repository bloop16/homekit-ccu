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

const testCase = 'HmIP-BSL.json'
const levelDP = 'HmIP.7068778492ABCD:8.LEVEL'
const colorDP = 'HmIP.7068778492ABCD:8.COLOR'

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

        }
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

  it('HomeKit-CCU check LEVEL 0', (done) => {
    that.server._ccu.fireEvent(levelDP, 0)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Lightbulb, 'TestDevice', false, '', true)
    assert.ok(service, 'Lightbulb Service not found')
    const ch = service.getCharacteristic(Characteristic.Brightness)
    assert.ok(ch, 'Brightness Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(0)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check LEVEL 100', (done) => {
    that.server._ccu.fireEvent(levelDP, 1)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Lightbulb)
    assert.ok(service, 'Lightbulb Service not found')
    const ch = service.getCharacteristic(Characteristic.Brightness)
    assert.ok(ch, 'Brightness Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(100)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check LEVEL 50%', (done) => {
    that.server._ccu.fireEvent(levelDP, 0.5)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Lightbulb)
    assert.ok(service, 'Lightbulb Service not found')
    const ch = service.getCharacteristic(Characteristic.Brightness)
    assert.ok(ch, 'Brightness Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(50)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HAP-Homematic set LEVEL 25%', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    accessory.delayOnSet = 10
    const service = accessory.getService(Service.Lightbulb)
    assert.ok(service, 'Lightbulb not found')
    const chTar = service.getCharacteristic(Characteristic.Brightness)
    chTar.setValue(25, () => {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue(levelDP)
        try {
          expect(value).to.be(0.25)
          done()
        } catch (e) {
          done(e)
        }
      }, 15) // default delay is 500ms
    })
  })

  it('HAP-Homematic set LEVEL 100%', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    accessory.delayOnSet = 10
    const service = accessory.getService(Service.Lightbulb)
    assert.ok(service, 'Lightbulb not found')
    const chTar = service.getCharacteristic(Characteristic.Brightness)
    chTar.setValue(100, () => {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue(levelDP)
        try {
          expect(value).to.be(1)
          done()
        } catch (e) {
          done(e)
        }
      }, 15) // default delay is 500ms
    })
  })

  it('HAP-Homematic set LEVEL 0%', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    accessory.delayOnSet = 10
    const service = accessory.getService(Service.Lightbulb)
    assert.ok(service, 'Lightbulb not found')
    const chTar = service.getCharacteristic(Characteristic.Brightness)
    chTar.setValue(0, () => {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue(levelDP)
        try {
          expect(value).to.be(0)
          done()
        } catch (e) {
          done(e)
        }
      }, 15) // default delay is 500ms
    })
  })

  it('HAP-Homematic set HK COLOR Blue', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    accessory.delayOnSet = 10
    const service = accessory.getService(Service.Lightbulb)
    assert.ok(service, 'Lightbulb not found')
    const chTar = service.getCharacteristic(Characteristic.Hue)
    chTar.setValue(241, () => {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue(colorDP)
        try {
          expect(value).to.be(1)
          done()
        } catch (e) {
          done(e)
        }
      }, 15) // default delay is 500ms
    })
  })

  it('HAP-Homematic set HK COLOR REDish', (done) => {
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    accessory.delayOnSet = 10
    const service = accessory.getService(Service.Lightbulb)
    assert.ok(service, 'Lightbulb not found')
    const chTar = service.getCharacteristic(Characteristic.Hue)
    chTar.setValue(10, () => {
      setTimeout(async () => {
        const value = await that.server._ccu.getValue(colorDP)
        try {
          expect(value).to.be(4) // this is the 4th color
          done()
        } catch (e) {
          done(e)
        }
      }, 15) // default delay is 500ms
    })
  })

  it('HomeKit-CCU check HK Color for CCU Purple', (done) => {
    that.server._ccu.fireEvent(colorDP, 5)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Lightbulb)
    assert.ok(service, 'Lightbulb Service not found')
    const ch = service.getCharacteristic(Characteristic.Hue)
    assert.ok(ch, 'Hue Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(308)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check HK Color for CCU White', (done) => {
    that.server._ccu.fireEvent(colorDP, 7)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.Lightbulb)
    assert.ok(service, 'Lightbulb Service not found')
    const ch = service.getCharacteristic(Characteristic.Saturation)
    assert.ok(ch, 'Sat Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(0)
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})
