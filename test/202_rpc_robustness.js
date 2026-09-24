'use strict'

// Regressions from a live OpenCCU log (0.1.0-rc.7):
// - CUxD answered init only after binrpc's 5 s timeout but then sent its events with our id;
//   they were dropped as "multiCall unable to find Interface"
// - faults of reportValueUsage ("Transmission is pending") surfaced as unhandledRejection

const path = require('path')
const expect = require('expect.js')
const HomeMaticRPC = require(path.join(__dirname, '..', 'lib', 'HomeMaticRPC.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))

describe('HomeKit-CCU RPC robustness', () => {
  let log
  let rpc

  function addInterface (ifName) {
    rpc.addInterface(ifName, '127.0.0.1', 1, '/')
    const iface = rpc.interfaces[rpc.interfaces.length - 1]
    iface.ifId = 'HAP_' + iface.ifName
    return iface
  }

  beforeEach(() => {
    log = recordingLog()
    rpc = new HomeMaticRPC({ log }, 0)
    rpc.binServer = Promise.resolve() // no BIN-RPC event server needed here
  })

  afterEach(() => rpc.resetInterfaces())

  it('accepts events of an interface whose init answer timed out', () => {
    const iface = addInterface('CUxD')
    expect(iface.isRunning).to.be(false)
    const received = []
    rpc.on('event', e => received.push(e))

    rpc.dispatchEvent('event', ['HAP_CUxD.', 'CUX2801001:1', 'STATE', true])

    expect(received).to.eql([{ address: 'CUxD.CUX2801001:1.STATE', value: true }])
    expect(iface.isRunning).to.be(true)
    expect(log.text('error')).to.be('')
    expect(log.text('info')).to.contain('CUxD. delivers events')
  })

  it('drops PONG broadcasts of other programs without an error', () => {
    addInterface('CUxD').isRunning = true
    const received = []
    rpc.on('event', e => received.push(e))

    rpc.dispatchEvent('event', ['HAP_CUxD.', 'CENTRAL', 'PONG', 'iobroker:hm-rpc.0:f51169d6'])

    expect(received).to.eql([])
    expect(log.text('error')).to.be('')
  })

  it('still reports events for unknown ids', () => {
    addInterface('BidCos-RF')
    rpc.dispatchEvent('event', ['somebody-else', 'ABC0000001:1', 'STATE', true])
    expect(log.text('error')).to.contain('unable to find Interface')
  })

  it('catches failing reportValueUsage calls', async () => {
    const iface = addInterface('HmIP-RF')
    iface.client.methodCall = (method, params, cb) => cb(new Error('XML-RPC fault: Transmission is pending.'))
    const unhandled = []
    const onUnhandled = e => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      await iface.reportValueUsage({ 'HmIP-RF.000A1:1.STATE': 1, 'HmIP-RF.000A2:1.STATE': 0 })
      await new Promise(resolve => setImmediate(resolve))
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
    }
    expect(unhandled).to.eql([])
    expect(log.text('debug')).to.contain('Transmission is pending')
    expect(log.text('error')).to.be('')
  })
})

describe('HomeKit-CCU RPC connection handling', () => {
  let log
  let rpc

  beforeEach(() => {
    log = recordingLog()
    rpc = new HomeMaticRPC({ log }, 0)
    rpc.binServer = Promise.resolve()
  })

  afterEach(() => {
    rpc.resetInterfaces()
    clearTimeout(rpc.watchDogTimer)
  })

  it('waits up to 30 s only for init of CUxD, other commands keep 5 s', () => {
    rpc.addInterface('CUxD', '127.0.0.1', 1, '/')
    const iface = rpc.interfaces[0]
    expect(iface.initClient.responseTimeout).to.be(30000)
    expect(iface.client.responseTimeout).to.be(5000)
    expect(iface.initClient).not.to.be(iface.client)
  })

  it('ignores events while the interfaces are disconnecting', async () => {
    rpc.addInterface('CUxD', '127.0.0.1', 1, '/')
    const iface = rpc.interfaces[0]
    iface.ifId = 'HAP_CUxD.'
    iface.initClient.methodCall = (method, params, cb) => cb(null, '')
    await rpc.disconnectInterfaces()
    const received = []
    rpc.on('event', e => received.push(e))
    rpc.dispatchEvent('event', ['HAP_CUxD.', 'CUX2801001:1', 'STATE', true])
    expect(received).to.eql([])
    expect(iface.isRunning).to.be(false)
  })

  it('closes the BIN-RPC connections of dropped interfaces', () => {
    rpc.addInterface('CUxD', '127.0.0.1', 1, '/')
    const { client, initClient } = rpc.interfaces[0]
    rpc.resetInterfaces()
    expect(client.closed).to.be(true)
    expect(initClient.closed).to.be(true)
  })

  it('rejects commands for an interface that is not connected', async () => {
    let error
    try {
      await rpc.sendInterfaceCommand('BidCos-RF', 'listBidcosInterfaces', [])
    } catch (e) {
      error = e
    }
    expect(error.message).to.contain('not connected')
  })

  it('does not start a second reconnect while the first waits for its answer', () => {
    rpc.watchDogTimeout = 1
    rpc.addInterface('CUxD', '127.0.0.1', 1, '/')
    const iface = rpc.interfaces[0]
    const calls = []
    iface.initClient.methodCall = (method, params) => calls.push(params.length) // never answers
    iface.lastMessage = 0
    rpc.ccuWatchDog()
    clearTimeout(rpc.watchDogTimer)
    iface.lastMessage = 0
    rpc.ccuWatchDog()
    clearTimeout(rpc.watchDogTimer)
    expect(calls).to.eql([1, 2]) // one stop (deregister) and one init
    expect(iface.reconnecting).to.be(true)
  })
})
