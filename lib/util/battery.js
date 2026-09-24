'use strict'

/*
 * Battery level from the operating voltage. The service settings give the nominal voltage in
 * 1.2 V steps per cell (2.4 = two cells). A cell counts as full at 1.5 V and as empty at 1.1 V,
 * which is where HomeMatic IP devices report LOW_BAT.
 */

const NOMINAL_PER_CELL = 1.2
const FULL_PER_CELL = 1.5
const EMPTY_PER_CELL = 1.1

function batteryPercent (voltage, nominalVoltage) {
  const volts = parseFloat(voltage)
  const nominal = parseFloat(nominalVoltage)
  if (!Number.isFinite(volts) || !Number.isFinite(nominal) || nominal <= 0) return undefined
  const cells = Math.max(1, Math.round(nominal / NOMINAL_PER_CELL))
  const full = cells * FULL_PER_CELL
  const empty = cells * EMPTY_PER_CELL
  const percent = Math.round((volts - empty) / (full - empty) * 100)
  return Math.min(100, Math.max(0, percent))
}

module.exports = { batteryPercent }
