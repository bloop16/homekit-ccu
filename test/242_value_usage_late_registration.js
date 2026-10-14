'use strict'

// The datapoints in use are reported to the CCU (reportValueUsage) right after the accessories are
// created, and compared with the last report (evdps.json). Some register a datapoint only after a request
// to the CCU: low battery, tamper, faults, keys and remotes ask whether it exists (hazDatapoint), the
// doorbell first asks the mode of its channel. Such a datapoint was missing from the report; one reported
// before was reported as unused (count 0), and the CCU queued a configuration for the device
// (CONFIG_PENDING), for a doorbell or a button one for its key presses (#32). Now only a datapoint of a
// device without any accessory is reported as unused, and one registered later is reported then.

const path = require('path')
const os = require('os')
const fs = require('fs')
const expect = require('expect.js')
const { mock } = require('node:test')
const HomeMaticCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticCCU.js'))
const HomeMaticAccessory = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticAccessory.js'))
const HomeMaticAddress = require(path.join(__dirname, '..', 'lib', 'HomeMaticAddress.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))

// the doorbell: every accessory registers 0.UNREACH while it is created
const RING = 'HmIP-RF.0026E2698F4A19:1.PRESS_SHORT'
const UNREACH = 'HmIP-RF.0026E2698F4A19:0.UNREACH'
const LOW_BAT = 'HmIP-RF.0026E2698F4A19:0.LOW_BAT'
// a contact that is no longer mapped
const GONE = 'HmIP-RF.00109A49A1B2C3:1.STATE'
const GONE_UNREACH = 'HmIP-RF.00109A49A1B2C3:0.UNREACH'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-242-'))
after(() => fs.rmSync(scratch, { recursive: true, force: true }))

const log = { debug () {}, info () {}, warn () {}, error () {} }
// the late report runs on a timer: the tests move the clock (setTimeout and Date) themselves
const DELAY = 1000
const MAX_WAIT = 10000
// the reports are answered asynchronously: moving the clock also lets their answers come in
const settle = () => new Promise(resolve => setImmediate(resolve))
const pass = async (ms) => {
  mock.timers.tick(ms)
  await settle()
}
// an interface that records each report and accepts it
const accepting = (record) => (items) => {
  record(items)
  return Promise.resolve(Object.keys(items))
}

// a CCU with one interface that records each report, and the datapoints reported last time
const ccuWith = (reportedBefore) => {
  const storagePath = fs.mkdtempSync(path.join(scratch, 'cfg-'))
  fs.writeFileSync(path.join(storagePath, 'evdps.json'), JSON.stringify(reportedBefore))
  const ccu = new HomeMaticCCU(log, { storagePath })
  ccu.lateUsageDelay = DELAY
  ccu.lateUsageMaxWait = MAX_WAIT
  // no start values are read in this test
  ccu.startValuesPending = true
  const reports = []
  ccu.rpc = {
    connectedInterfaces: () => [{
      ifName: 'HmIP-RF',
      reportValueUsage: accepting(items => reports.push(items))
    }],
    disconnectInterfaces: () => Promise.resolve(),
    resetInterfaces () {},
    removeAllListeners () {}
  }
  const reported = () => Object.assign({}, ...reports)
  const saved = () => JSON.parse(fs.readFileSync(path.join(storagePath, 'evdps.json'))).sort()
  const register = (dp) => ccu.registerAddressForEventProcessingAtAccessory(dp, () => {})
  return { ccu, reports, reported, saved, register }
}

describe('HomeKit-CCU datapoints in use reported with those registered late', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 12, 10) }))
  afterEach(() => mock.timers.reset())

  it('does not report a datapoint of a device in use as unused when it is not registered yet', async () => {
    const { ccu, reported, saved, register } = ccuWith([UNREACH, RING, LOW_BAT])
    register(UNREACH)

    await ccu.processEventDatapoints()

    expect(reported()).to.eql({})
    expect(saved()).to.eql([LOW_BAT, RING, UNREACH].sort())
  })

  it('reports the datapoints of a device without an accessory as unused', async () => {
    const { ccu, reported, saved, register } = ccuWith([UNREACH, GONE_UNREACH, GONE])
    register(UNREACH)

    await ccu.processEventDatapoints()

    expect(reported()).to.eql({ [GONE_UNREACH]: 0, [GONE]: 0 })
    expect(saved()).to.eql([UNREACH])
  })

  it('reports a virtual key as unused when the add-on itself uses another key of that device', async () => {
    // the variable update event on key 50 of the CCU's virtual remote; no virtual key is mapped any more
    const KEY = 'BidCos-RF.BidCoS-RF:1.PRESS_SHORT'
    const UPDATE_EVENT = 'BidCos-RF.BidCoS-RF:50.PRESS_SHORT'
    const { ccu, saved, register } = ccuWith([UNREACH, KEY, UPDATE_EVENT])
    const reports = []
    ccu.rpc.connectedInterfaces = () => [{ ifName: 'BidCos-RF', reportValueUsage: accepting(items => reports.push(items)) }]
    register(UNREACH)
    ccu.registerAddressForEventProcessingAtAccessory(UPDATE_EVENT, () => {}, false)

    await ccu.processEventDatapoints()

    expect(reports).to.eql([{ [KEY]: 0 }])
    expect(saved()).to.eql([UPDATE_EVENT, UNREACH].sort())
  })

  it('keeps a datapoint of a channel no longer mapped as used while its device has an accessory', async () => {
    // a known trade-off: channel 2 of the device is no longer mapped, channel 1 is; whether a datapoint
    // still registers after asking the CCU is not known at the report, and unused means CONFIG_PENDING
    const CHANNEL_2 = 'HmIP-RF.0026E2698F4A19:2.PRESS_SHORT'
    const { ccu, reported, saved, register } = ccuWith([UNREACH, RING, CHANNEL_2])
    register(UNREACH)
    register(RING)

    await ccu.processEventDatapoints()

    expect(reported()).to.eql({})
    expect(saved()).to.eql([CHANNEL_2, RING, UNREACH].sort())
  })

  it('reports a datapoint registered at the start as used, as before', async () => {
    const { ccu, reported, saved, register } = ccuWith([])
    register(UNREACH)
    register(RING)

    await ccu.processEventDatapoints()

    expect(reported()).to.eql({ [UNREACH]: 1, [RING]: 1 })
    expect(saved()).to.eql([RING, UNREACH].sort())
  })

  it('reports datapoints registered after the report as used, together', async () => {
    // the state after an older version reported the ring as unused
    const { ccu, reports, saved, register } = ccuWith([UNREACH])
    register(UNREACH)
    await ccu.processEventDatapoints()

    // the doorbell: the mode of its channel and the datapoints are asked first
    register(RING)
    register(LOW_BAT)
    await pass(DELAY - 1)
    expect(reports).to.eql([])
    await pass(1)

    expect(reports).to.eql([{ [RING]: 1, [LOW_BAT]: 1 }])
    expect(saved()).to.eql([LOW_BAT, RING, UNREACH].sort())
  })

  it('waits for the next late datapoint before it reports', async () => {
    const { ccu, reports, register } = ccuWith([UNREACH])
    register(UNREACH)
    await ccu.processEventDatapoints()

    // the answers of the CCU come one after the other
    register(RING)
    await pass(DELAY - 100)
    register(LOW_BAT)
    await pass(DELAY - 100)
    expect(reports).to.eql([])
    await pass(100)

    expect(reports).to.eql([{ [RING]: 1, [LOW_BAT]: 1 }])
  })

  it('reports the late datapoints at the latest after the longest wait', async () => {
    const { ccu, reports, register } = ccuWith([UNREACH])
    register(UNREACH)
    await ccu.processEventDatapoints()

    // a late datapoint every half second, for longer than the longest wait
    const late = Array.from({ length: 30 }, (_, i) => 'HmIP-RF.0026E2698F4A19:' + (i + 2) + '.STATE')
    for (const [i, dpName] of late.entries()) {
      if (i > 0) await pass(DELAY / 2)
      register(dpName)
    }
    expect(reports).to.have.length(1)
    expect(Object.keys(reports[0])).to.eql(late.slice(0, MAX_WAIT / (DELAY / 2)))
    await pass(DELAY)

    expect(reports).to.have.length(2)
    expect(Object.keys(reports[1])).to.eql(late.slice(MAX_WAIT / (DELAY / 2)))
  })

  it('reports the late datapoints after the longest wait also when the clock jumps', async () => {
    const { ccu, reports, register } = ccuWith([UNREACH])
    register(UNREACH)
    await ccu.processEventDatapoints()

    register(RING)
    // the CCU gets the time at the start: the clock goes back by hours (timers do not follow it)
    const now = Date.now
    Date.now = () => now() - 6 * 3600 * 1000
    try {
      for (let i = 0; i < 19; i++) {
        await pass(DELAY / 2)
        register('HmIP-RF.0026E2698F4A19:' + (i + 2) + '.STATE')
      }
      expect(reports).to.eql([])
      await pass(DELAY / 2)
    } finally {
      Date.now = now
    }

    expect(reports).to.have.length(1)
  })

  it('reports and saves a late datapoint only for an interface that is connected', async () => {
    const CUXD = 'CUxD.CUX2801001:1.STATE'
    const { ccu, reports, saved, register } = ccuWith([UNREACH])
    register(UNREACH)
    await ccu.processEventDatapoints()

    register(CUXD)
    register(RING)
    await pass(DELAY)

    expect(reports).to.eql([{ [RING]: 1 }])
    // reported at the next start
    expect(saved()).to.eql([RING, UNREACH].sort())
  })

  it('saves a datapoint as used only once the CCU accepted it: one of an interface not connected is reported next time', async () => {
    const CUXD = 'CUxD.CUX2801001:1.STATE'
    const CUXD_GONE = 'CUxD.CUX2801002:1.STATE'
    const { ccu, reports, saved, register } = ccuWith([UNREACH, CUXD_GONE])
    register(UNREACH)
    register(CUXD)

    await ccu.processEventDatapoints()

    expect(reports).to.eql([])
    // the new one is not saved; the unused one is dropped as before, also without an answer
    expect(saved()).to.eql([UNREACH])

    const next = ccuWith(saved())
    next.ccu.rpc.connectedInterfaces = () => ['HmIP-RF', 'CUxD'].map(ifName => ({
      ifName,
      reportValueUsage: accepting(items => next.reports.push(items))
    }))
    next.register(UNREACH)
    next.register(CUXD)
    await next.ccu.processEventDatapoints()

    expect(next.reported()).to.eql({ [CUXD]: 1 })
    expect(next.saved()).to.eql([CUXD, UNREACH].sort())
  })

  it('sends a refused report as used again at the next start, not one as unused', async () => {
    // the daemon refuses a report while a configuration waits for the device ("Transmission is pending"),
    // and one of a device deleted from the CCU; refused as unused, the CCU keeps it as used, which is harmless
    const { ccu, reports, saved, register } = ccuWith([UNREACH, GONE])
    const refusing = (items) => {
      reports.push(items)
      return Promise.resolve(Object.keys(items).filter(dpName => (dpName !== RING) && (dpName !== GONE)))
    }
    ccu.rpc.connectedInterfaces = () => [{ ifName: 'HmIP-RF', reportValueUsage: refusing }]
    register(UNREACH)
    register(RING)

    await ccu.processEventDatapoints()

    expect(reports).to.eql([{ [RING]: 1 }, { [GONE]: 0 }])
    expect(saved()).to.eql([UNREACH])

    const next = ccuWith(saved())
    next.register(UNREACH)
    next.register(RING)
    await next.ccu.processEventDatapoints()

    expect(next.reported()).to.eql({ [RING]: 1 })
    expect(next.saved()).to.eql([RING, UNREACH].sort())
  })

  it('does not save a late datapoint that the CCU refused', async () => {
    const { ccu, reports, saved, register } = ccuWith([UNREACH])
    register(UNREACH)
    await ccu.processEventDatapoints()
    ccu.rpc.connectedInterfaces = () => [{
      ifName: 'HmIP-RF',
      reportValueUsage: (items) => { reports.push(items); return Promise.resolve([]) }
    }]

    register(RING)
    await pass(DELAY)

    expect(reports).to.eql([{ [RING]: 1 }])
    expect(saved()).to.eql([UNREACH])
  })

  // an interface whose answer is held back until the test lets it go
  const holding = (reports) => {
    const answers = []
    const reportValueUsage = (items) => {
      reports.push(items)
      return new Promise(resolve => answers.push(() => resolve(Object.keys(items))))
    }
    return { reportValueUsage, answer: () => answers.splice(0).forEach(answer => answer()) }
  }

  it('saves what the CCU accepted also when a reload started while it answered', async () => {
    const { ccu, reports, saved, register } = ccuWith([UNREACH])
    const iface = holding(reports)
    ccu.rpc.connectedInterfaces = () => [{ ifName: 'HmIP-RF', reportValueUsage: iface.reportValueUsage }]
    register(UNREACH)
    register(LOW_BAT)
    const report = ccu.processEventDatapoints()

    // registered while the CCU answers: reported late
    register(RING)
    expect(ccu.lateDatapoints.has(RING)).to.be(true)

    // the reload drops the late one; the CCU took LOW_BAT as used, so the next start can report it unused
    await ccu.disconnectInterfaces()
    iface.answer()
    await report
    await pass(MAX_WAIT)

    expect(reports).to.eql([{ [LOW_BAT]: 1 }])
    expect(saved()).to.eql([LOW_BAT, UNREACH].sort())
  })

  it('saves a late datapoint without one of the start report that the CCU did not answer yet', async () => {
    const { ccu, reports, saved, register } = ccuWith([UNREACH])
    const iface = holding(reports)
    ccu.rpc.connectedInterfaces = () => [{ ifName: 'HmIP-RF', reportValueUsage: iface.reportValueUsage }]
    register(UNREACH)
    register(LOW_BAT)
    const report = ccu.processEventDatapoints()
    // the late report gets its answer at once
    ccu.rpc.connectedInterfaces = () => [{ ifName: 'HmIP-RF', reportValueUsage: accepting(items => reports.push(items)) }]

    register(RING)
    await pass(DELAY)

    expect(reports).to.eql([{ [LOW_BAT]: 1 }, { [RING]: 1 }])
    expect(saved()).to.eql([RING, UNREACH].sort())

    iface.answer()
    await report
    expect(saved()).to.eql([LOW_BAT, RING, UNREACH].sort())
  })

  it('saves the answer of each interface, also when another one never answers', async () => {
    const KEY = 'BidCos-RF.LEQ0570210:1.PRESS_SHORT'
    const { ccu, reports, saved, register } = ccuWith([])
    ccu.rpc.connectedInterfaces = () => [
      { ifName: 'HmIP-RF', reportValueUsage: (items) => { reports.push(items); return new Promise(() => {}) } },
      { ifName: 'BidCos-RF', reportValueUsage: accepting(items => reports.push(items)) }
    ]
    register(UNREACH)
    register(KEY)

    ccu.processEventDatapoints()
    await settle()

    expect(reports).to.eql([{ [UNREACH]: 1 }, { [KEY]: 1 }])
    expect(saved()).to.eql([KEY])
  })

  it('starts the test CCU without a report of the datapoints in use, so it reports nothing late', async () => {
    const HomeMaticTestCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticTestCCU.js'))
    const ccu = new HomeMaticTestCCU(log, { storagePath: fs.mkdtempSync(path.join(scratch, 'test-ccu-')) })
    ccu.reportedDatapoints = new Set([UNREACH])

    ccu.connect()
    ccu.startValuesPending = true
    ccu.registerAddressForEventProcessingAtAccessory(RING, () => {})

    expect(ccu.reportedDatapoints).to.be(undefined)
    expect(ccu.lateDatapoints.size).to.be(0)
  })

  it('reports a datapoint only to its own interface, not one whose name starts the same', async () => {
    const { ccu, saved, register } = ccuWith([])
    const byInterface = {}
    ccu.rpc.connectedInterfaces = () => ['HmIP-RF', 'HmIP-RF2'].map(ifName => ({
      ifName,
      reportValueUsage: accepting(items => { byInterface[ifName] = items })
    }))
    const OTHER = 'HmIP-RF2.0026E2698F4A20:0.UNREACH'
    register(UNREACH)
    register(OTHER)

    await ccu.processEventDatapoints()

    expect(byInterface).to.eql({ 'HmIP-RF': { [UNREACH]: 1 }, 'HmIP-RF2': { [OTHER]: 1 } })
    expect(saved()).to.eql([UNREACH, OTHER].sort())
  })

  it('does not report a late datapoint again that the last report has', async () => {
    const { ccu, reports, register } = ccuWith([UNREACH, RING])
    register(UNREACH)
    await ccu.processEventDatapoints()

    register(RING)
    await pass(DELAY)

    expect(reports).to.eql([])
  })

  it('reports nothing late for the registrations before the report', async () => {
    const { ccu, reports, register } = ccuWith([])
    register(UNREACH)
    await ccu.processEventDatapoints()
    // a second callback of the same datapoint
    register(UNREACH)
    await pass(DELAY)

    expect(reports).to.eql([{ [UNREACH]: 1 }])
  })

  it('reports nothing late after a reload started, which reports itself', async () => {
    const { ccu, reports, saved, register } = ccuWith([UNREACH])
    register(UNREACH)
    await ccu.processEventDatapoints()
    register(RING)

    await ccu.disconnectInterfaces()
    // the accessories of the old configuration are still there during the reload
    register(LOW_BAT)
    await pass(DELAY)

    expect(reports).to.eql([])
    expect(saved()).to.eql([UNREACH])
  })

  it('reports the registrations after prepareConnections with the next report, not late', async () => {
    const { ccu, reports, register } = ccuWith([UNREACH])
    ccu._fetchInterfaces = () => Promise.resolve()
    register(UNREACH)
    await ccu.processEventDatapoints()

    await ccu.prepareConnections()
    register(UNREACH)
    register(RING)
    await pass(DELAY)
    expect(reports).to.eql([])

    await ccu.processEventDatapoints()
    expect(reports).to.eql([{ [RING]: 1 }])
  })

  it('does not register for an accessory of the configuration before a reload', async () => {
    // the doorbell is unmapped and the settings saved while it asks the mode of its channel
    const { ccu, reports, saved, register } = ccuWith([UNREACH, RING])
    ccu._fetchInterfaces = () => Promise.resolve()
    const doorbell = Object.create(HomeMaticAccessory.prototype)
    doorbell._ccu = ccu
    doorbell.log = log
    register(UNREACH)
    await ccu.processEventDatapoints()
    expect(reports).to.eql([])

    // the reload: the accessories are shut down, the new configuration has another device only
    doorbell.shutdown()
    await ccu.disconnectInterfaces()
    await ccu.prepareConnections()
    register(GONE_UNREACH)
    await ccu.processEventDatapoints()
    expect(reports).to.eql([{ [GONE_UNREACH]: 1 }, { [UNREACH]: 0, [RING]: 0 }])

    // the answer of the CCU to the doorbell comes now
    doorbell.registerAddressForEventProcessingAtAccessory(new HomeMaticAddress('HmIP-RF', '0026E2698F4A19', 1, 'PRESS_SHORT'), () => {})
    await pass(DELAY)

    expect(ccu.eventCallbacks[RING]).to.be(undefined)
    expect(reports).to.have.length(2)
    expect(saved()).to.eql([GONE_UNREACH])
  })

  it('keeps running when evdps.json cannot be written for a late datapoint', async () => {
    const { ccu, reports, register } = ccuWith([UNREACH])
    register(UNREACH)
    await ccu.processEventDatapoints()
    ccu.configurationPath = path.join(scratch, 'missing', 'dir')

    register(RING)
    await pass(DELAY)

    expect(reports).to.eql([{ [RING]: 1 }])
  })

  describe('with the server', () => {
    it('registers the variable update event as used by the add-on, not by an accessory', () => {
      const server = new Server(log)
      const registered = []
      server._configuration = { VariableUpdateEvent: 'BidCos-RF.BidCoS-RF:50.PRESS_SHORT' }
      server._ccu = { registerAddressForEventProcessingAtAccessory: (...args) => registered.push(args) }

      server._registerVariableUpdateEvent()

      expect(registered).to.have.length(1)
      expect(registered[0][0]).to.be('BidCos-RF.BidCoS-RF:50.PRESS_SHORT')
      expect(registered[0][2]).to.be(false)
    })

    it('shuts down at a reload also an accessory that was not added (the same uuid)', async () => {
      const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
      const quiet = new Logger('HAP Test')
      quiet.setDebugEnabled(false)
      const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'devices', 'HM-Sec-WDS.json')).toString())
      const server = new Server(quiet)
      await server.simulate(undefined, { config: { channels: Object.keys(data.ccu) }, devices: data.devices })
      try {
        const accessories = server._createdAccessories.slice()
        expect(accessories.length).to.be.greaterThan(0)
        // as if another accessory had the uuid: it is not in the published ones
        server._publishedAccessories = {}

        server._retireAccessories()

        accessories.forEach(accessory => expect(accessory.isShutDown).to.be(true))
        expect(server._createdAccessories).to.eql([])
      } finally {
        server.shutdownBridgeInstances()
      }
    })
  })
})
