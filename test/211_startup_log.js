'use strict'

// From the start log of 0.1.1-rc.4 on an OpenCCU:
// - the log did not say which version was running
// - HmIP-RF never reported that it was connected: a successful init was only logged in debug mode
// - "40 compatible devices found" three times: the list is also rebuilt when the device list
//   is read again (the configuration page asks for that whenever it is opened)

const path = require('path')
const expect = require('expect.js')
const HomeMaticRPC = require(path.join(__dirname, '..', 'lib', 'HomeMaticRPC.js'))
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const { startupBanner } = require(path.join(__dirname, '..', 'lib', 'util', 'startupBanner.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))
const pkg = require(path.join(__dirname, '..', 'package.json'))

describe('HomeKit-CCU start log', () => {
  describe('banner', () => {
    it('names the version of the add-on and of Node.js', () => {
      const text = startupBanner().join('\n')
      expect(text).to.contain('homekit-ccu ' + pkg.version)
      expect(text).to.contain(process.version)
    })
  })

  describe('interface connection', () => {
    let log
    let rpc

    function addInterface (ifName) {
      rpc.addInterface(ifName, '127.0.0.1', 1, '/')
      const iface = rpc.interfaces[rpc.interfaces.length - 1]
      iface.ifId = 'HAP_' + iface.ifName
      iface.initClient.methodCall = (method, params, cb) => cb(null, '')
      return iface
    }

    const connectedLines = () => log.lines.filter(l => l.level === 'info' && /connected/.test(l.text))

    beforeEach(() => {
      log = recordingLog()
      rpc = new HomeMaticRPC({ log }, 0)
      rpc.binServer = Promise.resolve()
    })

    afterEach(() => rpc.resetInterfaces())

    it('reports a successful init once, not again for a reconnect of the watchdog', () => {
      const iface = addInterface('HmIP-RF')
      iface.init('127.0.0.1', 9875)
      expect(iface.isRunning).to.be(true)
      expect(connectedLines().map(l => l.text)).to.eql(['[RPC] interface HmIP-RF. is connected'])
      iface.init('127.0.0.1', 9875)
      expect(connectedLines().length).to.be(1)
    })

    it('reports an interface connected by its first event only once', () => {
      const iface = addInterface('VirtualDevices')
      rpc.dispatchEvent('event', ['HAP_VirtualDevices.', 'INT0000001:1', 'LEVEL', 0.5])
      iface.init('127.0.0.1', 9875)
      expect(connectedLines().length).to.be(1)
      expect(connectedLines()[0].text).to.contain('VirtualDevices. delivers events')
    })
  })

  describe('list of compatible devices', () => {
    it('is counted in the log when it is built first, later rebuilds only in debug mode', async () => {
      const log = recordingLog()
      log.setDebugEnabled = () => {}
      const server = new Server(log)
      await server.simulate(undefined, { config: { channels: [] }, devices: [] })
      server.isTestMode = false
      await server._buildCompatibleObjectList()
      await server._buildCompatibleObjectList()
      const counted = log.lines.filter(l => /compatible devices found/.test(l.text)).map(l => l.level)
      expect(counted.slice(-2)).to.eql(['info', 'debug'])
    })
  })
})
