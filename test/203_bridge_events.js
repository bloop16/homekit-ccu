'use strict'

const path = require('path')
const EventEmitter = require('events')
const expect = require('expect.js')
const { Bridge, Accessory, Service, Characteristic, uuid } = require('@homebridge/hap-nodejs')
const { attachBridgeLogging } = require(path.join(__dirname, '..', 'lib', 'util', 'bridgeEvents.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))

describe('HomeKit-CCU bridge pairing log', () => {
  it('logs pairing and unpairing', () => {
    const log = recordingLog()
    const bridge = new EventEmitter()
    attachBridgeLogging(bridge, 'HomeKit-CCU Küche', log)
    bridge.emit('paired')
    bridge.emit('unpaired')
    expect(log.text('info')).to.contain('HomeKit-CCU Küche was paired')
    expect(log.text('info')).to.contain('HomeKit-CCU Küche was unpaired')
  })

  it('logs problems as warning and slow reads only for debugging', () => {
    const log = recordingLog()
    const bridge = new EventEmitter()
    attachBridgeLogging(bridge, 'HomeKit-CCU Küche', log)
    bridge.emit('characteristic-warning', { type: 'warn-message', message: 'value 120 exceeds maximum 100', originatorChain: ['Rollo Küche', 'Current Position'] })
    bridge.emit('characteristic-warning', { type: 'slow-read', message: 'slow to respond', originatorChain: ['Licht Küche', 'On'] })
    expect(log.text('warn')).to.contain('Rollo Küche > Current Position: value 120 exceeds maximum 100')
    expect(log.text('warn')).not.to.contain('slow to respond')
    expect(log.text('debug')).to.contain('Licht Küche > On: slow to respond')
  })

  it('receives the warnings of bridged accessories from hap-nodejs', () => {
    const log = recordingLog()
    const bridge = new Bridge('HomeKit-CCU Test', uuid.generate('bridge events test'))
    attachBridgeLogging(bridge, 'HomeKit-CCU Test', log)
    const accessory = new Accessory('Rollo', uuid.generate('bridge events test rollo'))
    const service = accessory.addService(Service.WindowCovering, 'Rollo')
    bridge.addBridgedAccessory(accessory)
    service.getCharacteristic(Characteristic.CurrentPosition).updateValue(120)
    expect(log.text('warn')).to.contain('HomeKit-CCU Test')
    expect(log.text('warn')).to.contain('Rollo')
  })

  it('logs the same warning at most once a minute', () => {
    const log = recordingLog()
    const bridge = new EventEmitter()
    let time = 0
    attachBridgeLogging(bridge, 'HomeKit-CCU Küche', log, () => time)
    const timeout = { type: 'timeout-read', message: 'read timed out', originatorChain: ['Licht Küche', 'On'] }
    bridge.emit('characteristic-warning', timeout)
    time = 30000
    bridge.emit('characteristic-warning', timeout)
    bridge.emit('characteristic-warning', { type: 'timeout-read', message: 'read timed out', originatorChain: ['Rollo Küche', 'Current Position'] })
    time = 61000
    bridge.emit('characteristic-warning', timeout)
    expect(log.lines.filter(l => l.level === 'warn').length).to.be(3)
  })
})
