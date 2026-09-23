const path = require('path')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const CustomHomeKitTypes = require(path.join(__dirname, '..', 'lib', 'services', 'CustomHomeKitTypes.js'))

const CHAR_UUID = 'E863F118-079E-48FF-8F27-9C2605A29F52'
const SERVICE_UUID = 'E863F00A-079E-48FF-8F27-9C2605A29F52'

describe('HomeKit-CCU CustomHomeKitTypes', () => {
  let types

  beforeEach(() => {
    types = new CustomHomeKitTypes(hap)
    types.createCharacteristic('TestDuration', CHAR_UUID, {
      format: hap.Formats.UINT32,
      unit: hap.Units.SECONDS,
      perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY, hap.Perms.PAIRED_WRITE]
    })
  })

  it('creates a characteristic class that extends hap.Characteristic', () => {
    const c = new types.Characteristic.TestDuration()
    expect(c).to.be.a(hap.Characteristic)
    expect(c.UUID).to.be(CHAR_UUID)
    expect(c.displayName).to.be('TestDuration')
    expect(c.props.format).to.be(hap.Formats.UINT32)
    expect(c.props.unit).to.be(hap.Units.SECONDS)
    expect(c.props.perms).to.eql([hap.Perms.PAIRED_READ, hap.Perms.NOTIFY, hap.Perms.PAIRED_WRITE])
    expect(c.value).to.be(0)
  })

  it('exposes the UUID on the class itself', () => {
    expect(types.Characteristic.TestDuration.UUID).to.be(CHAR_UUID)
    expect(types.Characteristic.TestDuration.name).to.be('TestDuration')
  })

  it('uses the display name when given', () => {
    types.createCharacteristic('Other', CHAR_UUID, { format: hap.Formats.BOOL, perms: [hap.Perms.PAIRED_READ] }, 'Pretty Name')
    const c = new types.Characteristic.Other()
    expect(c.displayName).to.be('Pretty Name')
  })

  it('creates a service class with required and optional characteristics', () => {
    types.createService('TestService', SERVICE_UUID, [types.Characteristic.TestDuration], [hap.Characteristic.Name])
    const s = new types.Service.TestService('My Service', 'sub1')
    expect(s).to.be.a(hap.Service)
    expect(s.UUID).to.be(SERVICE_UUID)
    expect(s.displayName).to.be('My Service')
    expect(s.subtype).to.be('sub1')
    expect(s.testCharacteristic(types.Characteristic.TestDuration)).to.be(true)
    expect(s.optionalCharacteristics.some(c => c.UUID === hap.Characteristic.Name.UUID)).to.be(true)
    expect(types.Service.TestService.UUID).to.be(SERVICE_UUID)
  })
})

describe('HomeKit-CCU Server.getAdvertiser', () => {
  const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
  const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
  const log = new Logger('HAP Test')
  log.setDebugEnabled(false)

  it('defaults to bonjour-hap', () => {
    const server = new Server(log)
    expect(server.getAdvertiser()).to.be('bonjour-hap')
  })

  it('accepts avahi and ciao', () => {
    const server = new Server(log)
    server._configuration = { advertiser: 'avahi' }
    expect(server.getAdvertiser()).to.be('avahi')
    server._configuration = { advertiser: 'ciao' }
    expect(server.getAdvertiser()).to.be('ciao')
  })

  it('falls back on unknown values', () => {
    const server = new Server(log)
    server._configuration = { advertiser: 'nope' }
    expect(server.getAdvertiser()).to.be('bonjour-hap')
  })
})

describe('HomeKit-CCU HomeMaticAccessory.publishSingleAccessory', () => {
  const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
  const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
  const HomeMaticAccessory = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticAccessory.js'))
  const log = new Logger('HAP Test')
  log.setDebugEnabled(false)

  const publishWith = (publishInfo) => {
    let captured
    const fake = {
      _server: new Server(log),
      _name: 'x',
      getPort () { return this.port },
      getPublishInfo () { return publishInfo },
      homeKitAccessory: {
        publish (info) {
          captured = info
          return Promise.resolve()
        }
      },
      log
    }
    HomeMaticAccessory.prototype.publishSingleAccessory.call(fake, 51826)
    return { captured, fake }
  }

  it('passes the server advertiser and the port', () => {
    const { captured, fake } = publishWith({ username: 'aa', pincode: '1' })
    expect(captured.advertiser).to.be('bonjour-hap')
    expect(captured.username).to.be('aa')
    expect(fake.homeKitAccessory.port).to.be(51826)
  })

  it('lets getPublishInfo override the advertiser', () => {
    const { captured } = publishWith({ advertiser: 'ciao' })
    expect(captured.advertiser).to.be('ciao')
  })
})
