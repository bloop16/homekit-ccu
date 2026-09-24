const path = require('path')
const os = require('os')
const expect = require('expect.js')
const { withoutSecrets, redactText } = require(path.join(__dirname, '..', 'lib', 'util', 'logSecrets.js'))
const { serviceClassFile } = require(path.join(__dirname, '..', 'lib', 'util', 'serviceClass.js'))
const HomeMaticRPC = require(path.join(__dirname, '..', 'lib', 'HomeMaticRPC.js'))
const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))

const quietLog = { debug () {}, info () {}, warn () {}, error () {} }

describe('HomeKit-CCU security hardening', () => {
  describe('secrets in the log', () => {
    it('replaces setup codes, session ids and credentials in objects', () => {
      const payload = { bridges: [{ id: 'b', pincode: '123-45-678', setupID: 'ABCD', setupURI: 'X-HM://1' }], settings: { 'pin-code': '1', auth: 'u:p' }, sid: '@abcdefghij@' }
      expect(withoutSecrets(payload)).to.eql({ bridges: [{ id: 'b', pincode: '***', setupID: '***', setupURI: '***' }], settings: { 'pin-code': '***', auth: '***' }, sid: '***' })
      expect(payload.bridges[0].pincode).to.be('123-45-678')
      expect(withoutSecrets('text')).to.be('text')
    })

    it('replaces session ids and URL credentials in text', () => {
      expect(redactText('var s = "@abcdefghij@"; http://user:secret@cam/x rtsp://cam/x'))
        .to.be('var s = "@***@"; http://***@cam/x rtsp://cam/x')
    })

    it('replaces the bare session id of the session check script', () => {
      // isValidCCUSession strips the @ of the session id before it goes into the Rega script
      expect(redactText("Write(system.GetSessionVarStr('YXGjfgVaxU'));"))
        .to.be("Write(system.GetSessionVarStr('***'));")
    })

    it('replaces session ids in query strings, also URL encoded', () => {
      expect(redactText('"/api/?sid=%40AbCdEfGhIj%40&method=backup"')).to.be('"/api/?sid=***&method=backup"')
      expect(redactText('/api/?method=x&sid=@AbCdEfGhIj@')).to.be('/api/?method=x&sid=***')
    })
  })

  describe('service class names', () => {
    it('only resolves class names of lib/services', () => {
      expect(serviceClassFile('HomeMaticSwitchAccessory')).to.contain(path.join('lib', 'services', 'HomeMaticSwitchAccessory.js'))
      for (const name of ['../../../../tmp/haptmp/x', 'HomeMaticAccessory', 'HomeMaticNotThereAccessory', 'HomeMatic/../SwitchAccessory', undefined, 7]) {
        expect(serviceClassFile(name)).to.be(undefined)
      }
    })

    it('refuses to save a device with an unknown class', async () => {
      const service = Object.create(ConfigurationService.prototype)
      service.log = quietLog
      service.loadSettings = () => ({ mappings: {}, channels: [] })
      service.saveSettings = () => { throw new Error('must not save') }
      service.compatibleDevices = []
      const result = await service.saveDevice({ name: 'x', address: 'A:1', serviceClass: '../../tmp/x', settings: '{}' })
      expect(result).to.eql({ result: 'error saving', reason: 'unknown service' })
    })
  })

  describe('event servers', () => {
    const rpc = (ccuIP) => {
      const instance = new HomeMaticRPC({ log: quietLog, ccuIP }, 0)
      instance.localIP = '192.168.0.99'
      return instance
    }

    it('listen on loopback for a CCU on this machine', async () => {
      const local = rpc('127.0.0.1')
      await local.resolvePeers()
      expect(local.localCCU).to.be(true)
    })

    it('take calls from the CCU and this machine only', async () => {
      const remote = rpc('10.1.2.3')
      await remote.resolvePeers()
      expect(remote.localCCU).to.be(false)
      expect(['10.1.2.3', '::ffff:10.1.2.3', '127.0.0.1', '::1', '192.168.0.99'].every(address => remote.isAllowedPeer(address))).to.be(true)
      expect(remote.isAllowedPeer('10.9.9.9')).to.be(false)
      expect(rpc('10.1.2.3').isAllowedPeer('10.1.2.3')).to.be(false)
    })
  })

  describe('api hosts without the session check', () => {
    const service = (useAuth) => {
      const instance = Object.create(ConfigurationService.prototype)
      instance.useAuth = useAuth
      instance.ccuHost = '127.0.0.1'
      return instance
    }

    it('takes every host while the session check is on', () => {
      expect(service(true).isKnownHost({ host: 'rebound.example' })).to.be(true)
    })

    it('takes only own addresses and names while it is off (DNS rebinding)', () => {
      const open = service(false)
      expect(['127.0.0.1:9874', 'localhost', '[::1]:9874', os.hostname() + ':9874', os.hostname() + '.fritz.box'].map(host => open.isKnownHost({ host })))
        .to.eql([true, true, true, true, true])
      expect(open.isKnownHost({ host: 'rebound.example' })).to.be(false)
      expect(open.isKnownHost({})).to.be(false)
    })
  })

  describe('prototype keys', () => {
    it('does not publish a bridge called __proto__', () => {
      const instance = Object.create(ConfigurationService.prototype)
      instance.log = quietLog
      let saved
      instance.loadSettings = () => ({ instances: { b1: { name: 'x' } } })
      instance.saveSettings = (config) => { saved = config }
      instance.savePublishingFlag(['__proto__', 'constructor', 'b1'])
      expect(saved.instances.b1.publishDevices).to.be(true)
      expect({}.publishDevices).to.be(undefined)
    })

    it('reads datapoints only for a numeric channel id', async () => {
      const instance = Object.create(ConfigurationService.prototype)
      instance.ccuPost = () => { throw new Error('must not call the CCU') }
      expect(await instance.ccuGetDatapoints('1);dom.GetObject(2')).to.eql({ datapoints: [] })
    })
  })
})
