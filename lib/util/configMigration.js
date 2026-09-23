'use strict'

/**
 * Version of the config.json schema written by this release (top-level `configVersion`).
 * 2: the configuration UI requires a CCU administrator session unless
 *    `useCCCAuthentication` is false. hap-homematic wrote `false` as its local-mode default,
 *    so a config without a version never carries a conscious choice.
 */
const CONFIG_VERSION = 2

const isCurrent = (config) => {
  const version = Number(config.configVersion)
  return Number.isFinite(version) && version >= CONFIG_VERSION
}

/**
 * Brings a config without `configVersion` (or with an older one) to version 2: turns the
 * session check on regardless of the stored value.
 * @param {object} config parsed config.json (not modified)
 * @returns {{config: object, upgraded: boolean}} a new config when upgraded, otherwise the input
 */
function upgradeConfigVersion (config) {
  if (isCurrent(config)) {
    return { config, upgraded: false }
  }
  return {
    config: { ...config, useCCCAuthentication: true, configVersion: CONFIG_VERSION },
    upgraded: true
  }
}

module.exports = { CONFIG_VERSION, upgradeConfigVersion }
