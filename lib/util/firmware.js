'use strict'

// HomeKit expects FirmwareRevision as x[.y[.z]] with plain numbers
function hapFirmwareRevision (value) {
  if ((value === undefined) || (value === null)) return undefined
  const match = String(value).match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return undefined
  return match.slice(1).filter(part => part !== undefined).join('.')
}

module.exports = { hapFirmwareRevision }
