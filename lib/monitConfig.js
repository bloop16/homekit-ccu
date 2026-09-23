'use strict'

/*
 * Maintains the monit configuration that restarts homekit-ccu when it dies. All paths are
 * options so the logic can be tested against a scratch directory and a fake monit command.
 */

const fs = require('fs')
const childProcess = require('child_process')

const DEFAULTS = {
  monitBin: '/usr/bin/monit',
  cfgFile: '/usr/local/etc/monit_homekit-ccu.cfg',
  // left behind by the addon before its rename; defines the same service name and
  // makes every "monit reload" fail with "Service name conflict"
  legacyCfgFile: '/usr/local/etc/monit_hap-homematic.cfg',
  pidFile: '/var/run/homekit-ccu.pid',
  rcScript: '/etc/config/rc.d/homekit-ccu',
  serviceName: 'HomekitCCU',
  rpcPort: 9875
}
const RELOAD_TIMEOUT_MS = 30000

const firstLine = (text) => String(text || '').split('\n').map(line => line.trim()).find(line => line.length > 0) || ''

class MonitConfig {
  /**
   * @param {object} log logger with info/warn
   * @param {object} [options] overrides for DEFAULTS (paths, service name, port)
   */
  constructor (log, options = {}) {
    this.log = log
    this.options = { ...DEFAULTS, ...options }
  }

  isAvailable () {
    return fs.existsSync(this.options.monitBin)
  }

  buildConfig () {
    const { serviceName, pidFile, rcScript, rpcPort } = this.options
    return [
      '# homekit-ccu HomeKit engine daemon monitoring',
      `check process ${serviceName} with pidfile ${pidFile}`,
      '    group addons',
      `    start = "${rcScript} start"`,
      `    stop = "${rcScript} stop"`,
      `    restart = "${rcScript} restart"`,
      '    if not exist for 5 cycles then restart',
      `    if failed host '127.0.0.1' port ${rpcPort} protocol http request "/" for 5 cycles then restart`,
      '    if 1 restart within 1 cycles then',
      '      exec "/bin/triggerAlarm.tcl \'homekit-ccu restarted\' WatchDog-Alarm"',
      ''
    ].join('\n')
  }

  /**
   * Writes (or updates) the monit config and reloads monit when something changed.
   * Without a pid file the config is removed instead, so monit does not restart a
   * process that was not started by the rc.d script.
   */
  install () {
    if (!this.isAvailable()) {
      return
    }
    if (!fs.existsSync(this.options.pidFile)) {
      this.remove()
      return
    }
    const removedLegacy = this._removeLegacy()
    const written = this._writeIfChanged()
    if (removedLegacy || written) {
      this.reload()
    }
  }

  /** Removes the monit config (and the stale legacy one) and reloads monit when something changed. */
  remove () {
    if (!this.isAvailable()) {
      return
    }
    const removedLegacy = this._removeLegacy()
    const removed = this._unlink(this.options.cfgFile)
    if (removedLegacy || removed) {
      this.reload()
    }
  }

  /** @returns {boolean} true when monit accepted the reload */
  reload () {
    try {
      childProcess.execFileSync(this.options.monitBin, ['reload'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: RELOAD_TIMEOUT_MS
      })
      return true
    } catch (e) {
      this.log.warn('[CCU] monit reload failed: %s', firstLine(e.stderr) || firstLine(e.message))
      return false
    }
  }

  _writeIfChanged () {
    const config = this.buildConfig()
    const { cfgFile } = this.options
    try {
      if (fs.existsSync(cfgFile) && fs.readFileSync(cfgFile, 'utf8') === config) {
        return false
      }
      this.log.info('[CCU] writing monit config %s', cfgFile)
      fs.writeFileSync(cfgFile, config)
      return true
    } catch (e) {
      this.log.warn('[CCU] unable to write monit config %s: %s', cfgFile, e.message)
      return false
    }
  }

  _removeLegacy () {
    const removed = this._unlink(this.options.legacyCfgFile)
    if (removed) {
      this.log.info('[CCU] removed stale hap-homematic monit config %s', this.options.legacyCfgFile)
    }
    return removed
  }

  _unlink (file) {
    try {
      if (!fs.existsSync(file)) {
        return false
      }
      fs.unlinkSync(file)
      return true
    } catch (e) {
      this.log.warn('[CCU] unable to remove %s: %s', file, e.message)
      return false
    }
  }
}

module.exports = MonitConfig
