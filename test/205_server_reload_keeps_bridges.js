'use strict'

// Saving the configuration must only restart bridges whose identity changed (see util/bridgeReuse.js).

const path = require('path')
const fs = require('fs')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))

const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const KITCHEN = 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab'
const HALL = '3c06ba46-a915-4689-b9c2-f51f3bb25718'

function instances (overrides = {}) {
  return {
    [KITCHEN]: Object.assign({ name: 'Küche', user: '11:22:33:44:55:66', pincode: '031-45-154', setupID: 'AB12', publishDevices: true }, overrides[KITCHEN]),
    [HALL]: Object.assign({ name: 'Flur', user: '11:22:33:44:55:77', pincode: '482-91-736', setupID: 'CD34', publishDevices: true }, overrides[HALL])
  }
}

describe('HomeKit-CCU reload keeps unchanged bridges', () => {
  let server
  let channels

  beforeEach(async () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', 'HM-Sec-WDS.json')).toString())
    server = new Server(log)
    await server.simulate(undefined, { config: { channels: Object.keys(data.ccu) }, devices: data.devices })
    channels = []
    data.devices.forEach(device => device.channels.forEach(channel => {
      if (Object.keys(data.ccu).indexOf(channel.address) > -1) channels.push(Object.assign({ dtype: device.type }, channel))
    }))
    // the device belongs to the kitchen
    server._configuration.mappings[channels[0].address] = Object.assign({}, server._configuration.mappings[channels[0].address], { instance: KITCHEN })
    server.shutdownBridgeInstances()
    server.powerUpBridges(instances(), channels, [], [], [])
  })

  afterEach(() => server.shutdownBridgeInstances())

  function bridge (id) {
    return server._bridges.find(b => b.instanceId === id)
  }

  function reload (lInstances) {
    server._keepBridgesForReload()
    server._retireChangedBridges(lInstances)
    server.powerUpBridges(lInstances, channels, [], [], [])
    server._retireUnusedBridges()
  }

  it('keeps a bridge with the same identity published and swaps its devices', () => {
    const kitchen = bridge(KITCHEN)
    const oldDevices = kitchen.bridgedAccessories.slice()
    expect(oldDevices.length).to.be(1)
    const port = kitchen.port
    kitchen._publishInfo = undefined

    reload(instances())

    expect(bridge(KITCHEN)).to.be(kitchen)
    expect(kitchen._publishInfo).to.be(undefined) // not published a second time
    expect(kitchen.port).to.be(port)
    expect(kitchen.bridgedAccessories.length).to.be(1)
    expect(kitchen.bridgedAccessories[0]).not.to.be(oldDevices[0])
    expect(kitchen.bridgedAccessories[0].UUID).to.be(oldDevices[0].UUID)
    expect(Object.keys(server._publishedAccessories).length).to.be(1)
  })

  it('restarts only the bridge whose setup code changed', () => {
    const kitchen = bridge(KITCHEN)
    const hall = bridge(HALL)
    let unpublished = 0
    hall.unpublish = () => { unpublished++ }

    reload(instances({ [HALL]: { pincode: '274-81-593' } }))

    expect(bridge(KITCHEN)).to.be(kitchen)
    expect(bridge(HALL)).not.to.be(hall)
    expect(unpublished).to.be(1)
    expect(bridge(HALL)._publishInfo.pincode).to.be('274-81-593')
    expect(bridge(HALL).port).not.to.be(kitchen.port)
  })

  it('unpublishes a bridge that was removed', () => {
    const hall = bridge(HALL)
    let unpublished = 0
    hall.unpublish = () => { unpublished++ }
    const lInstances = instances()
    delete lInstances[HALL]

    reload(lInstances)

    expect(server._bridges.length).to.be(1)
    expect(unpublished).to.be(1)
  })

  it('does not give a new bridge the port of a kept one', () => {
    const hallPort = bridge(HALL).port
    const lInstances = Object.assign({ 'aaaaaaaa-0000-4000-8000-000000000001': { name: 'Garage', user: '11:22:33:44:55:88', pincode: '563-29-184', setupID: 'EF56' } }, instances())

    reload(lInstances)

    const ports = server._bridges.map(b => b.port)
    expect(bridge(HALL).port).to.be(hallPort)
    expect(new Set(ports).size).to.be(ports.length)
  })

  it('shuts a changed bridge down before the devices are loaded', () => {
    const kitchen = bridge(KITCHEN)
    const hall = bridge(HALL)
    let unpublished = 0
    hall.unpublish = () => { unpublished++ }
    server._keepBridgesForReload()
    server._retireChangedBridges(instances({ [HALL]: { name: 'Flur OG' } }))
    expect(unpublished).to.be(1)
    expect([...server._keptBridges.values()]).to.eql([kitchen])
  })

  it('never takes over a bridge whose stored identity is incomplete', () => {
    const kitchen = bridge(KITCHEN)
    const lInstances = instances()
    delete lInstances[KITCHEN].setupID
    reload(lInstances)
    expect(bridge(KITCHEN)).not.to.be(kitchen)
  })

  it('ends a failed reload so that the next one can run', async function () {
    this.timeout(5000)
    server._ccu.disconnectInterfaces = async () => {}
    server.loadSettings = async () => { throw new Error('config.json broken') }
    const errors = []
    const error = server.log.error
    server.log.error = (...args) => errors.push(args.join(' '))
    try {
      await server._reloadAppliances()
      await new Promise(resolve => setTimeout(resolve, 1200))
    } finally {
      server.log.error = error
    }
    expect(server.reloadMode).to.be(false)
    expect(errors.join('\n')).to.contain('config.json broken')
    expect(server._keptBridges.size).to.be(0)
  })

  it('destroys the bridge of a reset pairing and publishes it anew', () => {
    const kitchen = bridge(KITCHEN)
    let destroyed = 0
    kitchen.destroy = () => { destroyed++; return Promise.resolve() }
    const reloads = []
    server._reloadAppliances = (resetId) => reloads.push(resetId)
    server._handleIncommingIPCMessage({ topic: 'resetPairing', uuid: KITCHEN })
    server._handleIncommingIPCMessage({ topic: 'reloadApplicances' })
    expect(reloads).to.eql([KITCHEN, undefined])
    delete server._reloadAppliances

    server._keepBridgesForReload(KITCHEN)
    server._retireChangedBridges(instances())
    server.powerUpBridges(instances(), channels, [], [], [])
    server._retireUnusedBridges()

    expect(destroyed).to.be(1)
    expect(bridge(KITCHEN)).not.to.be(kitchen)
    expect(bridge(KITCHEN)._publishInfo.username).to.be('11:22:33:44:55:66')
  })

  it('resets a pairing requested during a running reload afterwards', async function () {
    this.timeout(5000)
    server._ccu.disconnectInterfaces = async () => {}
    server.loadSettings = async () => { throw new Error('stop here') }
    const resets = []
    const keep = server._keepBridgesForReload.bind(server)
    server._keepBridgesForReload = (resetId) => { resets.push(resetId); keep(resetId) }
    const error = server.log.error
    server.log.error = () => {}
    try {
      server.reloadMode = true
      await server._reloadAppliances(KITCHEN) // skipped, remembered
      server.reloadMode = false
      await server._reloadAppliances()
      await new Promise(resolve => setTimeout(resolve, 2600))
    } finally {
      server.log.error = error
    }
    expect(resets).to.eql([undefined, KITCHEN])
  })
})
