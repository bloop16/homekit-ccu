'use strict'

// Every reload of the settings ran prepareInterfaces again, which adds a listener for the events and
// one for 'newDevices' of the CCU; disconnecting the interfaces removed only the event listeners.
// After N reloads, one 'newDevices' message of the CCU started N refreshes of the device database.

const path = require('path')
const EventEmitter = require('events')
const expect = require('expect.js')
const HomeMaticCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticCCU.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))

describe('HomeKit-CCU RPC listeners per reload', () => {
  let ccu
  let refreshes

  beforeEach(() => {
    ccu = new HomeMaticCCU(recordingLog(), { storagePath: '/tmp', interfaceWatchdog: 300 })
    ccu.interfaces = {}
    const rpc = new EventEmitter()
    rpc.init = async () => {}
    rpc.connect = () => {}
    rpc.disconnectInterfaces = async () => {}
    rpc.resetInterfaces = () => {}
    ccu.rpc = rpc
    refreshes = 0
    ccu.updateDeviceDatabase = () => { refreshes++ }
  })

  afterEach(async () => {
    await ccu.disconnectInterfaces()
  })

  it('refreshes the device database once per newDevices message after reloads', async () => {
    await ccu.prepareInterfaces()
    for (let reload = 0; reload < 3; reload++) {
      await ccu.disconnectInterfaces()
      await ccu.prepareInterfaces()
    }
    expect(ccu.rpc.listenerCount('event')).to.be(1)
    expect(ccu.rpc.listenerCount('newDevices')).to.be(1)
    ccu.rpc.emit('newDevices', {})
    expect(refreshes).to.be(1)
  })
})
