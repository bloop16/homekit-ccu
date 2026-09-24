const path = require('path')
const { pathToFileURL } = require('url')
const expect = require('expect.js')

const loadModel = () => import(pathToFileURL(path.join(__dirname, '..', 'lib', 'configurationsrv', 'html', 'js', 'newdevicemodel.js')).href)

const REMOTE = 'HomeMaticRemoteAccessory'
const KEY = 'HomeMaticKeyAccessory'
const SWITCH = 'HomeMaticSwitchAccessory'
const service = (serviceClazz) => ({ serviceClazz, description: serviceClazz, options: [] })
const channel = (serial, number, more = {}) => ({
  id: number,
  address: serial + ':' + number,
  number,
  name: 'HmIP-BSM ' + serial + ':' + number,
  type: 'SWITCH_VIRTUAL_RECEIVER',
  rooms: [],
  services: [service(SWITCH)],
  secondary: false,
  key: false,
  preselect: true,
  ...more
})
const keyChannel = (serial, number, more = {}) => channel(serial, number, { type: 'KEY_TRANSCEIVER', key: true, services: [service(REMOTE), service(KEY)], preselect: false, ...more })

// a wall switch actuator: two keys, one output with two folded channels, a meter
const bsm = () => ({
  address: 'BSM',
  name: 'Küche Licht',
  type: 'HmIP-BSM',
  rooms: ['Küche'],
  channels: [
    keyChannel('BSM', 1),
    keyChannel('BSM', 2),
    channel('BSM', 4),
    channel('BSM', 5, { secondary: true, preselect: false }),
    channel('BSM', 6, { secondary: true, preselect: false }),
    channel('BSM', 7, { type: 'ENERGIE_METER_TRANSMITTER', services: [service('HomeMaticIPPowerMeterSwitchAccessory')], preselect: false })
  ]
})

