const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, collectWarnings, read, write, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

// special devices (garage door, two sensor window) are no CCU channels; they are built like Server._loadSpecialDevices does
function specialDevice (sim, className, settings) {
  const Appliance = require(path.join(__dirname, '..', 'lib', 'services', className + '.js'))
  const accessory = new Appliance({ name: 'Special ' + className, address: 'SPEC' + className.length + ':0' }, 'Special', sim.server, { Service: className, settings })
  accessory.init()
  return { accessory, warnings: collectWarnings(accessory) }
}

describe('Openings: special garage door with two sensors', () => {
  let sim
  let special
  let garage

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-SWDO',
      address: '0001D3C99CF001',
      channels: ['MAINTENANCE', 'SHUTTER_CONTACT_TRANSCEIVER', 'SHUTTER_CONTACT_TRANSCEIVER'],
      channel: 1,
      service: 'HomeMaticContactSensorAccessory'
    })
    special = specialDevice(sim, 'HomeMaticSPGarageDoorAccessory', {
      address_sensor_close: 'HmIP.0001D3C99CF001:1.STATE',
      state_sensor_close: 'false',
      address_sensor_open: 'HmIP.0001D3C99CF001:2.STATE',
      state_sensor_open: 'false',
      address_actor_open: 'HmIP.0001D3C99CF001:3.STATE'
    })
    garage = findService(special.accessory, Service.GarageDoorOpener)
  })

  after(() => {
    special.accessory.shutdown()
    sim.shutdown()
  })

  it('answers a valid target while the door is between the sensors', async () => {
    sim.server._ccu.dummyValues[sim.dp('1.STATE')] = 'true'
    sim.server._ccu.dummyValues[sim.dp('2.STATE')] = 'true'
    const current = await read(garage.getCharacteristic(Characteristic.CurrentDoorState))
    expect([Characteristic.CurrentDoorState.OPENING, Characteristic.CurrentDoorState.CLOSING]).to.contain(current)
    expect([Characteristic.TargetDoorState.OPEN, Characteristic.TargetDoorState.CLOSED]).to.contain(await read(garage.getCharacteristic(Characteristic.TargetDoorState)))
    expect(special.warnings).to.eql([])
  })

  it('shows the moving door after it was closed', async () => {
    sim.fire('1.STATE', false)
    sim.fire('2.STATE', true)
    await settle(250)
    expect(garage.getCharacteristic(Characteristic.CurrentDoorState).value).to.be(Characteristic.CurrentDoorState.CLOSED)
    sim.fire('1.STATE', true)
    await settle(250)
    expect(garage.getCharacteristic(Characteristic.TargetDoorState).value).to.be(Characteristic.TargetDoorState.OPEN)
    expect(garage.getCharacteristic(Characteristic.CurrentDoorState).value).to.be(Characteristic.CurrentDoorState.OPENING)
    expect(await read(garage.getCharacteristic(Characteristic.TargetDoorState))).to.be(Characteristic.TargetDoorState.OPEN)
    expect(special.warnings).to.eql([])
  })
})

describe('Openings: special window from rotary handle and contact', () => {
  let sim
  let special
  let window

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-SRH',
      address: '0001D3C99CF002',
      channels: ['MAINTENANCE', 'ROTARY_HANDLE_TRANSCEIVER', 'SHUTTER_CONTACT'],
      channel: 1,
      service: 'HomeMaticRotarySensorAccessory'
    })
    special = specialDevice(sim, 'HomeMaticSPTwoSensorWindowAccessory', {
      address_rotarysensor: 'HmIP.0001D3C99CF002:1.STATE',
      address_windowsensor: 'HmIP.0001D3C99CF002:2.STATE'
    })
    window = findService(special.accessory, Service.Window)
  })

  after(() => {
    special.accessory.shutdown()
    sim.shutdown()
  })

  it('does not show an open window before the sensors sent a value', async () => {
    expect(await read(window.getCharacteristic(Characteristic.CurrentPosition))).to.be(0)
    expect(special.warnings).to.eql([])
  })

  it('reads the current sensor values', async () => {
    sim.server._ccu.dummyValues[sim.dp('1.STATE')] = 2
    sim.server._ccu.dummyValues[sim.dp('2.STATE')] = true
    expect(await read(window.getCharacteristic(Characteristic.CurrentPosition))).to.be(100)
    sim.server._ccu.dummyValues[sim.dp('1.STATE')] = 1
    expect(await read(window.getCharacteristic(Characteristic.CurrentPosition))).to.be(25)
  })

  it('keeps the Eve durations finite', async () => {
    sim.fire('1.STATE', 0)
    sim.fire('2.STATE', false)
    sim.fire('1.STATE', 2)
    sim.fire('2.STATE', true)
    await settle()
    const eve = special.accessory.eve.Characteristic
    expect(Number.isFinite(window.getCharacteristic(eve.OpenDuration).value)).to.be(true)
    expect(Number.isFinite(window.getCharacteristic(eve.ClosedDuration).value)).to.be(true)
    expect(special.warnings).to.eql([])
  })
})

