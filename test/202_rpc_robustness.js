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

  it('resolves reportValueUsage with the datapoints the daemon accepted', async () => {
    const iface = addInterface('HmIP-RF')
    iface.client.methodCall = (method, params, cb) => (params[0] === '000A2:1')
      ? cb(new Error('XML-RPC fault: Transmission is pending.'))
      : cb(null, '')

    const accepted = await iface.reportValueUsage({ 'HmIP-RF.000A1:1.STATE': 1, 'HmIP-RF.000A2:1.STATE': 1 })

    expect(accepted).to.eql(['HmIP-RF.000A1:1.STATE'])
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

  describe('the address the CCU calls back', () => {
    // records the init calls (the URL of the event server and the id), answers them at once
    const recordInits = (iface) => {
      const inits = []
      iface.initClient.methodCall = (method, params, callback) => {
        if (params.length === 2) {
          inits.push(params[0])
        }
        if (callback) {
          callback(null, '')
        }
      }
      return inits
    }

    // connect, then let the interface be idle for longer than the watchdog allows
    const connectAndIdle = (iface) => {
      rpc.watchDogTimeout = 300
      rpc.connect()
      clearTimeout(rpc.watchDogTimer)
      iface.lastMessage = Math.floor(Date.now() / 1000) - 301
      iface.reconnecting = false
      rpc.ccuWatchDog()
      clearTimeout(rpc.watchDogTimer)
    }

    beforeEach(() => {
      rpc.listeningPort = 9875
      rpc.localIP = '192.168.1.100'
    })

    it('registers a local CCU with 127.0.0.1 again when the watchdog reconnects', () => {
      rpc.addInterface('HmIP-RF', '127.0.0.1', 2010, '/')
      const iface = rpc.interfaces[0]
      const inits = recordInits(iface)
      connectAndIdle(iface)
      // the event server of a local CCU listens only on 127.0.0.1: the address of this machine
      // could not be reached by the CCU, and the interface would get no events any more
      expect(inits).to.eql(['http://127.0.0.1:9875', 'http://127.0.0.1:9875'])
    })

    it('takes a CCU addressed by the address of this machine for a local one as well', () => {
      rpc.addInterface('BidCos-RF', '192.168.1.100', 2001, '/')
      const iface = rpc.interfaces[0]
      const inits = recordInits(iface)
      connectAndIdle(iface)
      expect(inits).to.eql(['http://127.0.0.1:9875', 'http://127.0.0.1:9875'])
    })

    it('registers a remote CCU with the address of this machine, also when reconnecting', () => {
      rpc.addInterface('HmIP-RF', '192.168.1.20', 2010, '/')
      const iface = rpc.interfaces[0]
      const inits = recordInits(iface)
      connectAndIdle(iface)
      expect(inits).to.eql(['http://192.168.1.100:9875', 'http://192.168.1.100:9875'])
    })

    it('keeps the port of CUxD (event server port + 1) when reconnecting', () => {
      rpc.addInterface('CUxD', '127.0.0.1', 8701, '/')
      const iface = rpc.interfaces[0]
      const inits = recordInits(iface)
      connectAndIdle(iface)
      expect(inits.length).to.be(2)
      expect(inits[1]).to.be(inits[0])
      expect(inits[0]).to.match(/127\.0\.0\.1:9876$/)
    })
  })

  describe('an interface whose first init fails', () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

    // answers init with the given errors in turn, then successfully
    const answerInits = (iface, errors) => {
      const inits = []
      iface.initClient.methodCall = (method, params, callback) => {
        inits.push(params.length)
        callback(params.length === 2 ? errors.shift() || null : null, '')
      }
      return inits
    }

    const addFailing = (errors) => {
      rpc.addInterface('HmIP-RF', '127.0.0.1', 2010, '/')
      const iface = rpc.interfaces[0]
      iface.initRetryDelay = 10
      return { iface, inits: answerInits(iface, errors) }
    }

    it('is registered again until the daemon answers, waiting longer each time', async () => {
      const { iface, inits } = addFailing([new Error('ECONNREFUSED'), new Error('ECONNREFUSED')])
      rpc.connect()
      clearTimeout(rpc.watchDogTimer)
      expect(iface.isRunning).to.be(false)
      await wait(60)
      expect(inits).to.eql([2, 2, 2])
      expect(iface.isRunning).to.be(true)
      expect(iface.initRetryDelay).to.be(40)
      expect(log.text('warn')).to.contain('registering HmIP-RF. again')
    })

    it('is not registered again when it delivers events meanwhile', async () => {
      const { iface, inits } = addFailing([new Error('timeout')])
      iface.initRetryDelay = 30
      rpc.connect()
      clearTimeout(rpc.watchDogTimer)
      rpc.dispatchEvent('event', ['HAP_HmIP-RF.', '000A1D8991DA1B:1', 'STATE', true])
      await wait(60)
      expect(inits).to.eql([2])
    })

    it('is not registered again after the interfaces are disconnected', async () => {
      const { iface, inits } = addFailing([new Error('ECONNREFUSED')])
      iface.initRetryDelay = 30
      rpc.connect()
      clearTimeout(rpc.watchDogTimer)
      await rpc.disconnectInterfaces()
      await wait(60)
      expect(inits).to.eql([2, 1]) // init, then the deregistration
    })

    it('is not retried after a watchdog reconnect fails, the watchdog tries again itself', () => {
      const { iface, inits } = addFailing([null, new Error('ECONNREFUSED')])
      rpc.watchDogTimeout = 300
      rpc.connect()
      clearTimeout(rpc.watchDogTimer)
      iface.lastMessage = Math.floor(Date.now() / 1000) - 301
      rpc.ccuWatchDog()
      clearTimeout(rpc.watchDogTimer)
      expect(inits).to.eql([2, 1, 2])
      expect(iface.initRetryTimer).to.be(undefined)
    })
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
