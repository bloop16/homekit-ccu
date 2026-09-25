'use strict'

// The video doorbell on a real OpenCCU (0.1.2-rc.4): assigned to a bridge, but published as an
// accessory of its own with its own setup code, so the bridge the user paired stayed empty, and
// its port was not opened in the firewall. It is a bridged accessory now, like the doorbell.
// A live stream stopped after about 30 s behind the restrictive CCU firewall: the viewer sends
// its RTCP to a random UDP port. The return ports come from a fixed range the firewall opens.

const path = require('path')
const os = require('os')
const fs = require('fs')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const { STREAM_PORTS, bindReturnSocket, reserveUdpPortPair, bindUdpSocket, streamPorts } = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'udpPort.js'))
const VideoDoorBell = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticSPVideoDoorBellAccessory.js'))
const HomeMaticAccessory = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticAccessory.js'))

const log = new Logger('HAP Test')
log.setDebugEnabled(false)
const inRange = (port) => port >= STREAM_PORTS.first && port <= STREAM_PORTS.last

describe('HomeKit-CCU video doorbell in a bridge, stream ports the firewall opens', () => {
  describe('return ports of a stream', () => {
    it('are 9950 to 9979', () => {
      expect(STREAM_PORTS).to.eql({ first: 9950, last: 9979 })
      expect(streamPorts().length).to.be(30)
      expect(streamPorts()[0]).to.be(9950)
    })

    it('binds the video return socket in the range, the next port when one is taken', async () => {
      const first = await bindReturnSocket('ipv4')
      const second = await bindReturnSocket('ipv4')
      try {
        expect(inRange(first.address().port)).to.be(true)
        expect(inRange(second.address().port)).to.be(true)
        expect(second.address().port).to.not.be(first.address().port)
      } finally {
        first.close()
        second.close()
      }
    })

    it('reserves the audio port pair in the range', async () => {
      const pair = await reserveUdpPortPair('ipv4')
      expect(inRange(pair.rtp)).to.be(true)
      expect(inRange(pair.rtcp)).to.be(true)
      expect(pair.rtp % 2).to.be(0)
      expect(pair.rtcp).to.be(pair.rtp + 1)
    })

    it('fails clearly when every port of the range is taken', async () => {
      const taken = []
      try {
        for (const port of streamPorts()) {
          taken.push(await bindUdpSocket('ipv4', port).catch(() => undefined))
        }
        let error
        await bindReturnSocket('ipv4').catch(e => { error = e })
        expect(error.message).to.contain('9950')
      } finally {
        taken.filter(Boolean).forEach(socket => socket.close())
      }
    })
  })

  describe('video doorbell', () => {
    const FAKE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-221-')), 'ffmpeg')
    fs.symlinkSync(path.join(__dirname, 'fixtures', 'fake-ffmpeg.sh'), FAKE)
    const accessories = []
    after(() => accessories.forEach(accessory => accessory.shutdown()))

    const make = (settings) => {
      const server = { isTestMode: true, log, _ccu: { variableWithName: () => undefined, registerAddressForEventProcessingAtAccessory: () => {} } }
      const accessory = new VideoDoorBell({ address: 'VIDEODOORBELL:0', type: 'SPECIAL', name: 'Door' }, 'SPECIAL', server, { name: 'Door', settings })
      accessory.createHomeKitAccessory()
      accessory.publishServices(hap.Service, hap.Characteristic)
      accessories.push(accessory)
      return accessory
    }

    it('is an accessory of the bridge it is assigned to, without a setup code of its own', () => {
      const doorbell = make({ ffmpegpath: FAKE, video_source: 'rtsp://cam/stream' })
      expect(doorbell.isBridgedAccessory()).to.be(true)
      expect(VideoDoorBell.configurationItems()['pin-code']).to.be(undefined)
      expect(doorbell.canBePublished()).to.be(true)
    })

    it('stays out of the bridge without ffmpeg instead of showing an empty accessory', () => {
      const doorbell = make({ ffmpegpath: '/nonexistent/ffmpeg', video_source: 'rtsp://cam/stream' })
      expect(doorbell.cameraUnavailable).to.be(true)
      expect(doorbell.canBePublished()).to.be(false)
    })

    it('publishes other accessories as before', () => {
      expect(HomeMaticAccessory.prototype.canBePublished.call({})).to.be(true)
    })
  })

  describe('server', () => {
    const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))

    it('does not add an accessory to a bridge that cannot be published', () => {
      const server = new Server(log)
      const added = []
      const bridge = { addBridgedAccessory: (accessory) => added.push(accessory) }
      const accessory = { instanceID: 'b', getUUID: () => 'u', getName: () => 'Door', isBridgedAccessory: () => true, canBePublished: () => false, getHomeKitAccessory: () => ({}) }
      server._publishedAccessories = {}
      server.addAccessory(accessory, bridge, true)
      expect(added).to.eql([])
      expect(accessory.isPublished).to.not.be(true)
    })
  })

  describe('firewall', () => {
    const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))

    function portsFor (config) {
      const service = Object.create(ConfigurationService.prototype)
      service.log = { info () {}, warn () {}, error () {}, debug () {} }
      service.bridges = [{ port: 9877 }, { port: 9879 }]
      service.loadSettings = () => config
      let script
      service.runFirewallTcl = (tcl) => { script = tcl }
      service.ensureFirewallPorts()
      const lists = [...script.matchAll(/foreach port \{([^}]*)\}/g)].map(match => match[1].split(' ').filter(Boolean).map(Number))
      return Object.assign(lists[0], { removed: lists[1] })
    }

    it('opens the stream ports while there is a video doorbell', () => {
      const ports = portsFor({ special: ['vd'], mappings: { 'vd:0': { Service: 'HomeMaticSPVideoDoorBellAccessory' } } })
      expect(ports.slice(0, 2)).to.eql([9877, 9879])
      expect(ports.slice(2)).to.eql(streamPorts())
      expect(ports.removed).to.not.contain(9950)
    })

    it('opens only the bridges without a video doorbell and closes the stream ports again', () => {
      expect([...portsFor({ mappings: {} })]).to.eql([9877, 9879])
      expect([...portsFor(undefined)]).to.eql([9877, 9879])
      expect(portsFor({ mappings: {} }).removed).to.eql([9875, 9874, 49874, ...streamPorts()])
    })

    it('closes the stream ports when the add-on is uninstalled', () => {
      const installer = fs.readFileSync(path.join(__dirname, '..', 'addon_installer', 'homekit-ccu'), 'utf8')
      expect(installer).to.contain('foreach port {9874 49874 ' + streamPorts().join(' ') + '}')
    })
  })
})
