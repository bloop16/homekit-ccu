const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, settle } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))
const { coveringAddress, combinedChannelsOf } = require(path.join(__dirname, '..', 'lib', 'util', 'combinedChannels.js'))

const IO = '2752767911ABCD'
const DP = (channel, name) => 'BidCos-Wir.' + IO + ':' + channel + '.' + name
const switches = (accessory) => accessory.getHomeKitAccessory().services.filter(service => service.UUID === Service.Switch.UUID)

describe('HomeKit-CCU combined switch outputs', () => {
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HMW-IO-12-Sw14-DR.json', {
      config: { channels: [IO + ':1', IO + ':2'] },
      mappings: { [IO + ':1']: { name: 'Verteiler', Service: 'HomeMaticSwitchAccessory', settings: { Type: 'Switch', channels: [IO + ':2', IO + ':3', 'OTHER:1', IO + ':1'] } } },
      values: { [DP(1, 'STATE')]: false, [DP(2, 'STATE')]: false, [DP(3, 'STATE')]: true }
    }))
    accessory = accessoryAt(server, IO + ':1')
    await settle()
  })

  after(() => shutdown(server))

  it('is one accessory with a switch per output, the first one primary', () => {
    const list = switches(accessory)
    expect(list.map(service => service.subtype)).to.eql([undefined, IO + ':2', IO + ':3'].map(subtype => subtype || list[0].subtype))
    expect(list[0].isPrimaryService).to.be(true)
    expect(list.map(service => service.getCharacteristic(Characteristic.Name).value)).to.eql(['Verteiler', 'Verteiler 2', 'Verteiler 3'])
  })

  it('ignores channels of other devices and its own channel in the list', () => {
    expect(switches(accessory)).to.have.length(3)
  })

  it('publishes no accessory of its own for a combined output', () => {
    expect(accessoryAt(server, IO + ':2')).to.be(undefined)
  })

  it('switches and reports every output on its own channel', async () => {
    const third = switches(accessory)[2].getCharacteristic(Characteristic.On)
    await third.handleSetRequest(false)
    expect(server._ccu.dummyValues[DP(3, 'STATE')]).to.be(0)
    server._ccu.fireEvent(DP(2, 'STATE'), true)
    expect(switches(accessory)[1].getCharacteristic(Characteristic.On).value).to.be(true)
    expect(switches(accessory)[0].getCharacteristic(Characteristic.On).value).to.be(false)
  })

  it('answers every read with a valid value', async () => {
    expect(await readAll(accessory)).to.eql([])
  })
})

describe('HomeKit-CCU combined channels: coverage', () => {
  const mappings = {
    'A:1': { Service: 'HomeMaticSwitchAccessory', settings: { channels: ['A:2', 'A:3'] } },
    'K:1': { Service: 'HomeMaticRemoteAccessory' },
    'B:1': { Service: 'HomeMaticSwitchAccessory', settings: { channels: 'A:4' } }
  }

  it('finds the accessory holding a channel', () => {
    expect(coveringAddress(mappings, { address: 'A:2', type: 'SWITCH' })).to.be('A:1')
    expect(coveringAddress(mappings, { address: 'K:3', type: 'KEY_TRANSCEIVER' })).to.be('K:1')
    expect(coveringAddress(mappings, { address: 'A:1', type: 'SWITCH' })).to.be(undefined)
    expect(coveringAddress(mappings, { address: 'A:4', type: 'SWITCH' })).to.be(undefined)
    expect(coveringAddress(undefined, { address: 'A:2' })).to.be(undefined)
    expect(coveringAddress(mappings, undefined)).to.be(undefined)
  })

  it('reads only a list of addresses as combined channels', () => {
    expect(combinedChannelsOf(mappings['A:1'])).to.eql(['A:2', 'A:3'])
    expect(combinedChannelsOf(mappings['B:1'])).to.eql([])
    expect(combinedChannelsOf(undefined)).to.eql([])
  })
})
