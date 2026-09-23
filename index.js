/*
 * File: index.js
 * Project: homekit-ccu
 * File Created: Saturday, 7th March 2020 12:13:17 pm
 * Author: Thomas Kluge (th.kluge@me.com)
 * -----
 * The MIT License (MIT)
 *
 * Copyright (c) Thomas Kluge <th.kluge@me.com> (https://github.com/thkl)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * ==========================================================================
 */

const path = require('path')
const Server = require(path.join(__dirname, 'lib', 'Server.js'))
const Logger = require(path.join(__dirname, 'lib', 'logger.js'))
const { program } = require('commander')
const os = require('os')
const fs = require('fs')

process.name = 'homekit-ccu'

const log = new Logger('HAP Server')
let configurationPath = path.join('/usr/local/etc/config/addons/', process.name)
let simulation
let dryRun
let logPath
let resetSettings = false
let ccuHost = '127.0.0.1'
let rpcUser
let rpcPass

program
  .name('homekit-ccu')
  .option('-D, --debug', 'turn on debug level logging')
  .option('-C, --configuration <path>', 'set configuration path')
  .option('--reset', 'reset configuration')
  .option('-S, --simulate <path>', 'simulate with a devices file')
  .option('-R, --dryrun', 'only use cached files')
  .option('-L, --log <path>', 'set the path where the log will be created')
  .option('-H, --host <ccuhost>', 'set the host ip for your ccu')
  .option('-U, --user <rpcuser>', 'set the username for XML-RPC basic auth (remote mode)')
  .option('-P, --password <rpcpassword>', 'set the password for XML-RPC basic auth (remote mode)')
  .parse(process.argv)

const opts = program.opts()
if (opts.debug) {
  log.setDebugEnabled(true)
}
if (opts.configuration) {
  configurationPath = opts.configuration
}
if (opts.reset) {
  resetSettings = true
}
if (opts.simulate) {
  console.log('Running a simulation with %s', opts.simulate)
  simulation = opts.simulate
}
if (opts.dryrun) {
  dryRun = true
}
if (opts.log) {
  logPath = opts.log
}
if (opts.host) {
  ccuHost = opts.host
}
if (opts.user) {
  rpcUser = opts.user
}
if (opts.password) {
  rpcPass = opts.password
}

process.on('unhandledRejection', (reason, promise) => {
  log.error('[HAP Server] unhandledRejection: %s', reason && reason.stack ? reason.stack : reason)
  // Do not exit — a Rega timeout or transient error should not crash the server
})

process.on('uncaughtException', (err) => {
  // Write a crashlog
  const fs = require('fs')
  const crashFile = path.join(configurationPath, Date.now() + '.crash')
  let msg = 'Error log : ' + new Date() + '\n\n'
  msg = msg + err.stack
  fs.writeFileSync(crashFile, msg)
  // gracefull shutdown ;o)
  log.error('uncaughtException  log will be found in %s exiting now', crashFile)
  console.log(err.stack)
  log.close()
  process.exit(1) // mandatory (as per the Node docs)
})

try {
  if ((logPath !== undefined) && (fs.existsSync(logPath)) && (fs.accessSync(logPath, fs.constants.W_OK))) {
    log.info('Log into %s /homekit-ccu.log', logPath)
    log.setLogFile(path.join(logPath, 'homekit-ccu.log'))
  } else
    if (fs.existsSync('/var/log') && (fs.accessSync('/var/log', fs.constants.W_OK))) {
      log.info('Log into /var/log/homekit-ccu.log')
      log.setLogFile(path.join('/var/log', 'homekit-ccu.log'))
    } else {
      const tmpDir = fs.realpathSync(os.tmpdir())
      log.info('Log into %s/homekit-ccu.log', tmpDir)
      log.setLogFile(path.join(tmpDir, 'homekit-ccu.log'))
    }
} catch (e) {
  log.error(e)
  log.warn('cannot set persistent file for logger trying temp')
  try {
    const tmpDir = fs.realpathSync(os.tmpdir())
    log.info('Log into %s/homekit-ccu.log', tmpDir)
    log.setLogFile(path.join(tmpDir, 'homekit-ccu.log'))
  } catch (e) {
    log.error(e)
    log.warn('cannot set persistent file for logger into temp. givin up')
  }
}
// check if there is a .hapdebug in /tmp and switch on the debug mode then
const fdebug = path.join(fs.realpathSync(os.tmpdir()), '.hapdebug')
if (fs.existsSync(fdebug)) {
  log.setDebugEnabled(true)
  fs.unlinkSync(fdebug) // remove the flag
}

log.info('---- launching ----')
log.info('Welcome to HAP Homematic. Use your HomeMatic devices in HomeKit')
log.info('(c) 2026 by @britz - https://github.com/britz/homekit-ccu')
log.info('Logging into %s', log.getLogFile())
let server

if (simulation !== undefined) {
  const simPath = path.join(configurationPath, simulation)
  log.warn('Doing a device file simulation with %s', simulation, simPath)
  server = new Server(log)
  server.simulate(simPath)
} else {
  log.debug('Initializing Server')
  server = new Server(log, configurationPath, ccuHost, rpcUser, rpcPass)
  if (resetSettings === true) {
    log.info('---- reset all settings ----')
    server.reset()
    process.exit()
  }
  log.info('Using CCU at %s', ccuHost)
  server.init(dryRun)
}

process.on('SIGTERM', () => {
  server.shutdown()
  log.close()
})

process.on('SIGINT', () => {
  server.shutdown()
  log.close()
})
