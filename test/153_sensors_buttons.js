const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { startServer, accessoryAt, shutdown, readAll, findService, settle } = require(path.join(__dirname, 'helpers', 'sensorsHap.js'))

const { SINGLE_PRESS, DOUBLE_PRESS, LONG_PRESS } = Characteristic.ProgrammableSwitchEvent

// records the ProgrammableSwitchEvent values HomeKit gets notified about
function recordEvents (characteristic) {
  const list = []
  const listener = (change) => list.push(change.newValue)
  characteristic.on('change', listener)
  return { list, stop: () => characteristic.removeListener('change', listener) }
}

describe('HomeKit-CCU sensors: HmIP-KRCA remote key', () => {
  const KRCA = '4436784678ABCD'
  const DP = (name) => 'HmIP.' + KRCA + ':1.' + name
  let server
  let accessory
  let keyEvent

  before(async () => {
    ({ server } = await startServer('HmIP-KRCA.json', {
      values: {
        [DP('PRESS_SHORT')]: false,
        [DP('PRESS_LONG')]: false,
        [DP('PRESS_LONG_RELEASE')]: false,
        ['HmIP.' + KRCA + ':0.LOW_BAT']: false
      }
    }))
    accessory = accessoryAt(server, KRCA + ':1')
    await settle()
    keyEvent = findService(accessory, Service.StatelessProgrammableSwitch).getCharacteristic(Characteristic.ProgrammableSwitchEvent)
  })

  after(() => shutdown(server))

  it('offers single and long press only (there is no double press)', () => {
    expect(keyEvent.props.validValues).to.eql([SINGLE_PRESS, LONG_PRESS])
    expect(keyEvent.props.validValues).not.to.contain(DOUBLE_PRESS)
  })

  it('answers every read with a valid value', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('sends SINGLE_PRESS for PRESS_SHORT', () => {
    const events = recordEvents(keyEvent)
    server._ccu.fireEvent(DP('PRESS_SHORT'), true)
    server._ccu.fireEvent(DP('PRESS_SHORT'), true)
    events.stop()
    expect(events.list).to.eql([SINGLE_PRESS, SINGLE_PRESS])
  })

  it('sends one LONG_PRESS while the key is held (the CCU repeats PRESS_LONG)', () => {
    const events = recordEvents(keyEvent)
    server._ccu.fireEvent(DP('PRESS_LONG'), true)
    server._ccu.fireEvent(DP('PRESS_LONG'), true)
    server._ccu.fireEvent(DP('PRESS_LONG'), true)
    server._ccu.fireEvent(DP('PRESS_LONG_RELEASE'), true)
    events.stop()
    expect(events.list).to.eql([LONG_PRESS])
  })

  it('sends LONG_PRESS again for the next hold', () => {
    const events = recordEvents(keyEvent)
    server._ccu.fireEvent(DP('PRESS_LONG'), true)
    server._ccu.fireEvent(DP('PRESS_LONG'), true)
    server._ccu.fireEvent(DP('PRESS_LONG_RELEASE'), true)
    server._ccu.fireEvent(DP('PRESS_SHORT'), true)
    server._ccu.fireEvent(DP('PRESS_LONG'), true)
    events.stop()
    expect(events.list).to.eql([LONG_PRESS, SINGLE_PRESS, LONG_PRESS])
  })

  it('has a battery service', () => {
    expect(findService(accessory, Service.Battery)).to.be.ok()
  })
})

describe('HomeKit-CCU sensors: HmIP-DSD-PCB doorbell button', () => {
  const DSD = '0002DD89A1B2C3'
  const DP = (name) => 'HmIP.' + DSD + ':1.' + name
  let server
  let accessory

  before(async () => {
    // no stored mapping: the channel gets its default service
    ({ server } = await startServer('HmIP-DSD-PCB.json', {
      mappings: {},
      values: {
        [DP('PRESS_SHORT')]: false,
        [DP('PRESS_LONG')]: false
      }
    }))
    accessory = accessoryAt(server, DSD + ':1')
    await settle()
  })

  after(() => shutdown(server))

  // Apple Home shows a Doorbell service without a camera as "not supported"
  it('is a programmable switch by default, no Doorbell service', () => {
    expect(accessory.serviceClass).to.be('HomeMaticKeyAccessory')
    expect(findService(accessory, Service.StatelessProgrammableSwitch)).to.be.ok()
    expect(findService(accessory, Service.Doorbell)).to.not.be.ok()
  })

  it('reports a ring as a single press', () => {
    const button = findService(accessory, Service.StatelessProgrammableSwitch).getCharacteristic(Characteristic.ProgrammableSwitchEvent)
    const events = recordEvents(button)
    server._ccu.fireEvent(DP('PRESS_SHORT'), true)
    events.stop()
    expect(events.list).to.eql([SINGLE_PRESS])
  })
})

describe('HomeKit-CCU sensors: HmIP-DSD-PCB as Doorbell service', () => {
  const DSD = '0002DD89A1B2C3'
  const DP = (name) => 'HmIP.' + DSD + ':1.' + name
  let server
  let accessory
  let ring

  before(async () => {
    ({ server } = await startServer('HmIP-DSD-PCB.json', {
      mappings: { [DSD + ':1']: { Service: 'HomeMaticDoorBellAccessory' } },
      values: {
        [DP('PRESS_SHORT')]: false,
        [DP('PRESS_LONG')]: false
      }
    }))
    accessory = accessoryAt(server, DSD + ':1')
    await settle()
    ring = findService(accessory, Service.Doorbell).getCharacteristic(Characteristic.ProgrammableSwitchEvent)
  })

  after(() => shutdown(server))

  it('is a Doorbell that only knows SINGLE_PRESS', () => {
    expect(accessory.serviceClass).to.be('HomeMaticDoorBellAccessory')
    expect(ring.props.validValues).to.eql([SINGLE_PRESS])
  })

  it('answers every read with a valid value', async () => {
    expect(await readAll(accessory)).to.eql([])
  })

  it('rings on every PRESS_SHORT', () => {
    const events = recordEvents(ring)
    server._ccu.fireEvent(DP('PRESS_SHORT'), true)
    server._ccu.fireEvent(DP('PRESS_SHORT'), true)
    events.stop()
    expect(events.list).to.eql([SINGLE_PRESS, SINGLE_PRESS])
  })
})

describe('HomeKit-CCU sensors: key press switch (HomeMaticPushTheButtonAccessory)', () => {
  const KRCA = '4436784678ABCD'
  let server
  let accessory

  before(async () => {
    ({ server } = await startServer('HmIP-KRCA.json', {
      mappings: { [KRCA + ':1']: { Service: 'HomeMaticPushTheButtonAccessory', settings: { evntType: 'BOTH' } } }
    }))
    accessory = accessoryAt(server, KRCA + ':1')
  })

  after(() => shutdown(server))

  it('offers a switch for the short and one for the long press', () => {
    const names = accessory.getHomeKitAccessory().services
      .filter(service => service.UUID === Service.Switch.UUID)
      .map(service => service.getCharacteristic(Characteristic.Name).value)
    expect(names).to.eql([accessory.getName() + ' Short', accessory.getName() + ' Long'])
  })

  it('presses the key when switched on', async () => {
    const short = findService(accessory, Service.Switch, '_Short')
    delete server._ccu.dummyValues['HmIP.' + KRCA + ':1.PRESS_SHORT']
    await short.getCharacteristic(Characteristic.On).handleSetRequest(true)
    expect(server._ccu.dummyValues['HmIP.' + KRCA + ':1.PRESS_SHORT']).to.be(true)
  })

  it('does not press the key when HomeKit switches it off', async () => {
    const long = findService(accessory, Service.Switch, '_Long')
    delete server._ccu.dummyValues['HmIP.' + KRCA + ':1.PRESS_LONG']
    await long.getCharacteristic(Characteristic.On).handleSetRequest(false)
    expect(server._ccu.dummyValues['HmIP.' + KRCA + ':1.PRESS_LONG']).to.be(undefined)
  })
})
