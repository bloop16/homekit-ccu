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

const testCase = 'HmIP-BSM.json'

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
    that.server._ccu.fireEvent('HmIP.6094613587ABCD:4.STATE', false)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.Outlet, 'TestDevice', false, '', true)
    assert.ok(service, 'Switch Outlet not found')
    let ch = service.getCharacteristic(Characteristic.On)
    assert.ok(ch, 'On Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(false)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('HomeKit-CCU check STATE 1', (done) => {
    that.server._ccu.fireEvent('HmIP.6094613587ABCD:4.STATE', true)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.Outlet)
    let ch = service.getCharacteristic(Characteristic.On)
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(true)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  let rndC = Math.floor(Math.random() * Math.floor(30))
  it('HomeKit-CCU check Measurements CURRENT ' + rndC, (done) => {
    that.server._ccu.fireEvent('HmIP.6094613587ABCD:7.CURRENT', rndC)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.Outlet)
    let ch = service.getCharacteristic(accessory.eve.Characteristic.ElectricCurrent)
    try {
      expect(ch.value).to.be(rndC / 1000) // eve will use ampere homematic millis
      done()
    } catch (e) {
      done(e)
    }
  })

  let rndP = Math.floor(Math.random() * Math.floor(1000))
  it('HomeKit-CCU check Measurements POWER ' + rndP, (done) => {
    that.server._ccu.fireEvent('HmIP.6094613587ABCD:7.POWER', rndP)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.Outlet)
    let ch = service.getCharacteristic(accessory.eve.Characteristic.ElectricPower)
    try {
      expect(ch.value).to.be(rndP)
      done()
    } catch (e) {
      done(e)
    }
  })

  let rndV = Math.floor(Math.random() * Math.floor(1000))
  it('HomeKit-CCU check Measurements Voltage ' + rndV, (done) => {
    that.server._ccu.fireEvent('HmIP.6094613587ABCD:7.VOLTAGE', rndV)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.Outlet)
    let ch = service.getCharacteristic(accessory.eve.Characteristic.Voltage)
    try {
      expect(ch.value).to.be(rndV)
      done()
    } catch (e) {
      done(e)
    }
  })

  let rndF = Math.floor(Math.random() * Math.floor(1000))
  it('HomeKit-CCU check Measurements TotalConsumption ' + rndF, (done) => {
    that.server._ccu.fireEvent('HmIP.6094613587ABCD:7.ENERGY_COUNTER', rndF)
    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(Service.Outlet)
    let ch = service.getCharacteristic(accessory.eve.Characteristic.TotalConsumption)
    try {
      expect(ch.value).to.be(parseFloat((rndF / 1000).toFixed(2))) // ccu uses Wh HomeKit kWh and the service rounds
      done()
    } catch (e) {
      done(e)
    }
  })
})