describe('Openings: door opener on a switch actor', () => {
  let sim
  let lock

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-PS',
      address: '0001D3C99CF003',
      channels: ['MAINTENANCE', 'SWITCH_TRANSMITTER', 'SWITCH_VIRTUAL_RECEIVER'],
      channel: 2,
      service: 'HomeMaticDoorOpenerAccessory',
      settings: { OnTime: 1 }
    })
    lock = findService(sim.accessory, Service.LockMechanism)
  })

  after(() => sim.shutdown())

  it('does not open the door when HomeKit locks it', async () => {
    await write(lock.getCharacteristic(Characteristic.LockTargetState), Characteristic.LockTargetState.SECURED)
    expect(sim.ccuValue('2.STATE')).to.be(undefined)
    expect(lock.getCharacteristic(Characteristic.LockCurrentState).value).to.be(Characteristic.LockCurrentState.SECURED)
  })

  it('opens the door when HomeKit unlocks it', async () => {
    await write(lock.getCharacteristic(Characteristic.LockTargetState), Characteristic.LockTargetState.UNSECURED)
    expect(sim.ccuValue('2.STATE')).to.be(1)
    expect(sim.ccuValue('2.ON_TIME')).to.be(1)
    expect(lock.getCharacteristic(Characteristic.LockCurrentState).value).to.be(Characteristic.LockCurrentState.UNSECURED)
  })
})

describe('Openings: HM-Sen-Wa-Od filling level', () => {
  let sim
  let level

  before(async () => {
    sim = await simulateDevice({
      intf: 'BidCos-RF',
      type: 'HM-Sen-Wa-Od',
      address: 'NEQ0123402',
      channels: ['MAINTENANCE', 'CAPACITIVE_FILLING_LEVEL_SENSOR'],
      channel: 1,
      service: 'HomeMaticFillingSensorAccessory'
    })
    level = findService(sim.accessory, Service.HumiditySensor).getCharacteristic(Characteristic.CurrentRelativeHumidity)
  })

  after(() => sim.shutdown())

  it('reads the filling level from the CCU', async () => {
    expect(await read(level)).to.be(0)
    sim.server._ccu.dummyValues[sim.dp('1.FILLING_LEVEL')] = '42'
    expect(await read(level)).to.be(42)
    expect(sim.warnings).to.eql([])
  })
})

describe('Openings: HmIP-SRD rain sensor', () => {
  let sim

  before(async () => {
    sim = await simulateDevice({
      type: 'HmIP-SRD',
      address: '0001D3C99CF004',
      channels: ['MAINTENANCE', 'RAIN_DETECTION_TRANSMITTER'],
      channel: 1,
      service: 'HomeMaticIPRainDetectorAccessory'
    })
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a value', async () => {
    const temperature = findService(sim.accessory, Service.TemperatureSensor).getCharacteristic(Characteristic.CurrentTemperature)
    expect(await read(temperature)).to.be(0)
    expect(await read(findService(sim.accessory, Service.LeakSensor).getCharacteristic(Characteristic.LeakDetected))).to.be(0)
    sim.server._ccu.dummyValues[sim.dp('1.ACTUAL_TEMPERATURE')] = '12.5'
    expect(await read(temperature)).to.be(12.5)
    expect(sim.warnings).to.eql([])
  })
})

