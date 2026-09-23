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

const testCase = 'HmIP-STH_2.json'

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
        values: {
          'HmIP.4734919797ABCD:1.HUMIDITY': 1
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

  it('HomeKit-CCU check HUMIDITY with random value', (done) => {
    const rnd = Math.floor(Math.random() * Math.floor(100))
    that.server._ccu.fireEvent('HmIP.4734919797ABCD:1.HUMIDITY', rnd)
    const accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    const service = accessory.getService(Service.HumiditySensor)
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
})
