const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, settle } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

const { SINGLE_PRESS, DOUBLE_PRESS, LONG_PRESS } = Characteristic.ProgrammableSwitchEvent

// the StatelessProgrammableSwitch services of an accessory in the order they were added
function buttons (accessory) {
  return accessory.getHomeKitAccessory().services
    .filter(service => service.UUID === Service.StatelessProgrammableSwitch.UUID)
}

const labelIndex = (service) => service.getCharacteristic(Characteristic.ServiceLabelIndex).value
const switchEvent = (service) => service.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
const nameOf = (service) => service.getCharacteristic(Characteristic.Name).value

// records the ProgrammableSwitchEvent values per button index (1..n) until stop() is called
function recordEvents (accessory) {
  const list = []
  const removers = buttons(accessory).map(service => {
    const listener = (change) => list.push([labelIndex(service), change.newValue])
    switchEvent(service).on('change', listener)
    return () => switchEvent(service).removeListener('change', listener)
  })
  return { list, stop: () => removers.forEach(remove => remove()) }
}

// dummy values so hazDatapoint finds the key and battery datapoints of the device
function keyValues (serial, keys) {
  const values = {
    ['HmIP.' + serial + ':0.LOW_BAT']: false,
    ['HmIP.' + serial + ':0.OPERATING_VOLTAGE']: 3.0
  }
  for (let key = 1; key <= keys; key++) {
    values['HmIP.' + serial + ':' + key + '.PRESS_SHORT'] = false
    values['HmIP.' + serial + ':' + key + '.PRESS_LONG'] = false
  }
  return values
}

describe('HomeKit-CCU remote: HmIP-KRC4 as one accessory', () => {
  const KRC4 = '000B1BE9A1B2C3'
  const DP = (key, name) => 'HmIP.' + KRC4 + ':' + key + '.' + name
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HmIP-KRC4.json', { values: keyValues(KRC4, 4) }))
    accessory = accessoryAt(server, KRC4 + ':1')
    await settle()
  })

  after(() => shutdown(server))

  it('is published as one HomeMaticRemoteAccessory', () => {
    expect(accessory).to.be.ok()
    expect(accessory.serviceClass).to.be('HomeMaticRemoteAccessory')
    expect(Object.keys(server._publishedAccessories)).to.have.length(1)
    expect(accessory.getName()).to.be('Fernbedienung Flur')
  })

  it('has a StatelessProgrammableSwitch per key with ServiceLabelIndex 1..4', () => {
    expect(buttons(accessory).map(labelIndex)).to.eql([1, 2, 3, 4])
  })

  it('has a ServiceLabel service with arabic numerals', () => {
    const label = findService(accessory, Service.ServiceLabel)
    expect(label).to.be.ok()
    expect(label.getCharacteristic(Characteristic.ServiceLabelNamespace).value)
      .to.be(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS)
  })

  it('names the buttons after the accessory, or the channel name set in the CCU', () => {
    expect(buttons(accessory).map(nameOf)).to.eql([
      'Fernbedienung Flur 1', 'Fernbedienung Flur 2', 'Licht Flur', 'Fernbedienung Flur 4'
    ])
  })

  it('offers single and long press only on every button (there is no double press)', () => {
    buttons(accessory).forEach(service => {
      expect(switchEvent(service).props.validValues).to.eql([SINGLE_PRESS, LONG_PRESS])
      expect(switchEvent(service).props.validValues).not.to.contain(DOUBLE_PRESS)
    })
  })

  it('answers every read with a valid value', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('sends SINGLE_PRESS on the button that was pressed', () => {
    const events = recordEvents(accessory)
    server._ccu.fireEvent(DP(3, 'PRESS_SHORT'), true)
    server._ccu.fireEvent(DP(1, 'PRESS_SHORT'), true)
    server._ccu.fireEvent(DP(4, 'PRESS_SHORT'), true)
    events.stop()
    expect(events.list).to.eql([[3, SINGLE_PRESS], [1, SINGLE_PRESS], [4, SINGLE_PRESS]])
  })

  it('sends one LONG_PRESS per hold (the CCU repeats PRESS_LONG), per button', () => {
    const events = recordEvents(accessory)
    server._ccu.fireEvent(DP(2, 'PRESS_LONG'), true)
    server._ccu.fireEvent(DP(2, 'PRESS_LONG'), true)
    server._ccu.fireEvent(DP(4, 'PRESS_LONG'), true)
    server._ccu.fireEvent(DP(2, 'PRESS_LONG'), true)
    server._ccu.fireEvent(DP(4, 'PRESS_LONG'), true)
    events.stop()
    expect(events.list).to.eql([[2, LONG_PRESS], [4, LONG_PRESS]])
  })

  it('sends LONG_PRESS again after a short press ended the hold', () => {
    const events = recordEvents(accessory)
    server._ccu.fireEvent(DP(2, 'PRESS_SHORT'), true)
    server._ccu.fireEvent(DP(2, 'PRESS_LONG'), true)
    events.stop()
    expect(events.list).to.eql([[2, SINGLE_PRESS], [2, LONG_PRESS]])
  })

  it('sends LONG_PRESS again when the key was released for a while', async function () {
    this.timeout(4000)
    await settle(1200)
    const events = recordEvents(accessory)
    server._ccu.fireEvent(DP(4, 'PRESS_LONG'), true)
    server._ccu.fireEvent(DP(4, 'PRESS_LONG'), true)
    events.stop()
    expect(events.list).to.eql([[4, LONG_PRESS]])
  })

  it('has a battery service', () => {
    expect(findService(accessory, Service.Battery)).to.be.ok()
  })

  it('keeps an identity of its own (no clash with a key accessory of the same name)', () => {
    const HomeMaticKeyAccessory = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticKeyAccessory.js'))
    const channel = server._ccu.getChannelByAddress(KRC4 + ':1')
    const key = new HomeMaticKeyAccessory(channel, 'HmIP', server, { name: 'Fernbedienung Flur' })
    expect(accessory.getUUID()).not.to.be(key.getUUID())
  })
})

