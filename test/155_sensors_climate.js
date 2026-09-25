const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, read } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

describe('HomeKit-CCU sensors: HmIP-SWO-PL as thermometer', () => {
  const SWO = '00185A49B1C2D3'
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HmIP-SWO-PL.json', {
      mappings: { [SWO + ':1']: { Service: 'HomeMaticThermometerAccessory' } },
      values: { ['HmIP.' + SWO + ':0.LOW_BAT']: false }
    }))
    accessory = accessoryAt(server, SWO + ':1')
  })

  after(() => shutdown(server))

  it('answers every read with a valid value before the CCU sent any event', async () => {
    expect(accessory.serviceClass).to.be('HomeMaticThermometerAccessory')
    expect(await readAll(accessory)).to.eql([])
  })

  it('reads ACTUAL_TEMPERATURE (HmIP weather sensors have no TEMPERATURE)', async () => {
    const temperature = findService(accessory, Service.TemperatureSensor).getCharacteristic(Characteristic.CurrentTemperature)
    server._ccu.fireEvent('HmIP.' + SWO + ':1.ACTUAL_TEMPERATURE', -8.5)
    expect(temperature.value).to.be(-8.5)
    expect(await read(temperature)).to.be(-8.5)
  })

  it('reads HUMIDITY as a number', async () => {
    const humidity = findService(accessory, Service.HumiditySensor).getCharacteristic(Characteristic.CurrentRelativeHumidity)
    server._ccu.fireEvent('HmIP.' + SWO + ':1.HUMIDITY', '64')
    expect(await read(humidity)).to.be(64)
  })

  it('has a battery service', () => {
    expect(findService(accessory, Service.Battery)).to.be.ok()
  })
})

describe('HomeKit-CCU sensors: HmIP-STH as humidity sensor', () => {
  const STH = '4734919797ABCD'
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HmIP-STH_2.json', {
      values: {
        ['HmIP.' + STH + ':0.LOW_BAT']: false,
        ['HmIP.' + STH + ':0.OPERATING_VOLTAGE']: 2.9
      }
    }))
    accessory = accessoryAt(server, STH + ':1')
  })

  after(() => shutdown(server))

  it('answers every read with a valid value before the CCU sent any event', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('has a battery service with the battery level', async () => {
    const battery = findService(accessory, Service.Battery)
    expect(battery).to.be.ok()
    expect(await read(battery.getCharacteristic(Characteristic.BatteryLevel))).to.be.greaterThan(50)
  })
})

describe('HomeKit-CCU sensors: HmIP-SCTH230 CO2 sensor', () => {
  const SCTH = '5499157171ABCD'
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HmIP-SCTH230.json', {
      config: { channels: [SCTH + ':1'] },
      mappings: { [SCTH + ':1']: { Service: 'HomeMaticIPCO2Accessory' } }
    }))
    accessory = accessoryAt(server, SCTH + ':1')
  })

  after(() => shutdown(server))

  it('answers every read with a valid value before the CCU sent any event', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('shows the CO2 level in Apple Home with a carbon dioxide sensor', async () => {
    const co2 = findService(accessory, Service.CarbonDioxideSensor)
    expect(co2).to.be.ok()
    expect(co2.getCharacteristic(Characteristic.Name).value).to.be(accessory.getName() + ' CO2')
    server._ccu.fireEvent('HmIP.' + SCTH + ':1.CONCENTRATION', 850)
    expect(await read(co2.getCharacteristic(Characteristic.CarbonDioxideLevel))).to.be(850)
    expect(await read(co2.getCharacteristic(Characteristic.CarbonDioxideDetected))).to.be(Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL)
  })

  it('reports abnormal CO2 levels', async () => {
    const co2 = findService(accessory, Service.CarbonDioxideSensor)
    server._ccu.fireEvent('HmIP.' + SCTH + ':1.CONCENTRATION', 2400)
    expect(co2.getCharacteristic(Characteristic.CarbonDioxideDetected).value).to.be(Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL)
    expect(await read(co2.getCharacteristic(Characteristic.CarbonDioxideDetected))).to.be(Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL)
    expect(await read(co2.getCharacteristic(Characteristic.CarbonDioxideLevel))).to.be(2400)
  })

  it('keeps the air quality sensor', async () => {
    const air = findService(accessory, Service.AirQualitySensor)
    expect(air).to.be.ok()
    expect(await read(air.getCharacteristic(Characteristic.AirQuality))).to.be(Characteristic.AirQuality.POOR)
  })
})
