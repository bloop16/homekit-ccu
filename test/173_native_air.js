const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { read, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))
const { readAll } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { simulateFixture } = require(path.join(__dirname, 'helpers', 'nativeHarness.js'))
const HomeMaticIPAirQualityAccessory = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticIPAirQualityAccessory.js'))

const AirQuality = Characteristic.AirQuality
const Fault = Characteristic.StatusFault

describe('Native: PM2.5 air quality bands', () => {
  const quality = HomeMaticIPAirQualityAccessory.airQualityForPM25

  it('follows the European Air Quality Index bands', () => {
    expect(quality(0)).to.be(AirQuality.EXCELLENT)
    expect(quality(10)).to.be(AirQuality.EXCELLENT)
    expect(quality(10.1)).to.be(AirQuality.GOOD)
    expect(quality(20)).to.be(AirQuality.GOOD)
    expect(quality(25)).to.be(AirQuality.FAIR)
    expect(quality(50)).to.be(AirQuality.INFERIOR)
    expect(quality(50.1)).to.be(AirQuality.POOR)
    expect(quality(6553.5)).to.be(AirQuality.POOR)
  })

  it('is unknown without a value', () => {
    expect(quality(undefined)).to.be(AirQuality.UNKNOWN)
  })
})

describe('Native: HmIP-SFD particulate matter sensor', () => {
  let sim
  let air

  before(async () => {
    sim = await simulateFixture('HmIP-SFD.json', {
      channel: 1,
      service: 'HomeMaticIPAirQualityAccessory',
      omit: ['1.MASS_CONCENTRATION_PM_2_5', '1.MASS_CONCENTRATION_PM_10', '1.ACTUAL_TEMPERATURE', '1.HUMIDITY']
    })
    air = findService(sim.accessory, Service.AirQualitySensor)
  })

  after(() => sim.shutdown())

  it('has the air quality sensor as primary service with a thermometer and a hygrometer', () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticIPAirQualityAccessory')
    expect(air.isPrimaryService).to.be(true)
    expect(findService(sim.accessory, Service.TemperatureSensor)).to.be.ok()
    expect(findService(sim.accessory, Service.HumiditySensor)).to.be.ok()
  })

  it('answers every read before the CCU sent a value', async () => {
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(air.getCharacteristic(AirQuality))).to.be(AirQuality.UNKNOWN)
    expect(sim.warnings).to.eql([])
  })

  it('shows PM2.5 as density and air quality', async () => {
    sim.fire('1.MASS_CONCENTRATION_PM_2_5', 18.4)
    // HomeKit rounds densities to whole µg/m³
    expect(air.getCharacteristic(Characteristic.PM2_5Density).value).to.be(18)
    expect(air.getCharacteristic(AirQuality).value).to.be(AirQuality.GOOD)
    sim.fire('1.MASS_CONCENTRATION_PM_2_5', 62)
    expect(air.getCharacteristic(AirQuality).value).to.be(AirQuality.POOR)
    expect(await read(air.getCharacteristic(AirQuality))).to.be(AirQuality.POOR)
  })

  it('shows PM10 and keeps densities inside the HomeKit range', async () => {
    sim.fire('1.MASS_CONCENTRATION_PM_10', 31)
    expect(air.getCharacteristic(Characteristic.PM10Density).value).to.be(31)
    sim.fire('1.MASS_CONCENTRATION_PM_10', 6553.5)
    expect(await read(air.getCharacteristic(Characteristic.PM10Density))).to.be(1000)
    expect(sim.warnings).to.eql([])
  })

  it('shows temperature and humidity', async () => {
    const temperature = findService(sim.accessory, Service.TemperatureSensor).getCharacteristic(Characteristic.CurrentTemperature)
    const humidity = findService(sim.accessory, Service.HumiditySensor).getCharacteristic(Characteristic.CurrentRelativeHumidity)
    sim.fire('1.ACTUAL_TEMPERATURE', 21.7)
    sim.fire('1.HUMIDITY', 48)
    // HomeKit keeps 0.1 °C steps
    expect(temperature.value).to.be.within(21.69, 21.71)
    expect(humidity.value).to.be(48)
    expect(await read(temperature)).to.be.within(21.69, 21.71)
    expect(await read(humidity)).to.be(48)
  })

  it('reports particulate matter sensor errors as fault', async () => {
    const fault = air.getCharacteristic(Fault)
    sim.fire('0.ERROR_PARTICULATE_MATTER_MEASUREMENT', true)
    expect(fault.value).to.be(Fault.GENERAL_FAULT)
    sim.fire('0.ERROR_PARTICULATE_MATTER_MEASUREMENT', false)
    expect(await read(fault)).to.be(Fault.NO_FAULT)
    expect(sim.warnings).to.eql([])
  })

  it('has no battery (mains powered)', () => {
    expect(findService(sim.accessory, Service.Battery)).to.be(undefined)
  })
})

describe('Native: HM-CC-SCD CO2 traffic light', () => {
  let sim
  let co2
  let air

  before(async () => {
    sim = await simulateFixture('HM-CC-SCD.json', {
      channel: 1,
      service: 'HomeMaticCO2TrafficLightAccessory',
      omit: ['1.STATE']
    })
    co2 = findService(sim.accessory, Service.CarbonDioxideSensor)
    air = findService(sim.accessory, Service.AirQualitySensor)
  })

  after(() => sim.shutdown())

  it('has the carbon dioxide sensor as primary service and an air quality sensor', () => {
    expect(sim.accessory.serviceClass).to.be('HomeMaticCO2TrafficLightAccessory')
    expect(co2.isPrimaryService).to.be(true)
    expect(air).to.be.ok()
  })

  it('answers every read before the CCU sent a value', async () => {
    expect(await readAll(sim.accessory)).to.eql([])
    expect(await read(co2.getCharacteristic(Characteristic.CarbonDioxideDetected))).to.be(Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL)
    expect(await read(air.getCharacteristic(AirQuality))).to.be(AirQuality.UNKNOWN)
    expect(sim.warnings).to.eql([])
  })

  it('maps LEVEL_NORMAL, LEVEL_ADDED and LEVEL_ADDED_STRONG', async () => {
    const detected = co2.getCharacteristic(Characteristic.CarbonDioxideDetected)
    const quality = air.getCharacteristic(AirQuality)
    sim.fire('1.STATE', 0)
    expect(quality.value).to.be(AirQuality.GOOD)
    expect(detected.value).to.be(Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL)
    sim.fire('1.STATE', 1)
    expect(quality.value).to.be(AirQuality.FAIR)
    expect(detected.value).to.be(Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL)
    sim.fire('1.STATE', 2)
    expect(quality.value).to.be(AirQuality.POOR)
    expect(detected.value).to.be(Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL)
    expect(await read(detected)).to.be(Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL)
    sim.fire('1.STATE', 'garbage')
    expect(quality.value).to.be(AirQuality.POOR)
    expect(sim.warnings).to.eql([])
  })
})
