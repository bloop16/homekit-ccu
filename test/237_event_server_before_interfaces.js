'use strict'

// The interfaces were registered at the CCU without waiting for the event server: the CCU could
// call back before the server listened, and when its port was in use the add-on ran without any
// events from the CCU, with only an error in the log (and an unhandled rejection).

const path = require('path')
const EventEmitter = require('events')
const expect = require('expect.js')
const HomeMaticCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticCCU.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

describe('HomeKit-CCU event server before the interfaces', () => {
  let ccu
  let rpc
  let log

  // the answers of rpc.init in turn: true listens, an Error fails, a function is called with resolve
  const ccuWithServer = (answers) => {
    log = recordingLog()
    ccu = new HomeMaticCCU(log, { storagePath: '/tmp', interfaceWatchdog: 300 })
    ccu.interfaces = {}
    rpc = new EventEmitter()
    rpc.connects = 0
    rpc.inits = 0
    rpc.connect = () => { rpc.connects++ }
    rpc.disconnectInterfaces = async () => {}
    rpc.resetInterfaces = () => {}
    rpc.init = () => {
      const answer = answers[rpc.inits++]
      if (answer instanceof Error) {
        return Promise.reject(answer)
      }
      return new Promise(resolve => (typeof answer === 'function') ? answer(resolve) : resolve())
    }
    ccu.rpc = rpc
    ccu.eventServer = rpc.init()
  }

  afterEach(async () => {
    await ccu.disconnectInterfaces()
  })

  it('registers the interfaces only once the event server listens', async () => {
    let listen
    ccuWithServer([(resolve) => { listen = resolve }])
    const prepared = ccu.prepareInterfaces()
    await wait(5)
    expect(rpc.connects).to.be(0)
    listen()
    await prepared
    expect(rpc.connects).to.be(1)
  })

  it('tries the event server again when its port is in use, then registers the interfaces', async () => {
    ccuWithServer([new Error('port in use error'), new Error('port in use error'), true])
    ccu.eventServerRetryDelay = 10
    await ccu.prepareInterfaces()
    expect(rpc.connects).to.be(0)
    expect(log.text('error')).to.contain('no event server (port in use error)')
    await wait(60)
    expect(rpc.inits).to.be(3)
    expect(rpc.connects).to.be(1)
    expect(ccu.eventServerRetryDelay).to.be(undefined)
  })

  it('stops trying when the interfaces are disconnected', async () => {
    ccuWithServer([new Error('port in use error'), true])
    ccu.eventServerRetryDelay = 10
    await ccu.prepareInterfaces()
    await ccu.disconnectInterfaces()
    await wait(30)
    expect(rpc.inits).to.be(1)
    expect(rpc.connects).to.be(0)
  })
})
