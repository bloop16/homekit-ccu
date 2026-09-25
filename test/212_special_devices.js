'use strict'

// Special devices on an OpenCCU with HmIP devices only, running as a virtual machine:
// - "CCU Duty Cycle" showed nothing: only BidCos-RF was asked, which has no connection without
//   BidCos devices; the CCU itself asks HmIP-RF then (/bin/updateDCVars.tcl). A duty cycle of
//   0 % (an idle radio) was never shown either.
// - "CCU Temperature" showed nothing: a virtual machine has no /sys/class/thermal (the CCU's
//   own system page shows "n/a" there), and the missing value was answered as NaN.
// - the HTTP switch and the battery indicator were removed; stored ones are dropped once.

const path = require('path')
const os = require('os')
const fs = require('fs')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const HomeMaticCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticCCU.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const { findTemperatureSource, readTemperature } = require(path.join(__dirname, '..', 'lib', 'util', 'cpuTemperature.js'))
const { REMOVED_SERVICES, removeRemovedServices } = require(path.join(__dirname, '..', 'lib', 'util', 'serviceMigration.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))
const { simulateDevice, read, findService, settle } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

const SERVICES_DIR = path.join(__dirname, '..', 'lib', 'services')

function ccuWithInterfaces (interfaces, answers) {
  const ccu = new HomeMaticCCU(recordingLog(), { storagePath: '/tmp' })
  ccu.interfaces = {}
  interfaces.forEach(([name, inUse], index) => { ccu.interfaces[1000 + index] = { id: 1000 + index, name, inUse } })
  ccu.asked = []
  ccu.sendInterfaceCommand = (name, command) => {
    ccu.asked.push(name + ' ' + command)
    const answer = answers[name]
    return (answer instanceof Error) ? Promise.reject(answer) : Promise.resolve(answer)
  }
  return ccu
}

describe('HomeKit-CCU special devices', () => {
  describe('duty cycle', () => {
    it('asks HmIP-RF when there are no BidCos-RF devices', async () => {
      const ccu = ccuWithInterfaces([['BidCos-RF', false], ['HmIP-RF', true]], {
        'HmIP-RF': [{ ADDRESS: '3014F711A0000418971558', TYPE: 'HMIP_CCU2', DUTY_CYCLE: 3, CONNECTED: true }]
      })
      expect(await ccu.getCCUDutyCycle()).to.eql({ '3014F711A0000418971558': 3 })
      expect(ccu.asked).to.eql(['HmIP-RF listBidcosInterfaces'])
      expect(await ccu.getCCUDutyCycle(true)).to.eql({ '3014F711A0000418971558': 3 })
    })

    it('lists the radio modules of BidCos-RF and HmIP-RF', async () => {
      const ccu = ccuWithInterfaces([['BidCos-RF', true], ['HmIP-RF', true]], {
        'BidCos-RF': [{ ADDRESS: 'NEQ1234567', TYPE: 'CCU2', DUTY_CYCLE: 12 }],
        'HmIP-RF': [{ ADDRESS: '3014F711A0000418971558', TYPE: 'HMIP_CCU2', DUTY_CYCLE: 0 }]
      })
      expect(await ccu.getCCUDutyCycle()).to.eql({ NEQ1234567: 12, '3014F711A0000418971558': 0 })
    })

    it('keeps the modules of one interface when the other one fails', async () => {
      const ccu = ccuWithInterfaces([['BidCos-RF', true], ['HmIP-RF', true]], {
        'BidCos-RF': new Error('interface BidCos-RF is not connected'),
        'HmIP-RF': [{ ADDRESS: '3014F711A0000418971558', DUTY_CYCLE: 5 }]
      })
      expect(await ccu.getCCUDutyCycle()).to.eql({ '3014F711A0000418971558': 5 })
      expect(ccu.log.text('warn')).to.contain('BidCos-RF')
    })

    it('shows a duty cycle of 0 %', async () => {
      const sim = await simulateDevice({
        type: 'HmIP-SWDO',
        address: '0001D3C99CF001',
        channels: ['MAINTENANCE', 'SHUTTER_CONTACT_TRANSCEIVER'],
        channel: 1,
        service: 'HomeMaticContactSensorAccessory'
      })
      try {
        let dutyCycle = 7
        sim.server._ccu.getCCUDutyCycle = async () => ({ 3014: dutyCycle })
        const Appliance = require(path.join(SERVICES_DIR, 'HomeMaticSPCCUDutyCycleAccessory.js'))
        const accessory = new Appliance({ name: 'Duty cycle', address: 'SPECDC:0' }, 'Special', sim.server, { Service: 'HomeMaticSPCCUDutyCycleAccessory', settings: { dcAddress: '3014' } })
        accessory.init()
        const level = findService(accessory, Service.HumiditySensor).getCharacteristic(Characteristic.CurrentRelativeHumidity)
        await accessory.updateDC()
        expect(level.value).to.be(7)
        dutyCycle = 0
        await accessory.updateDC()
        expect(level.value).to.be(0)
        expect(await read(level)).to.be(0)
        accessory.shutdown()
      } finally {
        sim.shutdown()
      }
    })
  })

  describe('CCU temperature', () => {
    let root
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-212-')) })
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

    const sysfile = (relative, content) => {
      const file = path.join(root, relative)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
    }

    it('reads the thermal zone of a Raspberry Pi based CCU', () => {
      sysfile('class/thermal/thermal_zone0/type', 'cpu-thermal\n')
      sysfile('class/thermal/thermal_zone0/temp', '48312\n')
      const source = findTemperatureSource(root)
      expect(source).to.be(path.join(root, 'class/thermal/thermal_zone0/temp'))
      expect(readTemperature(source)).to.be(48.3)
    })

    it('prefers the CPU zone over other zones', () => {
      sysfile('class/thermal/thermal_zone0/type', 'acpitz\n')
      sysfile('class/thermal/thermal_zone0/temp', '27800\n')
      sysfile('class/thermal/thermal_zone1/type', 'x86_pkg_temp\n')
      sysfile('class/thermal/thermal_zone1/temp', '41000\n')
      expect(findTemperatureSource(root)).to.be(path.join(root, 'class/thermal/thermal_zone1/temp'))
    })

    it('falls back to the coretemp sensor of x86 hardware', () => {
      sysfile('class/hwmon/hwmon0/name', 'nvme\n')
      sysfile('class/hwmon/hwmon0/temp1_input', '35000\n')
      sysfile('class/hwmon/hwmon1/name', 'coretemp\n')
      sysfile('class/hwmon/hwmon1/temp1_input', '52000\n')
      expect(findTemperatureSource(root)).to.be(path.join(root, 'class/hwmon/hwmon1/temp1_input'))
    })

    it('finds nothing in a virtual machine', () => {
      fs.mkdirSync(path.join(root, 'class/thermal'), { recursive: true })
      expect(findTemperatureSource(root)).to.be(undefined)
      expect(readTemperature(undefined)).to.be(undefined)
      expect(readTemperature(path.join(root, 'missing'))).to.be(undefined)
    })

    it('is only offered when the system has a temperature', () => {
      const Temp = require(path.join(SERVICES_DIR, 'HomeMaticSPCCUTempAccessory.js'))
      const saved = Temp.sysfsRoot
      try {
        Temp.sysfsRoot = root
        expect(Temp.isAvailable()).to.be(false)
        sysfile('class/thermal/thermal_zone0/temp', '48312\n')
        expect(Temp.isAvailable()).to.be(true)
      } finally {
        Temp.sysfsRoot = saved
      }
    })

    it('is left out of the service list of the server on a system without temperature', async () => {
      const Temp = require(path.join(SERVICES_DIR, 'HomeMaticSPCCUTempAccessory.js'))
      const saved = Temp.sysfsRoot
      const log = recordingLog()
      log.setDebugEnabled = () => {}
      const server = new Server(log)
      server._ccu = { getCCUDutyCycle: async () => ({}) }
      try {
        Temp.sysfsRoot = root
        const special = () => (server._serviceList.SPECIAL || []).map(item => item.serviceClazz)
        server._serviceList = await server.buildServiceList()
        expect(special()).not.to.contain('HomeMaticSPCCUTempAccessory')
        expect(special()).to.contain('HomeMaticSPCCUDutyCycleAccessory')
        sysfile('class/thermal/thermal_zone0/temp', '48312\n')
        server._serviceList = await server.buildServiceList()
        expect(special()).to.contain('HomeMaticSPCCUTempAccessory')
      } finally {
        Temp.sysfsRoot = saved
      }
    })

    it('answers a read without temperature with "No Response" instead of NaN', async () => {
      const Temp = require(path.join(SERVICES_DIR, 'HomeMaticSPCCUTempAccessory.js'))
      const saved = Temp.sysfsRoot
      const sim = await simulateDevice({
        type: 'HmIP-SWDO',
        address: '0001D3C99CF001',
        channels: ['MAINTENANCE', 'SHUTTER_CONTACT_TRANSCEIVER'],
        channel: 1,
        service: 'HomeMaticContactSensorAccessory'
      })
      try {
        Temp.sysfsRoot = root
        const accessory = new Temp({ name: 'CCU', address: 'SPECTEMP:0' }, 'Special', sim.server, { Service: 'HomeMaticSPCCUTempAccessory', settings: {} })
        accessory.init()
        await settle()
        const temperature = findService(accessory, Service.TemperatureSensor).getCharacteristic(Characteristic.CurrentTemperature)
        let status
        await read(temperature).catch(error => { status = error })
        expect(status).to.be(-70402)

        sysfile('class/thermal/thermal_zone0/temp', '48312\n')
        expect(Math.round(await read(temperature) * 10) / 10).to.be(48.3)
        accessory.shutdown()
      } finally {
        Temp.sysfsRoot = saved
        sim.shutdown()
      }
    })
  })

  describe('removed special devices', () => {
    it('are no longer part of the add-on', () => {
      REMOVED_SERVICES.forEach(name => {
        expect(fs.existsSync(path.join(SERVICES_DIR, name + '.js'))).to.be(false)
      })
      expect(REMOVED_SERVICES).to.contain('HomeMaticSPHTTPAccessory')
      expect(REMOVED_SERVICES).to.contain('HomeMaticBatteryAccessory')
    })

    it('are dropped from the configuration with their mapping', () => {
      const config = {
        special: ['http-id', 'battery-id', 'garage-id'],
        mappings: {
          'http-id:0': { name: 'Web', Service: 'HomeMaticSPHTTPAccessory' },
          'battery-id:0': { name: 'Akku', Service: 'HomeMaticBatteryAccessory' },
          'garage-id:0': { name: 'Tor', Service: 'HomeMaticSPGarageDoorAccessory' },
          '0001D3C99C1234:1': { name: 'Kontakt', Service: 'HomeMaticContactSensorAccessory' }
        }
      }
      const { config: result, removed } = removeRemovedServices(config)
      expect(removed).to.eql(['Web (HomeMaticSPHTTPAccessory)', 'Akku (HomeMaticBatteryAccessory)'])
      expect(result.special).to.eql(['garage-id'])
      expect(Object.keys(result.mappings)).to.eql(['garage-id:0', '0001D3C99C1234:1'])
      // the input stays untouched and a second run changes nothing
      expect(config.special.length).to.be(3)
      const again = removeRemovedServices(result)
      expect(again.removed).to.eql([])
      expect(again.config).to.be(result)
    })

    it('are removed when the server loads the configuration, saved once', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-212-'))
      try {
        fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
          configVersion: 2,
          special: ['http-id'],
          mappings: { 'http-id:0': { name: 'Web', Service: 'HomeMaticSPHTTPAccessory' } }
        }))
        const log = recordingLog()
        log.setDebugEnabled = () => {}
        log.isDebugEnabled = () => false
        const server = new Server(log, tmp)
        server.buildServiceList = async () => ({})
        server.publishServiceTable = () => {}
        await server.loadSettings()
        const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8'))
        expect(stored.special).to.eql([])
        expect(stored.mappings).to.eql({})
        expect(log.text('info')).to.contain('Web (HomeMaticSPHTTPAccessory)')
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })
  })
})
