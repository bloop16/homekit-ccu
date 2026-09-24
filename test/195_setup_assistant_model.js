const path = require('path')
const { pathToFileURL } = require('url')
const expect = require('expect.js')

const loadModel = () => import(pathToFileURL(path.join(__dirname, '..', 'lib', 'configurationsrv', 'html', 'js', 'assistantmodel.js')).href)

const SWITCH = 'HomeMaticSwitchAccessory'
const LOCK = 'HomeMaticKeyMaticIPAccessory'
const service = (serviceClazz) => ({ serviceClazz, description: serviceClazz, options: [] })

// a catalog device with one output channel in a room
const device = (serial, name, room, more = {}) => ({
  address: serial,
  name,
  type: 'HmIP-PSM',
  rooms: room ? [room] : [],
  functions: more.functions || [],
  virtualKeys: more.virtualKeys === true,
  channels: [{
    id: serial + 3,
    address: serial + ':3',
    number: 3,
    name: 'HmIP-PSM ' + serial + ':3',
    type: 'SWITCH_VIRTUAL_RECEIVER',
    rooms: room ? [room] : [],
    services: [service(more.service || SWITCH)],
    secondary: false,
    key: false,
    main: true,
    preselect: !more.mapping,
    mapping: more.mapping
  }]
})

const ROOMS = [{ id: 10, name: 'Küche' }, { id: 20, name: 'Bad' }, { id: 30, name: 'Flur' }, { id: 40, name: 'Keller' }]
const NAMES = { floors: ['Erdgeschoss', 'Obergeschoss'], otherRooms: 'Weitere Räume', otherDevices: 'Weitere Geräte', security: 'Sicherheit' }
const catalog = () => [
  device('K1', 'Kaffee', 'Küche', { functions: ['Licht'] }),
  device('K2', 'Toaster', 'Küche', { functions: ['Licht'] }),
  device('K3', 'Herd', 'Küche'),
  device('B1', 'Spiegel', 'Bad', { functions: ['Licht'] }),
  device('F1', 'Haustür', 'Flur', { service: LOCK }),
  device('N1', 'Ohne Raum', undefined),
  device('M1', 'Schon da', 'Keller', { mapping: { name: 'Schon da', service: SWITCH } }),
  device('V1', 'CCU', 'Flur', { virtualKeys: true })
]
const DEFAULT = { id: 'def', displayName: 'HomeKit-CCU', roomId: 0, roomIds: [], paired: true }

