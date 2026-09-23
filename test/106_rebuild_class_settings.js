const path = require('path')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))

describe('HomeKit-CCU Server.rebuildClassSettings', () => {
  const log = new Logger('HAP Test')
  log.setDebugEnabled(false)

  const deepAsync = async (value) => {
    await Promise.resolve()
    await Promise.resolve()
    return value
  }

  const rebuildWith = async (server, serviceConfig) => {
    server.serviceConfig = serviceConfig
    let snapshot
    server.publishServiceTable = () => {
      snapshot = JSON.parse(JSON.stringify(server.serviceConfig))
    }
    await server.rebuildClassSettings()
    return snapshot
  }

  it('publishes only after sync and async configurationItems() are applied', async () => {
    const server = new Server(log)
    const fakes = {
      SyncClass: { configurationItems: () => ({ sync: true }) },
      AsyncClass: { configurationItems: async () => deepAsync({ async: true }) }
    }
    server._requireServiceClass = (name) => fakes[name]
    const published = await rebuildWith(server, {
      TYPE_A: [{ serviceClazz: 'SyncClass' }],
      TYPE_B: [{ serviceClazz: 'AsyncClass' }, { serviceClazz: 'SyncClass' }]
    })
    expect(published.TYPE_A[0].settings).to.eql({ sync: true })
    expect(published.TYPE_B[0].settings).to.eql({ async: true })
    expect(published.TYPE_B[1].settings).to.eql({ sync: true })
  })

  it('waits for the duty cycle device lookup', async () => {
    const server = new Server(log)
    server._ccu = { getCCUDutyCycle: async () => deepAsync({ 'HmIP-HAP 1': {}, 'HmIP-HAP 2': {} }) }
    const published = await rebuildWith(server, {
      SPECIAL: [{ serviceClazz: 'HomeMaticSPCCUDutyCycleAccessory' }]
    })
    expect(published.SPECIAL[0].settings.dcAddress.array).to.eql(['HmIP-HAP 1', 'HmIP-HAP 2'])
  })

  it('still publishes when one class fails to load its settings', async () => {
    const errors = []
    const quietLog = Object.assign(Object.create(log), { error: (...args) => errors.push(args) })
    const server = new Server(quietLog)
    const fakes = {
      Broken: { configurationItems: async () => { throw new Error('boom') } },
      SyncClass: { configurationItems: () => ({ sync: true }) }
    }
    server._requireServiceClass = (name) => fakes[name]
    const published = await rebuildWith(server, {
      TYPE_A: [{ serviceClazz: 'Broken' }, { serviceClazz: 'SyncClass' }]
    })
    expect(published).to.be.ok()
    expect(published.TYPE_A[1].settings).to.eql({ sync: true })
    expect(errors).to.have.length(1)
    expect(errors[0][1]).to.be('Broken')
  })
})

describe('HomeKit-CCU Server.buildServiceList', () => {
  it('does not hang when a configurationItems() call rejects', async function () {
    this.timeout(10000)
    const errors = []
    const log = new Logger('HAP Test')
    log.setDebugEnabled(false)
    const quietLog = Object.assign(Object.create(log), { error: (...args) => errors.push(args) })
    const server = new Server(quietLog)
    server._ccu = { getCCUDutyCycle: async () => { throw new Error('ccu unreachable') } }
    const serviceConfig = await server.buildServiceList()
    const dutyCycle = Object.values(serviceConfig).flat().find(item => item.serviceClazz === 'HomeMaticSPCCUDutyCycleAccessory')
    expect(dutyCycle).to.be.ok()
    expect(dutyCycle.settings).to.eql({})
    expect(errors.some(args => args[1] === 'HomeMaticSPCCUDutyCycleAccessory')).to.be(true)
  })
})
