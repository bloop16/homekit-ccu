'use strict'

// When a doorbell rings: a key datapoint (PRESS_SHORT, PRESS_LONG, PRESS) rings with every event,
// a state datapoint (STATE of a contact or of a doorbell sensor in contact mode) when it becomes
// active; its first value is the start value. Rings closer than 3 s count once: the CCU repeats
// PRESS_LONG while the bell button is held, and a bell voltage may bounce.

const path = require('path')
const expect = require('expect.js')
const { createRingTrigger, isActive } = require(path.join(__dirname, '..', 'lib', 'util', 'doorbellTrigger.js'))

function trigger (isAction) {
  let now = 1000
  const rings = []
  const listener = createRingTrigger({ isAction, ring: () => rings.push(now), now: () => now })
  return { listener, rings, later: (ms) => { now += ms } }
}

describe('HomeKit-CCU doorbell trigger', () => {
  it('rings with every press of a key datapoint', () => {
    const t = trigger(true)
    t.listener(true)
    t.later(5000)
    t.listener(true)
    expect(t.rings.length).to.be(2)
  })

  it('counts presses closer than 3 s as one ring', () => {
    const t = trigger(true)
    t.listener(true)
    t.later(400)
    t.listener(true)
    t.later(400)
    t.listener(true)
    expect(t.rings.length).to.be(1)
    t.later(3000)
    t.listener(true)
    expect(t.rings.length).to.be(2)
  })

  it('rings when a state becomes active, not for its start value', () => {
    const t = trigger(false)
    t.listener(true) // start value: active already, no ring
    expect(t.rings.length).to.be(0)
    t.later(5000)
    t.listener(false)
    t.listener(true)
    expect(t.rings.length).to.be(1)
    t.later(5000)
    t.listener(true) // still active: no new ring
    expect(t.rings.length).to.be(1)
    t.listener(false)
    expect(t.rings.length).to.be(1)
  })

  it('knows the active values of the CCU', () => {
    expect([true, 'true', 1, '1', 2, '2'].every(isActive)).to.be(true)
    expect([false, 'false', 0, '0', '', undefined, null, 'x'].some(isActive)).to.be(false)
  })
})
