'use strict'

// A reload of the configuration must not restart bridges whose identity is unchanged:
// a restart breaks a pairing that is going on and makes every bridge disappear for a moment.

const path = require('path')
const expect = require('expect.js')
const { Bridge, Accessory, Service, uuid } = require('@homebridge/hap-nodejs')
const { bridgeIdentity, swapBridgedAccessories } = require(path.join(__dirname, '..', 'lib', 'util', 'bridgeReuse.js'))

function accessory (name) {
  const a = new Accessory(name, uuid.generate('reuse test ' + name))
  a.addService(Service.Switch, name)
  return a
}

describe('HomeKit-CCU bridge reuse', () => {
  it('derives the identity from what a bridge is published with', () => {
    const base = { name: 'HomeKit-CCU Küche', username: '12:34:56:BA:7B:5A', pincode: '031-45-154', setupID: 'AB12' }
    expect(bridgeIdentity(base)).to.be(bridgeIdentity(Object.assign({}, base)))
    ;['name', 'username', 'pincode', 'setupID'].forEach(key => {
      expect(bridgeIdentity(Object.assign({}, base, { [key]: 'other' }))).not.to.be(bridgeIdentity(base))
    })
  })

  it('swaps the bridged accessories in one step with one configuration update', () => {
    const bridge = new Bridge('HomeKit-CCU Test', uuid.generate('reuse test bridge'))
    const oldA = accessory('Switch A')
    bridge.addBridgedAccessory(oldA)
    let updates = 0
    bridge.enqueueConfigurationUpdate = () => { updates++ }

    const newA = accessory('Switch A')
    const newB = accessory('Switch B')
    swapBridgedAccessories(bridge, [newA, newB])

    expect(bridge.bridgedAccessories).to.eql([newA, newB])
    expect(oldA.bridge).to.be(undefined)
    expect(updates).to.be(1)
  })

  it('empties a bridge whose devices were all removed', () => {
    const bridge = new Bridge('HomeKit-CCU Test', uuid.generate('reuse test bridge 2'))
    bridge.addBridgedAccessory(accessory('Switch A'))
    let updates = 0
    bridge.enqueueConfigurationUpdate = () => { updates++ }
    swapBridgedAccessories(bridge, [])
    expect(bridge.bridgedAccessories).to.eql([])
    expect(updates).to.be(1)
  })

  it('does nothing for a bridge without devices before and after', () => {
    const bridge = new Bridge('HomeKit-CCU Test', uuid.generate('reuse test bridge 3'))
    let updates = 0
    bridge.enqueueConfigurationUpdate = () => { updates++ }
    swapBridgedAccessories(bridge, [])
    expect(updates).to.be(0)
  })

  it('does not keep the controller storage of replaced accessories', () => {
    const bridge = new Bridge('HomeKit-CCU Test', uuid.generate('reuse test bridge 4'))
    bridge.addBridgedAccessory(accessory('Switch A'))
    const linked = () => bridge.controllerStorage.linkedAccessories.length
    expect(linked()).to.be(1)
    for (let i = 0; i < 3; i++) {
      swapBridgedAccessories(bridge, [accessory('Switch A')])
    }
    expect(linked()).to.be(1)
    expect(bridge.controllerStorage.linkedAccessories[0]).to.be(bridge.bridgedAccessories[0].controllerStorage)
  })
})