describe('Openings: HM-Sec-WDS water sensor', () => {
  let sim

  before(async () => {
    sim = await simulateDevice({
      intf: 'BidCos-RF',
      type: 'HM-Sec-WDS',
      address: 'NEQ0123403',
      channels: ['MAINTENANCE', 'WATERDETECTIONSENSOR'],
      channel: 1,
      service: 'HomeMaticLeakSensorAccessory',
      values: { '0.LOWBAT': false }
    })
  })

  after(() => sim.shutdown())

  it('shows water and moisture as leak', async () => {
    const leak = findService(sim.accessory, Service.LeakSensor).getCharacteristic(Characteristic.LeakDetected)
    sim.fire('1.STATE', 2)
    expect(leak.value).to.be(1)
    sim.fire('1.STATE', 0)
    expect(await read(leak)).to.be(0)
  })

  it('reports the battery', async () => {
    const battery = findService(sim.accessory, Service.Battery)
    expect(battery).to.be.ok()
    sim.fire('0.LOWBAT', true)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
  })
})

describe('Openings: HM-Sec-Sir-WM alarm system', () => {
  let sim

  before(async () => {
    sim = await simulateDevice({
      intf: 'BidCos-RF',
      type: 'HM-Sec-Sir-WM',
      address: 'NEQ0123404',
      channels: ['MAINTENANCE', 'SWITCH_SENSOR', 'SWITCH_SENSOR', 'SWITCH_PANIC', 'ARMING'],
      channel: 4,
      service: 'HomeMaticAlarmAccessory'
    })
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a value', async () => {
    const system = findService(sim.accessory, Service.SecuritySystem)
    expect(await read(system.getCharacteristic(Characteristic.SecuritySystemCurrentState))).to.be.a('number')
    expect(await read(system.getCharacteristic(Characteristic.SecuritySystemTargetState))).to.be.a('number')
    expect(sim.warnings).to.eql([])
  })

  it('returns from an alarm to the armed state it had', async () => {
    const current = findService(sim.accessory, Service.SecuritySystem).getCharacteristic(Characteristic.SecuritySystemCurrentState)
    sim.fire('3.STATE', true)
    expect(current.value).to.be(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED)
    sim.fire('3.STATE', false)
    expect(current.value).not.to.be(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED)
    expect(sim.warnings).to.eql([])
  })
})

describe('Openings: HM-Sec-Win window drive', () => {
  let sim
  let window

  before(async () => {
    sim = await simulateDevice({
      intf: 'BidCos-RF',
      type: 'HM-Sec-Win',
      address: 'NEQ0123405',
      channels: ['MAINTENANCE', 'WINMATIC', 'AKKU'],
      channel: 1,
      service: 'HomeMaticWinmaticAccessory'
    })
    window = findService(sim.accessory, Service.Window)
  })

  after(() => sim.shutdown())

  it('answers every read before the CCU sent a value', async () => {
    expect(await read(window.getCharacteristic(Characteristic.CurrentPosition))).to.be(0)
    expect(await read(window.getCharacteristic(Characteristic.TargetPosition))).to.be(0)
    expect(await read(window.getCharacteristic(Characteristic.PositionState))).to.be(Characteristic.PositionState.STOPPED)
    const battery = findService(sim.accessory, Service.Battery)
    expect(await read(battery.getCharacteristic(Characteristic.BatteryLevel))).to.be(0)
    expect(await read(battery.getCharacteristic(Characteristic.StatusLowBattery))).to.be(0)
    expect(sim.warnings).to.eql([])
  })

  it('reads the level from the CCU', async () => {
    sim.server._ccu.dummyValues[sim.dp('1.LEVEL')] = '0.4'
    expect(await read(window.getCharacteristic(Characteristic.CurrentPosition))).to.be(40)
    sim.server._ccu.dummyValues[sim.dp('1.LEVEL')] = -0.005
    expect(await read(window.getCharacteristic(Characteristic.CurrentPosition))).to.be(0)
    expect(sim.warnings).to.eql([])
  })
})