describe('HomeKit-CCU new device dialog model', () => {
  let model

  before(async () => {
    model = await loadModel()
  })

  it('makes one row of the keys of a device, mapped on its first key', () => {
    const entries = model.buildEntries(bsm())
    expect(entries.map(entry => entry.id)).to.eql(['BSM:keys', 'BSM:4', 'BSM:5', 'BSM:6', 'BSM:7'])
    const keys = entries[0]
    expect(keys.kind).to.be('keys')
    expect(keys.address).to.be('BSM:1')
    expect(model.channelNumbers(keys)).to.be('1–2')
  })

  it('shows a mapped remote as the key row in HomeKit', () => {
    const device = bsm()
    device.channels[1].mapping = { name: 'Taster', service: REMOTE }
    device.channels[0].coveredBy = 'BSM:2'
    const keys = model.buildEntries(device)[0]
    expect(keys.address).to.be('BSM:2')
    expect(keys.mapping.name).to.be('Taster')
    expect(model.isMapped(keys)).to.be(true)
  })

  it('keeps keys mapped one by one as single rows without the remote service', () => {
    const device = bsm()
    device.channels[0].mapping = { name: 'Taste 1', service: KEY }
    const entries = model.buildEntries(device)
    expect(entries.map(entry => entry.id).slice(0, 2)).to.eql(['BSM:1', 'BSM:2'])
    expect(entries[1].services.map(item => item.serviceClazz)).to.eql([KEY])
  })

  it('hides devices without free rows and folded channels unless asked', () => {
    const device = bsm()
    const entries = model.buildEntries(device)
    expect(model.visibleEntries(device, entries, {}).map(entry => entry.id)).to.eql(['BSM:keys', 'BSM:4', 'BSM:7'])
    expect(model.visibleEntries(device, entries, { showSecondary: true })).to.have.length(5)
    const full = bsm()
    full.channels.forEach(item => { item.mapping = { name: 'x', service: SWITCH } })
    const fullEntries = model.buildEntries(full)
    expect(model.visibleEntries(full, fullEntries, {})).to.eql([])
    // mapped rows stay visible, also folded channels and keys mapped one by one
    expect(model.visibleEntries(full, fullEntries, { showMapped: true })).to.have.length(6)
  })

  it('filters by room and by text on device or channel', () => {
    const device = bsm()
    device.channels[2].name = 'Deckenlampe'
    const entries = model.buildEntries(device)
    expect(model.visibleEntries(device, entries, { room: 'Bad' })).to.eql([])
    expect(model.visibleEntries(device, entries, { room: 'Küche' })).to.have.length(3)
    expect(model.visibleEntries(device, entries, { text: 'hmip-bsm' })).to.have.length(3)
    expect(model.visibleEntries(device, entries, { text: 'decken' }).map(entry => entry.id)).to.eql(['BSM:4'])
    expect(model.visibleEntries(device, entries, { text: 'nothing' })).to.eql([])
  })

  it('preselects the useful free rows, else the first free row', () => {
    const entries = model.buildEntries(bsm())
    expect(model.preselectedEntries(entries).map(entry => entry.id)).to.eql(['BSM:4'])
    const meterOnly = { address: 'M', name: 'Zähler', type: 'HmIP-ESI', channels: [channel('M', 1, { preselect: false })] }
    expect(model.preselectedEntries(model.buildEntries(meterOnly)).map(entry => entry.id)).to.eql(['M:1'])
  })

  it('suggests the CCU channel name, else the device name, numbered when names repeat', () => {
    const device = bsm()
    device.channels[5].name = 'Verbrauch Küche'
    const entries = model.buildEntries(device)
    const pick = (...ids) => entries.filter(entry => ids.includes(entry.id))
    expect(model.suggestNames(device, pick('BSM:4'))).to.eql({ 'BSM:4': 'Küche Licht' })
    expect(model.suggestNames(device, pick('BSM:4', 'BSM:7'))).to.eql({ 'BSM:4': 'Küche Licht', 'BSM:7': 'Verbrauch Küche' })
    expect(model.suggestNames(device, pick('BSM:keys', 'BSM:4'))).to.eql({ 'BSM:keys': 'Küche Licht 1–2', 'BSM:4': 'Küche Licht 4' })
  })

  it('saves a remote as one mapping and other key services per key', () => {
    const keys = model.buildEntries(bsm())[0]
    const choice = { name: 'Taster', service: REMOTE, settings: {}, bridge: 'b1' }
    expect(model.mappingsFor(keys, choice)).to.eql([{ address: 'BSM:1', name: 'Taster', serviceClass: REMOTE, settings: {}, instanceIDs: ['b1'] }])
    const perKey = model.mappingsFor(keys, { ...choice, service: KEY })
    expect(perKey.map(item => [item.address, item.name, item.serviceClass])).to.eql([['BSM:1', 'Taster 1', KEY], ['BSM:2', 'Taster 2', KEY]])
  })

  it('makes one mapping of combined switch outputs and keeps the others', () => {
    const device = bsm()
    device.channels.forEach(item => { item.main = !item.secondary && !item.key && (item.number !== 7) })
    device.channels[3].main = true // a second output
    const entries = model.buildEntries(device)
    const chosen = entries.filter(entry => ['BSM:4', 'BSM:5', 'BSM:7'].includes(entry.id))
    const choices = {
      'BSM:4': { name: 'Licht', service: SWITCH, settings: { Type: 'Switch' } },
      'BSM:5': { name: 'Licht 5', service: SWITCH, settings: {} },
      'BSM:7': { name: 'Zähler', service: 'HomeMaticIPPowerMeterSwitchAccessory', settings: {} }
    }
    expect(model.combinableEntries(chosen, choices).map(entry => entry.id)).to.eql(['BSM:4', 'BSM:5'])
    const combined = model.deviceMappings(chosen, choices, 'b1', true)
    expect(combined.map(item => [item.address, item.name, item.combine])).to.eql([['BSM:4', 'Licht', ['BSM:5']], ['BSM:7', 'Zähler', undefined]])
    expect(model.deviceMappings(chosen, choices, 'b1', false)).to.have.length(3)
    choices['BSM:5'].service = 'HomeMaticDoorOpenerAccessory'
    expect(model.deviceMappings(chosen, choices, 'b1', true)).to.have.length(3)
  })

  it('names a combined accessory after its device instead of a numbered suggestion', () => {
    const device = { name: 'Aktor (EG)' }
    expect(model.combinedName(device, 'Aktor (EG) 4')).to.be('Aktor (EG)')
    expect(model.combinedName(device, 'Aktor (EG) 1–2')).to.be('Aktor (EG)')
    expect(model.combinedName(device, 'Flurlicht')).to.be('Flurlicht')
  })

  it('names service classes readably', () => {
    expect(model.serviceLabel('HomeMaticIPPowerMeterSwitchAccessory')).to.be('Power Meter Switch')
    expect(model.serviceLabel('HomeMaticSwitchAccessory')).to.be('Switch')
    expect(model.serviceLabel('HomeMaticCO2TrafficLightAccessory')).to.be('CO2 Traffic Light')
    expect(model.serviceLabel('HomeMaticIPRGBWAccessory')).to.be('RGBW')
  })
})

describe('HomeKit-CCU new device dialog model: filters', () => {
  let model

  before(async () => {
    model = await loadModel()
  })

  const withFilters = (more) => ({ ...bsm(), functions: ['Licht'], category: 'switch', system: 'HmIP', virtualKeys: false, ...more })
  const shown = (device, filter) => model.visibleEntries(device, model.buildEntries(device), filter).length

  it('filters by function, category and radio system', () => {
    const device = withFilters()
    expect(shown(device, { func: 'Licht', category: 'switch', system: 'HmIP' })).to.be(3)
    expect(shown(device, { func: 'Heizung' })).to.be(0)
    expect(shown(device, { category: 'light' })).to.be(0)
    expect(shown(device, { system: 'BidCos-RF' })).to.be(0)
    expect(shown(device, { text: 'licht' })).to.be(3)
  })

  it('hides the virtual keys of the CCU unless asked for', () => {
    const device = withFilters({ virtualKeys: true })
    expect(shown(device, {})).to.be(0)
    expect(shown(device, { showVirtualKeys: true })).to.be(3)
  })

  it('offers every category and radio system of the catalog', () => {
    expect(model.CATEGORIES).to.eql(['light', 'switch', 'cover', 'climate', 'security', 'sensor', 'button', 'water', 'other'])
    expect(model.SYSTEMS).to.eql(['HmIP', 'HmIP-Wired', 'BidCos-RF', 'BidCos-Wired', 'other'])
  })
})
