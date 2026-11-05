'use strict'

// The UUID of an accessory comes from its channel type and name, so two channels of one type with
// the same name on one bridge got the same UUID (seen with the outputs 3 and 4 of an HmIP-PSM both
// named after the plug). The server only warned and added both: HAP-NodeJS then gave both the same
// accessory id, and Apple Home mixed them up. The server leaves the second one out now, and the
// settings page refuses such a name.

const path = require('path')
const fs = require('fs')
const os = require('os')
const expect = require('expect.js')

const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))
const { identityKey, sameIdentityAs } = require(path.join(__dirname, '..', 'lib', 'util', 'accessoryIdentity.js'))

const BRIDGE = 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab' // the test bridge of Server.simulate
const BSM = '6094613587ABCD'
const KRC4 = '000B1BE9A1B2C3'
const NAME_TAKEN = 'Another channel of this type already has this name on this bridge.'
const SWITCH = 'HomeMaticSwitchAccessory'

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', name)).toString())
const quietLog = { debug () {}, info () {}, warn () {}, error () {}, isDebugEnabled: () => false }

describe('HomeKit-CCU duplicate accessory UUID: identity', () => {
  const types = { [BSM + ':4']: 'SWITCH_VIRTUAL_RECEIVER', [BSM + ':5']: 'SWITCH_VIRTUAL_RECEIVER', [BSM + ':7']: 'ENERGIE_METER_TRANSMITTER' }
  const typeOf = (address) => types[address]
  const mapping = (name, instance = 'bridge1', Service = SWITCH) => ({ name, Service, instance })

  it('keeps the key the UUID was always generated from', () => {
    expect(identityKey(SWITCH, 'SWITCH_VIRTUAL_RECEIVER', 'Plug')).to.be('SWITCH_VIRTUAL_RECEIVER:Plug')
    expect(identityKey('HomeMaticRemoteAccessory', 'KEY_TRANSCEIVER', 'Remote')).to.be('Remote:KEY_TRANSCEIVER:Remote')
  })

  it('finds another channel of the same type and name on a common bridge', () => {
    const mappings = { [BSM + ':4']: mapping('Plug', ['bridge1', 'bridge2']) }
    expect(sameIdentityAs(mappings, BSM + ':5', mapping('Plug', 'bridge2'), typeOf)).to.be(BSM + ':4')
  })

  it('allows another name, another bridge, another channel type and the channel itself', () => {
    const mappings = { [BSM + ':4']: mapping('Plug'), [BSM + ':7']: mapping('Meter') }
    expect(sameIdentityAs(mappings, BSM + ':5', mapping('Plug 2'), typeOf)).to.be(undefined)
    expect(sameIdentityAs(mappings, BSM + ':5', mapping('Plug', 'bridge2'), typeOf)).to.be(undefined)
    expect(sameIdentityAs(mappings, BSM + ':7', mapping('Plug'), typeOf)).to.be(undefined)
    expect(sameIdentityAs(mappings, BSM + ':4', mapping('Plug'), typeOf)).to.be(undefined)
  })

  it('treats a mapping without an instance as one on the default bridge', () => {
    const mappings = { [BSM + ':4']: { name: 'Plug', Service: SWITCH } }
    expect(sameIdentityAs(mappings, BSM + ':5', mapping('Plug', BRIDGE), typeOf)).to.be(BSM + ':4')
  })
})

describe('HomeKit-CCU duplicate accessory UUID: server', () => {
  it('adds only the first of two channels with the same type and name to the bridge', async () => {
    const errors = []
    const log = { ...quietLog, error (...args) { errors.push(args) } }
    const data = fixture('HmIP-BSM.json')
    const server = new Server(log)
    server.log = log
    const mappings = {
      [BSM + ':4']: { name: 'Plug', Service: SWITCH, instance: BRIDGE, settings: {} },
      [BSM + ':5']: { name: 'Plug', Service: SWITCH, instance: BRIDGE, settings: {} }
    }
    await server.simulate(undefined, { config: { channels: Object.keys(mappings) }, devices: data.devices, mappings })
    try {
      const published = Object.values(server._publishedAccessories)
      expect(published.map(accessory => accessory.address())).to.eql([BSM + ':4'])
      const refused = server._createdAccessories.find(accessory => accessory.address() === BSM + ':5')
      expect(refused.isShutDown).to.be(true)
      const message = errors.map(args => args.join(' ')).find(text => text.includes('same type and name'))
      expect(message).to.contain(BSM + ':5')
      expect(message).to.contain(BSM + ':4')
    } finally {
      server.shutdown()
    }
  })
})

