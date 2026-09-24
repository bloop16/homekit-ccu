'use strict'

/*
 * Accessories with more than one service mark the service Apple Home uses for the tile and icon.
 */

const path = require('path')
const expect = require('expect.js')
const { Service } = require('@homebridge/hap-nodejs')
const { simulateDevice, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

function primaries (accessory) {
  return accessory.homeKitAccessory.services.filter(service => service.isPrimaryService)
}

const CASES = [
  {
    title: 'HmIP-WTH-2 wall thermostat with boost switch',
    spec: {
      type: 'HmIP-WTH-2',
      address: '0001A0A9B18401',
      channels: ['MAINTENANCE', 'HEATING_CLIMATECONTROL_TRANSCEIVER'],
      channel: 1,
      service: 'HomeMaticRadiatorThermostatAccessory',
      settings: { addBoostMode: true },
      values: { '1.HUMIDITY': 45, '0.LOW_BAT': false }
    },
    primary: Service.Thermostat,
    secondary: [Service.Switch]
  },
  {
    title: 'HM-CC-RT-DN radiator thermostat with boost switch',
    spec: {
      intf: 'BidCos-RF',
      type: 'HM-CC-RT-DN',
      address: 'NEQ0184002',
      channels: ['MAINTENANCE', 'WEATHER_RECEIVER', 'CLIMATECONTROL_RECEIVER', 'WINDOW_SWITCH_RECEIVER', 'CLIMATECONTROL_RT_TRANSCEIVER'],
      channel: 4,
      service: 'HomeMaticThermostatAccessory',
      settings: { addBootMode: true },
      values: { '4.VALVE_STATE': 10, '0.LOWBAT': false }
    },
    primary: Service.Thermostat,
    secondary: [Service.Switch]
  },
  {
    title: 'HmIP-MOD-HO garage door with ventilation switch',
    spec: {
      type: 'HmIP-MOD-HO',
      address: '0001A0A9B18403',
      channels: ['MAINTENANCE', 'DOOR_RECEIVER', 'SIMPLE_SWITCH_RECEIVER'],
      channel: 1,
      service: 'HomeMaticGarageDoorOpenerAccessory',
      settings: { addventilation: true }
    },
    primary: Service.GarageDoorOpener,
    secondary: [Service.Switch]
  },
  {
    title: 'HmIP-SCTH230 carbon dioxide sensor',
    spec: {
      type: 'HmIP-SCTH230',
      address: '0001A0A9B18404',
      channels: ['MAINTENANCE', 'CARBON_DIOXIDE_RECEIVER', 'COND_SWITCH_TRANSMITTER', 'COND_SWITCH_TRANSMITTER', 'CLIMATE_TRANSCEIVER'],
      channel: 1,
      service: 'HomeMaticIPCO2Accessory'
    },
    primary: Service.CarbonDioxideSensor,
    secondary: [Service.TemperatureSensor, Service.HumiditySensor]
  },
  {
    title: 'HM-Sec-Win window drive',
    spec: {
      intf: 'BidCos-RF',
      type: 'HM-Sec-Win',
      address: 'NEQ0184005',
      channels: ['MAINTENANCE', 'WINMATIC', 'AKKU'],
      channel: 1,
      service: 'HomeMaticWinmaticAccessory'
    },
    primary: Service.Window,
    secondary: [Service.Battery]
  },
  {
    title: 'HmIP-SMI motion detector',
    spec: {
      type: 'HmIP-SMI',
      address: '0001A0A9B18406',
      channels: ['MAINTENANCE', 'MOTIONDETECTOR_TRANSCEIVER'],
      channel: 1,
      service: 'HomeMaticIPMotionAccessory',
      values: { '0.LOW_BAT': false }
    },
    primary: Service.MotionSensor,
    secondary: [Service.LightSensor]
  },
  {
    title: 'HM-Sen-MDIR-O motion detector',
    spec: {
      intf: 'BidCos-RF',
      type: 'HM-Sen-MDIR-O',
      address: 'NEQ0184007',
      channels: ['MAINTENANCE', 'MOTION_DETECTOR'],
      channel: 1,
      service: 'HomeMaticMotionAccessory'
    },
    primary: Service.MotionSensor,
    secondary: [Service.LightSensor]
  },
  {
    title: 'HmIP-PSM switch actuator with power meter',
    spec: {
      type: 'HmIP-PSM',
      address: '0001A0A9B18408',
      channels: ['MAINTENANCE', 'KEY_TRANSCEIVER', 'SWITCH_TRANSMITTER', 'SWITCH_VIRTUAL_RECEIVER', 'SWITCH_VIRTUAL_RECEIVER', 'SWITCH_VIRTUAL_RECEIVER', 'ENERGIE_METER_TRANSMITTER'],
      channel: 6,
      service: 'HomeMaticIPPowerMeterSwitchAccessory'
    },
    primary: Service.Outlet,
    secondary: []
  },
  {
    title: 'HmIP-STHO temperature and humidity sensor',
    spec: {
      type: 'HmIP-STHO',
      address: '0001A0A9B18409',
      channels: ['MAINTENANCE', 'CLIMATE_TRANSCEIVER'],
      channel: 1,
      service: 'HomeMaticThermometerAccessory'
    },
    primary: Service.TemperatureSensor,
    secondary: [Service.HumiditySensor]
  }
]

CASES.forEach(({ title, spec, primary, secondary }) => {
  describe('Refine: primary service of ' + title, () => {
    let sim

    before(async () => {
      sim = await simulateDevice(spec)
    })

    after(() => sim.shutdown())

    it('marks exactly one service as primary', () => {
      const list = primaries(sim.accessory)
      expect(list.length).to.be(1)
      expect(list[0].UUID).to.be(primary.UUID)
    })

    secondary.forEach(serviceType => {
      it('keeps the ' + serviceType.name + ' service secondary', () => {
        const service = findService(sim.accessory, serviceType)
        expect(service).to.be.ok()
        expect(service.isPrimaryService).to.not.be(true)
      })
    })
  })
})
