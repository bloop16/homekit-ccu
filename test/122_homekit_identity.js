'use strict'

const path = require('path')
const fs = require('fs')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const { homeKitName, bridgeDisplayName } = require(path.join(__dirname, '..', 'lib', 'util', 'homekitName.js'))
const { batteryPercent } = require(path.join(__dirname, '..', 'lib', 'util', 'battery.js'))
const { hapFirmwareRevision } = require(path.join(__dirname, '..', 'lib', 'util', 'firmware.js'))

// the rule HAP-NodeJS and the Home app apply to every Name characteristic
const VALID_HAP_NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{Zs}’'&!._:;()/,-]*[\p{L}\p{N}]$|^[\p{L}\p{N}]$/u

describe('HomeKit-CCU HomeKit names and accessory information', () => {
  describe('homeKitName', () => {
    it('keeps names that are already valid, including umlauts and punctuation', () => {
      expect(homeKitName('Thermostat Küche')).to.be('Thermostat Küche')
      expect(homeKitName('Rollladen 1.OG, links')).to.be('Rollladen 1.OG, links')
      expect(homeKitName("Martin's Lampe")).to.be("Martin's Lampe")
    })

    it('drops a closing bracket at the end together with its opening bracket', () => {
      expect(homeKitName('Bad (OG)')).to.be('Bad OG')
      expect(homeKitName('Licht (Decke) Flur')).to.be('Licht (Decke) Flur')
    })

    it('replaces unsupported characters and trims to letters or digits at both ends', () => {
      expect(homeKitName('#1 Lampe*')).to.be('1 Lampe')
      expect(homeKitName('Garten 🌱 Pumpe')).to.be('Garten Pumpe')
      expect(homeKitName('  --Keller--  ')).to.be('Keller')
      expect(homeKitName('HmIP-eTRV-2 000A1B2C3D4E5F:1')).to.be('HmIP-eTRV-2 000A1B2C3D4E5F:1')
    })

    it('limits names to 64 characters and falls back when nothing is left', () => {
      const long = homeKitName('Ein sehr langer Gerätename '.repeat(5))
      expect(long.length).to.be.lessThan(65)
      expect(VALID_HAP_NAME.test(long)).to.be(true)
      expect(homeKitName('***', 'HomeMatic')).to.be('HomeMatic')
      expect(homeKitName(undefined, 'Fallback')).to.be('Fallback')
    })

    it('always returns a name HAP-NodeJS accepts', () => {
      ['a', 'Bad (OG)', '(x)', "it's'", 'x:y', '__init__', 'Ω', '1'].forEach(input => {
        expect(VALID_HAP_NAME.test(homeKitName(input, 'HomeMatic'))).to.be(true)
      })
    })
  })

  describe('bridgeDisplayName', () => {
    it('names the default bridge after the add-on and others after their instance', () => {
      expect(bridgeDisplayName('default')).to.be('HomeKit-CCU')
      expect(bridgeDisplayName('Wohnzimmer')).to.be('HomeKit-CCU Wohnzimmer')
      expect(bridgeDisplayName('Bad (OG)')).to.be('HomeKit-CCU Bad OG')
      expect(bridgeDisplayName('')).to.be('HomeKit-CCU')
    })
  })

  describe('batteryPercent', () => {
    it('maps the voltage of two cells between empty (2.2 V) and full (3.0 V)', () => {
      expect(batteryPercent(3.0, 2.4)).to.be(100)
      expect(batteryPercent(2.6, 2.4)).to.be(50)
      expect(batteryPercent(2.2, 2.4)).to.be(0)
      expect(batteryPercent(3.3, 2.4)).to.be(100)
      expect(batteryPercent(1.9, 2.4)).to.be(0)
    })

    it('works for single cells and rejects missing values', () => {
      expect(batteryPercent(1.3, 1.2)).to.be(50)
      expect(batteryPercent(undefined, 2.4)).to.be(undefined)
      expect(batteryPercent('abc', 2.4)).to.be(undefined)
      expect(batteryPercent(2.5, 0)).to.be(undefined)
    })
  })

  describe('hapFirmwareRevision', () => {
    it('keeps the numeric x[.y[.z]] part HomeKit accepts', () => {
      expect(hapFirmwareRevision('1.4.8')).to.be('1.4.8')
      expect(hapFirmwareRevision('2.7')).to.be('2.7')
      expect(hapFirmwareRevision('0.1.0-rc.5')).to.be('0.1.0')
      expect(hapFirmwareRevision('V1.2 beta')).to.be('1.2')
      expect(hapFirmwareRevision('1.2.3.4')).to.be('1.2.3')
      expect(hapFirmwareRevision('n/a')).to.be(undefined)
      expect(hapFirmwareRevision(undefined)).to.be(undefined)
    })
  })

  describe('accessory information of a HomeMatic device', () => {
    const that = {}
    const log = new Logger('HAP Test')
    log.setDebugEnabled(false)

    before(async () => {
      that.data = JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', 'HmIP-eTRV-2.json')).toString())
      that.data.devices[0].channels[1].name = 'Thermostat (Bad)'
      that.server = new Server(log)
      await that.server.simulate(undefined, {
        config: { channels: Object.keys(that.data.ccu) },
        devices: that.data.devices,
        values: {
          'HmIP.2123456789ABCD:0.LOW_BAT': false,
          'HmIP.2123456789ABCD:0.OPERATING_VOLTAGE': 2.6
        },
        deviceDescriptions: {
          '2123456789ABCD': { TYPE: 'HmIP-eTRV-2', FIRMWARE: '2.2.8', ADDRESS: '2123456789ABCD' }
        }
      })
      that.accessory = that.server._publishedAccessories[Object.keys(that.server._publishedAccessories)[0]]
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    after(() => {
      Object.values(that.server._publishedAccessories).forEach(accessory => accessory.shutdown())
    })

    const info = (characteristic) => that.accessory.homeKitAccessory
      .getService(Service.AccessoryInformation).getCharacteristic(characteristic).value

    it('reports eQ-3 as manufacturer and the device type as model', () => {
      expect(info(Characteristic.Manufacturer)).to.be('eQ-3')
      expect(info(Characteristic.Model)).to.be('HmIP-eTRV-2')
    })

    it('uses the channel address as serial number, without the host name', () => {
      expect(info(Characteristic.SerialNumber)).to.be('2123456789ABCD:1')
    })

    it('reports the firmware of the device', () => {
      expect(info(Characteristic.FirmwareRevision)).to.be('2.2.8')
    })

    it('uses a valid HomeKit name but keeps the accessory UUID of the raw name', () => {
      expect(info(Characteristic.Name)).to.be('Thermostat Bad')
      const legacyName = 'Thermostat (Bad)'.replace(/[.:#_()]/g, ' ')
      const { uuid } = require('@homebridge/hap-nodejs')
      expect(that.accessory.getUUID()).to.be(uuid.generate('HEATING_CLIMATECONTROL_TRANSCEIVER:' + legacyName))
    })

    it('shows the battery level between empty and full cells', () => {
      const battery = that.accessory.homeKitAccessory.getService(Service.Battery)
      return battery.getCharacteristic(Characteristic.BatteryLevel).handleGetRequest().then(value => {
        expect(value).to.be(50)
      })
    })
  })

  describe('bridge information', () => {
    const bridgeFor = (instanceData) => {
      const log = new Logger('HAP Test')
      log.setDebugEnabled(false)
      const server = new Server(log)
      server.isTestMode = true
      server._configuration = { mappings: {} }
      server.currentPortNum = 9877
      return server.loadInstance('b6589fc6-ab0d-4c82-8f12-099d1c2d40ab', instanceData, [], [], [], [])
    }
    const bridgeInfo = (bridge, characteristic) => bridge.getService(Service.AccessoryInformation).getCharacteristic(characteristic).value

    it('names the default bridge HomeKit-CCU and describes it', () => {
      const bridge = bridgeFor({ name: 'default', user: '12:34:56:AB:CD:EF', pincode: '482-91-736' })
      expect(bridge.displayName).to.be('HomeKit-CCU')
      expect(bridgeInfo(bridge, Characteristic.Name)).to.be('HomeKit-CCU')
      expect(bridgeInfo(bridge, Characteristic.Manufacturer)).to.be('HomeKit-CCU')
      expect(bridgeInfo(bridge, Characteristic.Model)).to.be('OpenCCU Bridge')
      expect(bridgeInfo(bridge, Characteristic.SerialNumber)).to.be('12:34:56:AB:CD:EF')
      expect(bridgeInfo(bridge, Characteristic.FirmwareRevision)).to.match(/^\d+\.\d+\.\d+$/)
    })

    it('names room bridges after their instance', () => {
      const bridge = bridgeFor({ name: 'Wohnzimmer', user: '12:34:56:AB:CD:E0', pincode: '482-91-736' })
      expect(bridge.displayName).to.be('HomeKit-CCU Wohnzimmer')
    })
  })
})
