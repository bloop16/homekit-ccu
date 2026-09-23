const assert = require('assert')
const path = require('path')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const expect = require('expect.js')
const EveHomeKitValveTypes = require(path.join(__dirname, '..', 'lib', 'services', 'EveValve.js'))
const { getCharacteristicValue } = require(path.join(__dirname, 'helpers', 'characteristicValue.js'))

const fs = require('fs')
let log = new Logger('HAP Test')
log.setDebugEnabled(false)

const testCase = 'HmIP-FALMOT-C12.json'

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
      values: {
        'HmIP.4664078465ABCD:2.LEVEL': 0
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

  it('HomeKit-CCU check Valve with 50% value', (done) => {
    that.server._ccu.fireEvent('HmIP.4664078465ABCD:2.LEVEL', 0.5)
    let eveValve = new EveHomeKitValveTypes(that.server.gatoHomeBridge.hap)

    let accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
    let service = accessory.getService(eveValve.Service.ValveService, 'TestDevice', false, '', true)
    assert.ok(service, 'ValveService Service not found')
    let ch = service.getCharacteristic(eveValve.Characteristic.CurrentValveState)
    assert.ok(ch, 'CurrentValveState State Characteristics not found')
    getCharacteristicValue(ch, (context, value) => {
      try {
        expect(value).to.be(50)
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})
