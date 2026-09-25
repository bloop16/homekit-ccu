'use strict'

/*
 * When a doorbell rings. A key datapoint (PRESS_SHORT, PRESS_LONG, PRESS) rings with every event:
 * the CCU delivers no start value for it. A state datapoint (STATE of a contact, or of a doorbell
 * sensor switched to contact mode) rings when it becomes active; its first value is the start
 * value. Rings closer than RING_GAP_MS count once: the CCU repeats PRESS_LONG while a key is held,
 * and a bell voltage may bounce.
 */

const RING_GAP_MS = 3000

/** true for an active state: true, 'true' or a number above 0 (an open contact is 1 or 2) */
function isActive (value) {
  if ((value === true) || (value === 'true')) {
    return true
  }
  const number = (typeof value === 'number') ? value : ((typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN)
  return Number.isFinite(number) && number > 0
}

/**
 * @param {{isAction: boolean, ring: function, now?: function}} options
 * @returns {function} event listener for the datapoint
 */
function createRingTrigger ({ isAction, ring, now = Date.now }) {
  let lastRing
  let startValue = !isAction
  let wasActive = false
  const ringOnce = () => {
    const time = now()
    if ((lastRing === undefined) || (time - lastRing >= RING_GAP_MS)) {
      lastRing = time
      ring()
    }
  }
  return (value) => {
    if (isAction) {
      ringOnce()
      return
    }
    const active = isActive(value)
    if (!startValue && active && !wasActive) {
      ringOnce()
    }
    startValue = false
    wasActive = active
  }
}

module.exports = { createRingTrigger, isActive, RING_GAP_MS }