describe('HomeKit-CCU remote: HmIP-WRC6 with all key channels in the configuration', () => {
  const WRC6 = '0021DD89A1B2C3'
  let server
  let accessory

  before(async () => {
    // channels 2..6 are listed (e.g. by an older wizard) but have no mapping of their own
    const channels = [1, 2, 3, 4, 5, 6].map(key => WRC6 + ':' + key)
    ;({ server } = await startServer('HmIP-WRC6.json', { values: keyValues(WRC6, 6), config: { channels } }))
    accessory = accessoryAt(server, WRC6 + ':1')
    await settle()
  })

  after(() => shutdown(server))

  it('publishes the remote only, not the other keys as accessories of their own', () => {
    expect(Object.keys(server._publishedAccessories)).to.have.length(1)
    expect(accessory.serviceClass).to.be('HomeMaticRemoteAccessory')
  })

  it('has six buttons with ServiceLabelIndex 1..6 named after the device', () => {
    expect(buttons(accessory).map(labelIndex)).to.eql([1, 2, 3, 4, 5, 6])
    expect(nameOf(buttons(accessory)[5])).to.be('Wandtaster Wohnzimmer 6')
    expect(findService(accessory, Service.ServiceLabel)).to.be.ok()
  })

  it('sends the events of key 6 to button 6', () => {
    const events = recordEvents(accessory)
    server._ccu.fireEvent('HmIP.' + WRC6 + ':6.PRESS_SHORT', true)
    server._ccu.fireEvent('HmIP.' + WRC6 + ':6.PRESS_LONG', true)
    events.stop()
    expect(events.list).to.eql([[6, SINGLE_PRESS], [6, LONG_PRESS]])
  })
})

describe('HomeKit-CCU remote: a key with a mapping of its own next to the remote', () => {
  const KRC4 = '000B1BE9A1B2C3'
  let server

  before(async () => {
    ({ server } = await startServer('HmIP-KRC4.json', {
      values: keyValues(KRC4, 4),
      config: { channels: [KRC4 + ':1', KRC4 + ':2', KRC4 + ':3'] },
      mappings: {
        [KRC4 + ':1']: { Service: 'HomeMaticRemoteAccessory', name: 'Fernbedienung Flur' },
        [KRC4 + ':2']: { Service: 'HomeMaticKeyAccessory', name: 'Taste Zwei' }
      }
    }))
    await settle()
  })

  after(() => shutdown(server))

  it('keeps both, and skips the unmapped key', () => {
    expect(accessoryAt(server, KRC4 + ':1').serviceClass).to.be('HomeMaticRemoteAccessory')
    expect(accessoryAt(server, KRC4 + ':2').serviceClass).to.be('HomeMaticKeyAccessory')
    expect(accessoryAt(server, KRC4 + ':3')).to.be(undefined)
    expect(Object.keys(server._publishedAccessories)).to.have.length(2)
  })
})

describe('HomeKit-CCU remote: unmapped keys with the remote as default service', () => {
  const WRC6 = '0021DD89A1B2C3'
  let server

  before(async () => {
    const channels = [1, 2, 3, 4, 5, 6].map(key => WRC6 + ':' + key)
    ;({ server } = await startServer('HmIP-WRC6.json', { values: keyValues(WRC6, 6), config: { channels }, mappings: {} }))
    await settle()
  })

  after(() => shutdown(server))

  it('publishes one remote for the device, or one key accessory per key', () => {
    const published = Object.values(server._publishedAccessories)
    const remotes = published.filter(accessory => accessory.serviceClass === 'HomeMaticRemoteAccessory')
    expect(remotes.length).to.be.below(2)
    expect(published).to.have.length(remotes.length === 1 ? 1 : 6)
  })
})
