'use strict'

const expect = require('expect.js')
const { mock } = require('node:test')
const HomeMaticRPC = require('../lib/HomeMaticRPC')
const { recordingLog } = require('./helpers/recordingLog')

// #45: a quiet CUxD is healthy when its registered event channel still answers ping.
describe('CUxD idle watchdog ping', () => {
  let rpc
  let iface
  let calls
  let log
  let pingCallback
  const flush = () => new Promise(resolve => setImmediate(resolve))

  beforeEach(() => {
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 })
    log = recordingLog()
    rpc = new HomeMaticRPC({ log }, 9875)
    rpc.binServer = Promise.resolve()
    rpc.localIP = '192.168.0.16'
    rpc.addInterface('CUxD', '127.0.0.1', 8701, '/')
    iface = rpc.interfaces[0]
    iface.ifId = 'HAP_CUxD.'
    iface.localIP = '127.0.0.1'
    iface.listeningPort = 9876
    iface.lastMessage = 699
    iface.isRunning = true
    calls = []
    iface.initClient.methodCall = (method, params, cb) => {
      calls.push([method, params])
      cb(null, '')
    }
    iface.client.methodCall = (method, params, cb) => {
      calls.push([method, params])
      pingCallback = cb
    }
  })

  afterEach(() => {
    rpc.resetInterfaces()
    clearTimeout(rpc.watchDogTimer)
    mock.timers.reset()
  })

  const tickWatchdog = () => {
    rpc.ccuWatchDog()
    clearTimeout(rpc.watchDogTimer)
  }
  const event = (channel = 'CENTRAL', dp = 'PONG', value = 'HAP_CUxD.') => {
    rpc.dispatchEvent('event', ['HAP_CUxD.', channel, dp, value])
  }
  const initCalls = () => calls.filter(call => call[0] === 'init')

  it('keeps a quiet registration when PONG arrives, before or after the RPC answer', async () => {
    for (const pongFirst of [true, false]) {
      tickWatchdog()
      expect(calls[calls.length - 1]).to.eql(['ping', ['HAP_CUxD.']])
      if (pongFirst) event()
      pingCallback(null, [true])
      if (!pongFirst) event()
      await flush()
      mock.timers.tick(10000)
      expect(initCalls()).to.eql([])
      expect(iface.watchDogProbe).to.be(undefined)
      // A quiet interval following a healthy probe is checked again, without init.
      mock.timers.tick(301000)
    }
  })

  it('does not accept the direct RPC answer as proof of working callbacks', async () => {
    tickWatchdog()
    pingCallback(null, [true])
    await flush()
    mock.timers.tick(9999)
    expect(initCalls()).to.eql([])
    mock.timers.tick(1)
    expect(initCalls()).to.eql([
      ['init', ['xmlrpc_bin://127.0.0.1:9876']],
      ['init', ['xmlrpc_bin://127.0.0.1:9876', 'HAP_CUxD.']]
    ])
    await flush()
  })

  it('reconnects if ping fails and recovers event delivery afterwards', async () => {
    tickWatchdog()
    pingCallback(new Error('response timeout'))
    await flush()
    expect(initCalls().length).to.be(2)
    const received = []
    rpc.on('event', e => received.push(e))
    event('CUX2801002:14', 'STATE', true)
    expect(received).to.eql([{ address: 'CUxD.CUX2801002:14.STATE', value: true }])
    expect(iface.isRunning).to.be(true)
    tickWatchdog()
    expect(calls.filter(call => call[0] === 'ping').length).to.be(1)
  })

  it('does not overlap probes and bounds a ping that never answers', async () => {
    tickWatchdog()
    tickWatchdog()
    expect(calls).to.eql([['ping', ['HAP_CUxD.']]])
    mock.timers.tick(10000)
    await flush()
    expect(initCalls().length).to.be(2)
  })

  it('accepts a real device event while ping is pending and ignores a late ping error', async () => {
    tickWatchdog()
    event('CUX2801002:14', 'STATE', false)
    pingCallback(new Error('late timeout'))
    await flush()
    mock.timers.tick(10000)
    expect(initCalls()).to.eql([])
  })

  it('accepts CUxD events carrying the CUxD fallback interface id', () => {
    tickWatchdog()
    rpc.dispatchEvent('event', ['CUxD', 'CENTRAL', 'PONG', 'HAP_CUxD.'])
    mock.timers.tick(10000)
    expect(initCalls()).to.eql([])
  })

  it('does not treat an event for an unknown interface as a healthy probe', () => {
    tickWatchdog()
    rpc.dispatchEvent('event', ['unknown', 'CENTRAL', 'PONG', 'HAP_CUxD.'])
    mock.timers.tick(10000)
    expect(initCalls().length).to.be(2)
  })

  it('cancels pending probes on shutdown, including late callbacks', async () => {
    tickWatchdog()
    await rpc.disconnectInterfaces()
    pingCallback(new Error('late timeout'))
    await flush()
    mock.timers.tick(20000)
    expect(initCalls().map(call => call[1].length)).to.eql([1])
  })

  it('cancels pending probes when interfaces are replaced during reload', async () => {
    tickWatchdog()
    rpc.resetInterfaces()
    pingCallback(new Error('late timeout'))
    await flush()
    mock.timers.tick(20000)
    expect(initCalls()).to.eql([])
  })

  it('preserves the existing watchdog behaviour for BidCos and HmIP', () => {
    rpc.resetInterfaces()
    for (const name of ['BidCos-RF', 'HmIP-RF']) {
      rpc.addInterface(name, '127.0.0.1', 2001, '/')
      const other = rpc.interfaces[rpc.interfaces.length - 1]
      other.lastMessage = 699
      other.initClient.methodCall = iface.initClient.methodCall
    }
    tickWatchdog()
    expect(calls.filter(call => call[0] === 'ping')).to.eql([])
    expect(initCalls().length).to.be(4)
  })
})
