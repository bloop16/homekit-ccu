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
const HomeMaticCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticCCU.js'))

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
const later = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// a CCU with one interface that records each report, and the datapoints reported last time
const ccuWith = (reportedBefore) => {
  const storagePath = fs.mkdtempSync(path.join(scratch, 'cfg-'))
  fs.writeFileSync(path.join(storagePath, 'evdps.json'), JSON.stringify(reportedBefore))
  const ccu = new HomeMaticCCU(log, { storagePath })
  ccu.lateUsageDelay = 20
  // no start values are read in this test
  ccu.startValuesPending = true
  const reports = []
  ccu.rpc = {
    connectedInterfaces: () => [{
      ifName: 'HmIP-RF',
      reportValueUsage: (items) => reports.push(items)
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
  it('does not report a datapoint of a device in use as unused when it is not registered yet', () => {
    const { ccu, reported, saved, register } = ccuWith([UNREACH, RING, LOW_BAT])
    register(UNREACH)

    ccu.processEventDatapoints()

    expect(reported()).to.eql({})
    expect(saved()).to.eql([LOW_BAT, RING, UNREACH].sort())
  })

  it('reports the datapoints of a device without an accessory as unused', () => {
    const { ccu, reported, saved, register } = ccuWith([UNREACH, GONE_UNREACH, GONE])
    register(UNREACH)

    ccu.processEventDatapoints()

    expect(reported()).to.eql({ [GONE_UNREACH]: 0, [GONE]: 0 })
    expect(saved()).to.eql([UNREACH])
  })

  it('reports a datapoint registered at the start as used, as before', () => {
    const { ccu, reported, saved, register } = ccuWith([])
    register(UNREACH)
    register(RING)

    ccu.processEventDatapoints()

    expect(reported()).to.eql({ [UNREACH]: 1, [RING]: 1 })
    expect(saved()).to.eql([RING, UNREACH].sort())
  })

  it('reports datapoints registered after the report as used, together', async () => {
    // the state after an older version reported the ring as unused
    const { ccu, reports, saved, register } = ccuWith([UNREACH])
    register(UNREACH)
    ccu.processEventDatapoints()

    // the doorbell: the mode of its channel and the datapoints are asked first
    register(RING)
    register(LOW_BAT)
    expect(reports).to.eql([])
    await later(50)

    expect(reports).to.eql([{ [RING]: 1, [LOW_BAT]: 1 }])
    expect(saved()).to.eql([LOW_BAT, RING, UNREACH].sort())
  })

  it('does not report a late datapoint again that the last report has', async () => {
    const { ccu, reports, register } = ccuWith([UNREACH, RING])
    register(UNREACH)
    ccu.processEventDatapoints()

    register(RING)
    await later(50)

    expect(reports).to.eql([])
  })

  it('reports nothing late for the registrations before the report', async () => {
    const { ccu, reports, register } = ccuWith([])
    register(UNREACH)
    ccu.processEventDatapoints()
    // a second callback of the same datapoint
    register(UNREACH)
    await later(50)

    expect(reports).to.eql([{ [UNREACH]: 1 }])
  })

  it('reports nothing late after a reload started, which reports itself', async () => {
    const { ccu, reports, saved, register } = ccuWith([UNREACH])
    register(UNREACH)
    ccu.processEventDatapoints()
    register(RING)

    await ccu.disconnectInterfaces()
    // the accessories of the old configuration are still there during the reload
    register(LOW_BAT)
    await later(50)

    expect(reports).to.eql([])
    expect(saved()).to.eql([UNREACH])
  })

  it('keeps running when evdps.json cannot be written for a late datapoint', async () => {
    const { ccu, reports, register } = ccuWith([UNREACH])
    register(UNREACH)
    ccu.processEventDatapoints()
    ccu.configurationPath = path.join(scratch, 'missing', 'dir')

    register(RING)
    await later(50)

    expect(reports).to.eql([{ [RING]: 1 }])
  })
})
