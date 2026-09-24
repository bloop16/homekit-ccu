const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const expect = require('expect.js')
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const { groupMembers, readGroups, isGroupAddress } = require(path.join(__dirname, '..', 'lib', 'util', 'ccuGroups.js'))
const { buildDeviceCatalog } = require(path.join(__dirname, '..', 'lib', 'util', 'newDeviceCatalog.js'))

const quietLog = { debug () {}, info () {}, warn () {}, error () {} }
const fixture = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', file))).devices
const loadModel = (name) => import(pathToFileURL(path.join(__dirname, '..', 'lib', 'configurationsrv', 'html', 'js', name)).href)

const GROUP = 'INT0000001'
const TRV = '2123456789ABCD'
const CONTACT = '5962284199ABCD'

describe('HomeKit-CCU CCU groups', () => {
  it('knows group addresses', () => {
    expect(['INT0000001', 'int0000012'].every(isGroupAddress)).to.be(true)
    expect(['2123456789ABCD', 'INTERN', undefined].some(isGroupAddress)).to.be(false)
  })

  it('finds the members of each group whatever the layout of the file', () => {
    const known = [GROUP, 'INT0000002', TRV, CONTACT, 'OTHER']
    const layouts = [
      { groups: [{ id: 7, virtualDevice: GROUP, groupMembers: [{ id: TRV + ':1' }, { id: CONTACT }] }, { virtualDevice: 'INT0000002', groupMembers: [{ id: 'OTHER:1' }] }] },
      [{ name: 'Wohnzimmer', group: { address: GROUP }, members: [TRV, CONTACT, 'UNKNOWN0000'] }, { name: 'Bad', group: { address: 'INT0000002' }, members: ['OTHER'] }]
    ]
    layouts.forEach(layout => {
      expect(groupMembers(layout, known)).to.eql({ [GROUP]: [TRV, CONTACT], INT0000002: ['OTHER'] })
    })
    expect(groupMembers({ list: [GROUP, 'INT0000002', TRV] }, known)).to.eql({})
  })

  it('reads the groups file of OpenCCU, where the group device is only part of its name', () => {
    // the layout of /usr/local/etc/config/groups.gson (serial numbers made up)
    const file = {
      groups: [
        {
          id: 2,
          groupMembers: [
            { memberType: { id: 'RADIATOR_THERMOSTAT' }, properties: {}, id: TRV + ':1' },
            { memberType: { id: 'SENSOR_WINDOW' }, properties: {}, id: CONTACT + ':1' }
          ],
          groupType: { id: 'hmip.heating.group', label: 'HmIP-Heizungssteuerung', version: 131072 },
          groupProperties: { FORBID_SINGLE_OPERATION: false, GROUP_DEVICE_NAME: 'Badezimmer ' + GROUP, NAME: 'Badezimmer' }
        },
        {
          id: 3,
          groupMembers: [{ memberType: { id: 'WALLMOUNTED_THERMOSTAT' }, properties: {}, id: 'OTHER:1' }],
          groupType: { id: 'hmip.heating.group' },
          groupProperties: { GROUP_DEVICE_NAME: 'K\u00fcche INT0000002', NAME: 'K\u00fcche' }
        }
      ]
    }
    expect(groupMembers(file, [GROUP, 'INT0000002', TRV, CONTACT, 'OTHER'])).to.eql({ [GROUP]: [TRV, CONTACT].sort(), INT0000002: ['OTHER'] })
    expect(groupMembers(null, [GROUP])).to.eql({})
  })

  it('reads the groups file and tolerates a missing or broken one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-199-'))
    const file = path.join(dir, 'groups.gson')
    // latin1 like on the CCU
    fs.writeFileSync(file, JSON.stringify({ groups: [{ groupMembers: [{ id: TRV + ':1' }], groupProperties: { GROUP_DEVICE_NAME: 'K\u00fcche ' + GROUP } }] }), 'latin1')
    expect(readGroups([GROUP, TRV], file)).to.eql({ [GROUP]: [TRV] })
    fs.writeFileSync(file, '{ broken')
    expect(readGroups([GROUP, TRV], file)).to.eql({})
    expect(readGroups([GROUP], path.join(dir, 'missing'))).to.eql({})
    fs.rmSync(dir, { recursive: true, force: true })
  })

  describe('in the device catalog and the dialogs', () => {
    let catalog
    let model
    let assistant

    before(async () => {
      const serviceTable = await new Server(quietLog).buildServiceList()
      const devices = ['HmIP-Heating.json', 'HmIP-eTRV-2.json', 'HmIP-SWDO-I.json'].flatMap(fixture)
      devices[0].address = GROUP
      devices[0].name = 'Heizung Wohnzimmer'
      devices[0].channels.forEach(channel => { channel.address = GROUP + ':' + channel.address.split(':')[1] })
      devices.forEach(device => device.channels.forEach(channel => {
        channel.isSuported = (serviceTable[channel.type] !== undefined) || (serviceTable[device.type + ':' + channel.type] !== undefined)
      }))
      catalog = buildDeviceCatalog(devices, {}, { serviceTable, icons: {}, groups: { [GROUP]: [TRV, CONTACT, 'MISSING'] } })
      model = await loadModel('newdevicemodel.js')
      assistant = await loadModel('assistantmodel.js')
    })

    const device = (address) => catalog.find(entry => entry.address === address)

    it('marks the group, its members and the member channels the group sets', () => {
      expect(device(GROUP).group).to.be(true)
      expect(device(GROUP).members).to.eql([TRV, CONTACT])
      expect(device(TRV).groups).to.eql([GROUP])
      const thermostat = device(TRV).channels.find(channel => channel.number === 1)
      expect([thermostat.byGroup, thermostat.preselect]).to.eql([GROUP, false])
      // a window contact is no thermostat: the group does not set it
      expect(device(CONTACT).channels.every(channel => channel.byGroup === undefined)).to.be(true)
    })

    it('shows a group above its members', () => {
      const items = catalog.map(entry => ({ device: entry, entries: model.buildEntries(entry) }))
      const reversed = items.slice().reverse()
      expect(model.orderWithGroups(reversed).map(({ item, group }) => [item.device.address, group ? group.device.address : undefined])).to.eql([
        // the members in the order of the group
        [GROUP, undefined], [TRV, GROUP], [CONTACT, GROUP]
      ])
      expect(model.entriesSetByGroup(items, GROUP).map(entry => entry.id)).to.eql([TRV + ':1'])
    })

    it('does not preselect what the group sets, unless the device is ticked by hand', () => {
      const trv = model.buildEntries(device(TRV))
      expect(model.preselectedEntries(trv, { explicit: false })).to.eql([])
      expect(model.preselectedEntries(trv).map(entry => entry.id)).to.eql([TRV + ':1'])
      const items = assistant.withEntries(catalog)
      const selected = [...assistant.initialSelection(items)]
      expect(selected).to.contain(GROUP + ':1')
      expect(selected).not.to.contain(TRV + ':1')
    })
  })
})

describe('HomeKit-CCU setup assistant: bridge per device', () => {
  let assistant

  before(async () => {
    assistant = await loadModel('assistantmodel.js')
  })

  it('puts a device on the chosen bridge and forgets the choice when it matches the room again', () => {
    const rooms = [{ id: 1, name: 'Küche' }]
    const item = { device: { address: 'A', rooms: ['Küche'], channels: [] }, entries: [] }
    const plan = { bridges: [{ key: 'k' }, { key: 'o' }], roomBridge: { 1: 'k' }, securityBridge: undefined }
    expect(assistant.bridgeOfDevice(plan, item, rooms)).to.be('k')
    assistant.chooseBridge(plan, item, rooms, 'o')
    expect([assistant.bridgeOfDevice(plan, item, rooms), assistant.proposedBridgeOfDevice(plan, item, rooms)]).to.eql(['o', 'k'])
    assistant.chooseBridge(plan, item, rooms, '')
    expect(assistant.bridgeOfDevice(plan, item, rooms)).to.be('')
    assistant.chooseBridge(plan, item, rooms, 'k')
    expect(plan.deviceBridge).to.eql({})
  })
})