describe('HomeKit-CCU setup assistant model', () => {
  let model
  let items

  before(async () => {
    model = await loadModel()
  })

  beforeEach(() => {
    items = model.withEntries(catalog())
  })

  const keysOf = (plan) => plan.bridges.map(bridge => bridge.key)

  it('groups devices with free rows by room, without virtual keys and devices already in HomeKit', () => {
    const byRoom = model.devicesByRoom(items, ROOMS)
    const names = (roomId) => byRoom.get(roomId).map(item => item.device.name)
    expect(names(10)).to.eql(['Kaffee', 'Toaster', 'Herd'])
    expect(names(30)).to.eql(['Haustür'])
    expect(names(40)).to.eql([])
    expect(names(model.NO_ROOM)).to.eql(['Ohne Raum'])
  })

  it('filters by function; an empty name stands for devices without a function', () => {
    const names = (functions) => [...model.devicesByRoom(items, ROOMS, functions).values()].flat().map(item => item.device.name)
    expect(names(['Licht'])).to.eql(['Kaffee', 'Toaster', 'Spiegel'])
    expect(names(['Licht', ''])).to.have.length(6)
    expect(names(null)).to.have.length(6)
  })

  it('proposes a bridge per room and the default bridge for devices without a room', () => {
    const plan = model.proposePlan('room', model.devicesByRoom(items, ROOMS), ROOMS, [DEFAULT], { names: NAMES })
    expect(keysOf(plan)).to.eql(['room:Küche', 'room:Bad', 'room:Flur', 'id:def'])
    expect(plan.bridges[0]).to.eql({ key: 'room:Küche', name: 'Küche', kind: 'room', roomId: 10 })
    expect(plan.roomBridge).to.eql({ 10: 'room:Küche', 20: 'room:Bad', 30: 'room:Flur', 0: 'id:def' })
  })

  it('keeps the existing bridge of a room, also found by its name', () => {
    const bridges = [DEFAULT, { id: 'k', displayName: 'HomeKit-CCU Küche', roomId: 10, paired: true }, { id: 'b', displayName: 'HomeKit-CCU Bad', paired: false }]
    const plan = model.proposePlan('room', model.devicesByRoom(items, ROOMS), ROOMS, bridges, { names: NAMES })
    expect(plan.roomBridge[10]).to.be('id:k')
    expect(plan.roomBridge[20]).to.be('id:b')
    expect(plan.bridges.find(bridge => bridge.key === 'id:k')).to.eql({ key: 'id:k', id: 'k', name: 'HomeKit-CCU Küche', kind: 'room', paired: true })
  })

  it('merges small rooms into one bridge and puts locks on a security bridge when asked', () => {
    const plan = model.proposePlan('room', model.devicesByRoom(items, ROOMS), ROOMS, [DEFAULT], { names: NAMES, mergeSmall: true, smallLimit: 1, security: true })
    expect(plan.roomBridge).to.eql({ 10: 'room:Küche', 20: 'rest:Weitere Räume', 30: 'rest:Weitere Räume', 0: 'id:def' })
    expect(plan.securityBridge).to.be('security:Sicherheit')
    const door = items.find(item => item.device.name === 'Haustür')
    expect(model.bridgeOfDevice(plan, door, ROOMS)).to.be('security:Sicherheit')
  })

  it('proposes floors with every room on the first floor, and one bridge for everything', () => {
    const byRoom = model.devicesByRoom(items, ROOMS)
    const floors = model.proposePlan('floor', byRoom, ROOMS, [DEFAULT], { names: NAMES })
    expect(keysOf(floors)).to.eql(['floor:Erdgeschoss', 'floor:Obergeschoss', 'id:def'])
    expect(floors.roomBridge[20]).to.be('floor:Erdgeschoss')
    expect(model.addBridge(floors, 'Dachgeschoss')).to.be('floor:Dachgeschoss')
    expect(model.addBridge(floors, 'Dachgeschoss')).to.be('floor:Dachgeschoss 2')
    const single = model.proposePlan('single', byRoom, ROOMS, [DEFAULT], { names: NAMES })
    expect(keysOf(single)).to.eql(['id:def'])
    expect(Object.values(single.roomBridge)).to.eql(['id:def', 'id:def', 'id:def', 'id:def'])
  })

  it('removes a bridge from the plan: its rooms are not taken, hand-picked devices follow their room', () => {
    const plan = model.proposePlan('room', model.devicesByRoom(items, ROOMS), ROOMS, [DEFAULT], { names: NAMES, security: true })
    const kaffee = items.find(item => item.device.name === 'Kaffee')
    const door = items.find(item => item.device.name === 'Haustür')
    model.chooseBridge(plan, kaffee, ROOMS, 'room:Bad')
    model.removeBridge(plan, 'room:Bad')
    model.removeBridge(plan, 'security:Sicherheit')
    expect(keysOf(plan)).to.eql(['room:Küche', 'room:Flur', 'id:def'])
    expect(plan.roomBridge[20]).to.be('')
    expect(plan.securityBridge).to.be(undefined)
    expect(model.bridgeOfDevice(plan, kaffee, ROOMS)).to.be('room:Küche')
    expect(model.bridgeOfDevice(plan, door, ROOMS)).to.be('room:Flur')
    const custom = model.addBridge(plan, 'Wohnzimmer', 'custom')
    plan.roomBridge[20] = custom
    const payload = model.buildApplyPayload(plan, items, ROOMS, model.initialSelection(items), model.completeChoices(items, model.initialSelection(items)))
    expect(payload.bridges.find(bridge => bridge.key === custom)).to.eql({ key: 'custom:Wohnzimmer', name: 'Wohnzimmer', roomIds: [20] })
  })

  it('finds empty and taken names of new bridges', () => {
    const bridges = [DEFAULT, { id: 'k', displayName: 'HomeKit-CCU Küche' }]
    const plan = { bridges: [{ key: 'id:k', id: 'k', name: 'HomeKit-CCU Küche' }, { key: 'custom:Bad', name: 'Bad' }] }
    expect(model.bridgeNameProblem(plan, bridges)).to.be(undefined)
    plan.bridges.push({ key: 'custom:x', name: ' ' })
    expect(model.bridgeNameProblem(plan, bridges)).to.be('missing')
    plan.bridges[2].name = 'bad'
    expect(model.bridgeNameProblem(plan, bridges)).to.be('duplicate')
    plan.bridges[2].name = 'Küche'
    expect(model.bridgeNameProblem(plan, bridges)).to.be('duplicate')
    plan.bridges[2].name = 'default'
    expect(model.bridgeNameProblem(plan, bridges)).to.be('duplicate')
  })

  it('creates a bridge for devices without a room when there is no default bridge', () => {
    const plan = model.proposePlan('single', model.devicesByRoom(items, ROOMS), ROOMS, [], { names: NAMES })
    expect(plan.bridges).to.eql([{ key: 'rest:Weitere Geräte', name: 'Weitere Geräte', kind: 'rest' }])
  })

  it('summarizes the bridges, new ones and the accessories per bridge', () => {
    const plan = model.proposePlan('room', model.devicesByRoom(items, ROOMS), ROOMS, [DEFAULT], { names: NAMES })
    const selected = model.initialSelection(items)
    const summary = model.summarize(plan, items, ROOMS, selected)
    expect(summary.bridges.map(item => [item.name, item.isNew, item.rooms, item.devices])).to.eql([
      ['HomeKit-CCU Küche', true, ['Küche'], 3],
      ['HomeKit-CCU Bad', true, ['Bad'], 1],
      ['HomeKit-CCU Flur', true, ['Flur'], 1],
      ['HomeKit-CCU', false, [], 1]
    ])
    expect([summary.newBridges, summary.devices, summary.tooMany]).to.eql([3, 6, []])
  })

  it('builds the payload: used bridges with their rooms, one mapping per chosen row', () => {
    const byRoom = model.devicesByRoom(items, ROOMS)
    const plan = model.proposePlan('room', byRoom, ROOMS, [DEFAULT], { names: NAMES, mergeSmall: true, smallLimit: 1 })
    plan.roomBridge[30] = '' // the hall is left out
    const selected = model.initialSelection(items)
    selected.delete('K3:3')
    const choices = model.completeChoices(items, selected)
    choices['K1:3'].name = '  Kaffeemaschine '
    const payload = model.buildApplyPayload(plan, items, ROOMS, selected, choices)
    expect(payload.bridges).to.eql([
      { key: 'room:Küche', name: 'Küche', roomId: 10 },
      { key: 'rest:Weitere Räume', name: 'Weitere Räume', roomIds: [20] },
      { key: 'id:def', id: 'def' }
    ])
    expect(payload.devices.map(item => [item.address, item.name, item.bridge])).to.eql([
      ['K1:3', 'Kaffeemaschine', 'room:Küche'],
      ['K2:3', 'Toaster', 'room:Küche'],
      ['B1:3', 'Spiegel', 'rest:Weitere Räume'],
      ['N1:3', 'Ohne Raum', 'id:def']
    ])
    expect(payload.devices[0]).to.only.have.keys('address', 'name', 'serviceClass', 'settings', 'bridge')
  })

  it('ticks nothing of a device that is partly in HomeKit already', () => {
    const partly = model.withEntries([{ ...device('P1', 'Teilweise', 'Küche'), channels: [device('P1', 'x', 'Küche').channels[0], { ...device('P1', 'x', 'Küche', { mapping: { name: 'x', service: SWITCH } }).channels[0], id: 'P14', address: 'P1:4', number: 4 }] }])
    expect([...model.initialSelection(partly)]).to.eql([])
  })

  it('keeps choices the user made when the selection changes', () => {
    const selected = model.initialSelection(items)
    const first = model.completeChoices(items, selected)
    first['K1:3'].service = 'Other'
    expect(model.completeChoices(items, selected, first)['K1:3'].service).to.be('Other')
  })
})
