const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, settle } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

const { SINGLE_PRESS, LONG_PRESS } = Characteristic.ProgrammableSwitchEvent

function buttons (accessory) {
  return accessory.getHomeKitAccessory().services
    .filter(service => service.UUID === Service.StatelessProgrammableSwitch.UUID)
}

const labelIndex = (service) => service.getCharacteristic(Characteristic.ServiceLabelIndex).value
const switchEvent = (service) => service.getCharacteristic(Characteristic.ProgrammableSwitchEvent)

function recordEvents (accessory) {
  const list = []
  const removers = buttons(accessory).map(service => {
    const listener = (change) => list.push([labelIndex(service), change.newValue])
    switchEvent(service).on('change', listener)
    return () => switchEvent(service).removeListener('change', listener)
  })
  return { list, stop: () => removers.forEach(remove => remove()) }
}

describe('HomeKit-CCU remote: HM-PB-2-WM55 as one accessory', () => {
  const PB2 = 'NEQ1234567'
  const DP = (key, name) => 'BidCos-RF.' + PB2 + ':' + key + '.' + name
  let server
  let accessory

  before(async () => {
    const values = { ['BidCos-RF.' + PB2 + ':0.LOWBAT']: false }
    ;[1, 2].forEach(key => {
      ['PRESS_SHORT', 'PRESS_LONG', 'PRESS_LONG_RELEASE', 'PRESS_CONT'].forEach(dp => { values[DP(key, dp)] = false })
    })
    ;({ server } = await startServer('HM-PB-2-WM55.json', { values }))
    accessory = accessoryAt(server, PB2 + ':1')
    await settle()
  })

  after(() => shutdown(server))

  it('is one accessory with two buttons and a ServiceLabel', () => {
    expect(Object.keys(server._publishedAccessories)).to.have.length(1)
    expect(accessory.serviceClass).to.be('HomeMaticRemoteAccessory')
    expect(buttons(accessory).map(labelIndex)).to.eql([1, 2])
    expect(buttons(accessory).map(service => service.getCharacteristic(Characteristic.Name).value))
      .to.eql(['Taster Bad 1', 'Taster Bad 2'])
    expect(findService(accessory, Service.ServiceLabel)).to.be.ok()
  })

  it('answers every read with a valid value', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('sends SINGLE_PRESS per button', () => {
    const events = recordEvents(accessory)
    server._ccu.fireEvent(DP(2, 'PRESS_SHORT'), true)
    server._ccu.fireEvent(DP(1, 'PRESS_SHORT'), true)
    events.stop()
    expect(events.list).to.eql([[2, SINGLE_PRESS], [1, SINGLE_PRESS]])
  })

  it('sends one LONG_PRESS per hold and a new one after PRESS_LONG_RELEASE', () => {
    const events = recordEvents(accessory)
    server._ccu.fireEvent(DP(1, 'PRESS_LONG'), true)
    server._ccu.fireEvent(DP(1, 'PRESS_CONT'), true)
    server._ccu.fireEvent(DP(1, 'PRESS_LONG'), true)
    server._ccu.fireEvent(DP(1, 'PRESS_LONG_RELEASE'), true)
    server._ccu.fireEvent(DP(1, 'PRESS_LONG'), true)
    events.stop()
    expect(events.list).to.eql([[1, LONG_PRESS], [1, LONG_PRESS]])
  })

  it('shows the battery state (LOWBAT)', () => {
    expect(findService(accessory, Service.Battery)).to.be.ok()
  })
})
