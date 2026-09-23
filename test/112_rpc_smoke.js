'use strict'

// End-to-end check of both CCU protocols with the real libraries: homekit-ccu's event servers
// (XML-RPC and, for CUxD, BIN-RPC) and its RPC clients against fake CCU daemons on localhost.
// A real CCU is still the final proof; this guards the library upgrades.

const path = require('path')
const net = require('net')
const expect = require('expect.js')
const xmlrpc = require('homematic-xmlrpc')
const binrpc = require('binrpc')
const HomeMaticRPC = require(path.join(__dirname, '..', 'lib', 'HomeMaticRPC.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))

function portIsFree (port) {
  return new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)))
  })
}

function randomFreePort () {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

// the CUxD event server listens on the XML-RPC port + 1
async function freePortPair () {
  for (let i = 0; i < 20; i++) {
    const port = await randomFreePort()
    if (port < 65535 && await portIsFree(port) && await portIsFree(port + 1)) {
      return port
    }
  }
  throw new Error('no free port pair')
}

function call (client, method, params) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, value) => err ? reject(err) : resolve(value))
  })
}

async function waitFor (condition, timeoutMs = 3000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('condition not met within ' + timeoutMs + 'ms')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function nextEvent (emitter, name) {
  return new Promise(resolve => emitter.once(name, resolve))
}

// a CCU daemon stand-in that accepts init and records the calls
function fakeDaemon (module, port) {
  const server = module.createServer({ host: '127.0.0.1', port })
  server.calls = []
  server.on('init', (err, params, callback) => {
    server.calls.push({ err, params })
    callback(null, '')
  })
  server.on('NotFound', () => {})
  return accepting(port).then(() => server)
}

function closeDaemon (server) {
  if (typeof server.close === 'function') {
    return new Promise(resolve => server.close(() => resolve()))
  }
  server.server.close() // binrpc < 4.2 has no close()
  return Promise.resolve()
}

// resolves once something accepts connections on the port
function accepting (port) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1', () => { socket.end(); resolve() })
    socket.on('error', () => setTimeout(() => accepting(port).then(resolve), 20))
  })
}

describe('HomeKit-CCU RPC smoke test (homematic-xmlrpc, binrpc)', function () {
  this.timeout(10000)
  let rpc
  let log
  let eventPort
  let ccuXml
  let ccuBin

  beforeEach(async () => {
    log = recordingLog()
    eventPort = await freePortPair()
    rpc = new HomeMaticRPC({ log }, eventPort)
    rpc.localIP = '127.0.0.1'
  })

  afterEach(async () => {
    clearTimeout(rpc.watchDogTimer)
    await rpc.stop().catch(() => {})
    await Promise.all([ccuXml, ccuBin].filter(Boolean).map(closeDaemon))
    ccuXml = ccuBin = null
  })

  it('answers system.listMethods on the XML-RPC event server', async () => {
    await rpc.init(0)
    const client = xmlrpc.createClient({ host: '127.0.0.1', port: eventPort, path: '/' })
    const methods = await call(client, 'system.listMethods', ['HAP_BidCos-RF.'])
    expect(methods).to.eql(['event', 'system.listMethods', 'system.multicall'])
  })

  it('registers at an XML-RPC daemon and receives its events', async () => {
    await rpc.init(0)
    const ccuPort = await randomFreePort()
    ccuXml = await fakeDaemon(xmlrpc, ccuPort)
    rpc.addInterface('BidCos-RF', '127.0.0.1', ccuPort, '/')
    rpc.connect()
    const iface = rpc.interfaces[0]
    await waitFor(() => iface.isRunning)
    expect(ccuXml.calls[0].params).to.eql(['http://127.0.0.1:' + eventPort, 'HAP_BidCos-RF.'])

    const toHap = xmlrpc.createClient({ host: '127.0.0.1', port: eventPort, path: '/' })
    const received = nextEvent(rpc, 'event')
    await call(toHap, 'event', ['HAP_BidCos-RF.', 'ABC0000001:1', 'STATE', true])
    expect(await received).to.eql({ address: 'BidCos-RF.ABC0000001:1.STATE', value: true })

    const multi = nextEvent(rpc, 'event')
    await call(toHap, 'system.multicall', [[{ methodName: 'event', params: ['HAP_BidCos-RF.', 'ABC0000001:1', 'LEVEL', 0.5] }]])
    expect(await multi).to.eql({ address: 'BidCos-RF.ABC0000001:1.LEVEL', value: 0.5 })

    expect(await rpc.sendInterfaceCommand('BidCos-RF', 'init', ['http://x:1'])).to.be('')
  })

  it('registers at a BIN-RPC daemon (CUxD) and receives its events', async () => {
    await rpc.init(0)
    const ccuPort = await randomFreePort()
    ccuBin = await fakeDaemon(binrpc, ccuPort)
    rpc.addInterface('CUxD', '127.0.0.1', ccuPort, '/')
    await rpc.binServer
    rpc.connect()
    const iface = rpc.interfaces[0]
    await waitFor(() => iface.isRunning)
    expect(ccuBin.calls[0].params).to.eql(['xmlrpc_bin://127.0.0.1:' + (eventPort + 1), 'HAP_CUxD.'])

    const toHap = binrpc.createClient({ host: '127.0.0.1', port: eventPort + 1, reconnectTimeout: 0 })
    try {
      expect(await call(toHap, 'system.listMethods', ['CUxD'])).to.eql(['event', 'system.listMethods', 'system.multicall'])
      const received = nextEvent(rpc, 'event')
      await call(toHap, 'event', ['CUxD', 'CUX2801001:1', 'STATE', true])
      expect(await received).to.eql({ address: 'CUxD.CUX2801001:1.STATE', value: true })
    } finally {
      if (typeof toHap.close === 'function') { toHap.close() } else { toHap.socket.destroy() }
    }
  })

  it('closes the XML-RPC and BIN-RPC event servers on stop', async () => {
    await rpc.init(0)
    rpc.addInterface('CUxD', '127.0.0.1', await randomFreePort(), '/')
    await rpc.binServer
    await accepting(eventPort)
    await accepting(eventPort + 1)
    await rpc.stop()
    expect(await portIsFree(eventPort)).to.be(true)
    expect(await portIsFree(eventPort + 1)).to.be(true)
  })

  it('answers a call named "error" instead of crashing', async () => {
    await rpc.init(0)
    rpc.addInterface('CUxD', '127.0.0.1', await randomFreePort(), '/')
    await rpc.binServer
    const xml = xmlrpc.createClient({ host: '127.0.0.1', port: eventPort, path: '/' })
    expect(await call(xml, 'error', ['x'])).to.be('')
    const bin = binrpc.createClient({ host: '127.0.0.1', port: eventPort + 1, reconnectTimeout: 0 })
    try {
      expect(await call(bin, 'error', ['x'])).to.be('')
    } finally {
      if (typeof bin.close === 'function') { bin.close() } else { bin.socket.destroy() }
    }
  })

  it('logs errors of the event servers instead of crashing', async () => {
    await rpc.init(0)
    rpc.server.emit('error', new Error('boom'))
    expect(log.text('error')).to.contain('boom')
  })
})