describe('HomeKit-CCU duplicate accessory UUID: settings page', () => {
  let scratch
  let previousConfigPath
  let serviceTable

  const writeConfig = (config) => fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify(config))
  const readConfig = () => JSON.parse(fs.readFileSync(path.join(scratch, 'config.json')))
  const configService = () => {
    const service = Object.create(ConfigurationService.prototype)
    service.log = quietLog
    service.compatibleDevices = ['HmIP-BSM.json', 'HmIP-KRC4.json'].flatMap(name => fixture(name).devices)
    service.services = serviceTable
    return service
  }
  const stored = (name, instance = 'bridge1', Service = SWITCH) => ({ name, Service, instance, settings: {} })
  const entry = (address, name, more = {}) => ({ address, name, serviceClass: SWITCH, instanceIDs: ['bridge1'], ...more })
  const saveNew = (entries) => configService().saveNewDevices(JSON.stringify(entries))
  const edit = (address, name, bridge = 'bridge1') =>
    configService().saveDevice({ name, address, serviceClass: SWITCH, settings: JSON.stringify({ instanceIDs: { 0: bridge } }) })

  before(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-248-'))
    previousConfigPath = process.env.UIX_CONFIG_PATH
    process.env.UIX_CONFIG_PATH = scratch
    serviceTable = await new Server(quietLog).buildServiceList()
  })

  beforeEach(() => writeConfig({ mappings: { [BSM + ':4']: stored('Plug') }, channels: [BSM + ':4'] }))

  after(() => {
    if (previousConfigPath === undefined) {
      delete process.env.UIX_CONFIG_PATH
    } else {
      process.env.UIX_CONFIG_PATH = previousConfigPath
    }
    fs.rmSync(scratch, { recursive: true, force: true })
  })

  it('refuses a new device with the name of a stored channel of its type on its bridge', () => {
    expect(saveNew([entry(BSM + ':5', 'Plug')])).to.eql({ result: 'error saving', reason: NAME_TAKEN, address: BSM + ':5' })
    expect(Object.keys(readConfig().mappings)).to.eql([BSM + ':4'])
  })

  it('refuses two new devices of one type with the same name', () => {
    expect(saveNew([entry(BSM + ':5', 'Lamp'), entry(BSM + ':6', 'Lamp')])).to.eql({ result: 'error saving', reason: NAME_TAKEN, address: BSM + ':6' })
  })

  it('saves the same name on another bridge and for a remote next to a key', () => {
    expect(saveNew([entry(BSM + ':5', 'Plug', { instanceIDs: ['bridge2'] })])).to.eql({ result: 'saved', count: 1 })
    expect(saveNew([
      entry(KRC4 + ':1', 'Keys', { serviceClass: 'HomeMaticRemoteAccessory' }),
      entry(BSM + ':1', 'Keys', { serviceClass: 'HomeMaticKeyAccessory' })
    ])).to.eql({ result: 'saved', count: 2 })
  })

  it('refuses to rename or move a channel onto the name of another, keeps editing the channel itself', async () => {
    writeConfig({ mappings: { [BSM + ':4']: stored('Plug'), [BSM + ':5']: stored('Lamp') }, channels: [BSM + ':4', BSM + ':5'] })
    expect(await edit(BSM + ':5', 'Plug')).to.eql({ result: 'error saving', reason: NAME_TAKEN, address: BSM + ':4' })
    expect(readConfig().mappings[BSM + ':5'].name).to.be('Lamp')
    expect(await edit(BSM + ':5', 'Plug', 'bridge2')).to.eql({ result: 'saved' })
    expect(await edit(BSM + ':4', 'Plug', 'bridge2')).to.eql({ result: 'error saving', reason: NAME_TAKEN, address: BSM + ':5' })
    expect(await edit(BSM + ':4', 'Plug')).to.eql({ result: 'saved' })
  })
})
