/*
 * File: HomeMaticRPC.js
 * Project: homekit-ccu
 * File Created: Saturday, 7th March 2020 9:01:46 pm
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

'use strict'

const xmlrpc = require('homematic-xmlrpc')
const binrpc = require('binrpc')
const EventEmitter = require('events')

// CUxD calls back (listDevices, ...) before it answers init; that often takes longer than binrpc's default of 5 s.
// Only init and its reverse wait that long: they have a connection of their own, so a late answer never
// ends up as the answer to the next command and commands are not held up behind it.
const CUXD_INIT_TIMEOUT = 30000
const net = require('net')
const dns = require('dns').promises

class HomeMaticRPCClient {
  constructor (ifName, sysID, hostIP, hostPort, path, log, credentials) {
    this.log = log
    this.port = hostPort
    this.host = hostIP
    this.ifName = ifName
    this.sysID = sysID
    this.isRunning = false

    if (this.ifName.indexOf('CUxD') > -1) {
      this.log.debug('[RPC] CuxD Extra ....')
      this.client = binrpc.createClient({
        host: hostIP,
        port: hostPort,
        path,
        queueMaxLength: 100
      })
      this.initClient = binrpc.createClient({
        host: hostIP,
        port: hostPort,
        path,
        responseTimeout: CUXD_INIT_TIMEOUT
      })
      this.protocol = 'xmlrpc_bin://'
    } else {
      const clientOptions = {
        host: hostIP,
        port: hostPort,
        path,
        queueMaxLength: 100
      }
      if (credentials) {
        clientOptions.basic_auth = credentials
      }
      this.client = xmlrpc.createClient(clientOptions)
      this.initClient = this.client
      this.protocol = 'http://'
    }
  }

  // BIN-RPC clients keep their connection and reconnect until they are closed
  close () {
    new Set([this.client, this.initClient]).forEach(client => {
      if (client && (typeof client.close === 'function')) {
        client.close()
      }
    })
  }

  init (localIP, listeningPort) {
    const self = this
    this.localIP = localIP
    this.listeningPort = listeningPort
    this.log.debug('[RPC] CCU RPC Init Call on %s port %s for interface %s local server port %s', this.host, this.port, this.ifName, listeningPort)
    const command = this.protocol + this.localIP + ':' + this.listeningPort
    this.ifId = this.sysID + '_' + this.ifName
    this.log.debug('[RPC] init parameter is %s %s', command, this.ifId)
    try {
      this.initClient.methodCall('init', [command, this.ifId], (error, value) => {
        self.reconnecting = false
        if (error) {
          self.log.error('[RPC] FAILED to register callback at %s:%s for %s — Error: %s', self.host, self.port, self.ifName, error)
        } else {
          self.log.debug('[RPC] CCU Response for init at %s with command %s,%s ...Value (%s)', self.ifName, command, self.ifId, JSON.stringify(value))
          self.ping()
          self.markConnected('is connected')
        }
      })
    } catch (e) {
      self.reconnecting = false
      self.log.error('[RPC] Exception during init for %s: %s', self.ifName, e)
    }
  }

  // the first connection of an interface goes into the log once; the reconnects of the watchdog
  // (an interface without events for a while) do not
  markConnected (how) {
    this.isRunning = true
    if (this.announced !== true) {
      this.announced = true
      this.log.info('[RPC] interface %s %s', this.ifName, how)
    }
  }

  stop () {
    const self = this
    return new Promise((resolve, reject) => {
      self.log.debug('[RPC] disconnecting interface %s', self.ifName)
      try {
        self.initClient.methodCall('init', [self.protocol + self.localIP + ':' + self.listeningPort], (error, value) => {
          self.isRunning = false
          if ((error !== undefined) && (error !== null)) {
            self.log.error('[RPC] Error while disconnecting interface %s Error : %s', self.ifName, error)
            reject(error)
          } else {
            self.log.debug('[RPC] interface %s disconnected', self.ifName)
            resolve()
          }
        })
      } catch (e) {
        resolve()
      }
    })
  }

  sendRPCommand (command, parameters, logErrors = true) {
    const self = this
    return new Promise((resolve, reject) => {
      self.client.methodCall(command, parameters, (error, value) => {
        if (error) {
          if (logErrors) self.log.error('[RPC] Error while sending command %s to interface %s Error : %s', command, self.ifName, error)
          reject(error)
        } else {
          // self.log.debug('[RPC] interface %s returns %s', self.ifName, value)
          resolve(value)
        }
      })
    })
  }

  reportValueUsage (listDps) {
    const self = this
    self.log.debug('[RPC] Report Usage to %s', self.ifName)

    // only a hint for the daemon; faults like "Transmission is pending" are harmless
    return Promise.all(Object.keys(listDps).map((dpName) => {
      // Split into address and datapointname
      const parts = dpName.split('.')
      // part0 is the interface (we do not need this)
      const adr = parts[1]
      const dpn = parts[2]
      const cnt = listDps[dpName]
      self.log.debug('[RPC] Report %s time Usage of %s.%s', cnt, adr, dpn)
      return self.sendRPCommand('reportValueUsage', [adr, dpn, cnt], false).catch((error) => {
        self.log.debug('[RPC] reportValueUsage of %s.%s on %s failed: %s', adr, dpn, self.ifName, (error && error.message) || error)
      })
    }))
  }

  ping () {
    this.lastMessage = Math.floor((new Date()).getTime() / 1000)
  }
}

class HomeMaticRPC extends EventEmitter {
  constructor (ccumanager, port) {
    super()
    this.log = ccumanager.log
    this.ccumanager = ccumanager
    this.server = undefined
    this.client = undefined
    this.stopped = false
    this.localIP = undefined
    this.bindIP = undefined
    this.listeningPort = port
    this.lastMessage = 0
    this.watchDogTimer = undefined
    this.rpc = undefined
    this.rpcInit = undefined
    this.pathname = '/'
    this.resetInterfaces()
    this.watchDogTimeout = 300
    this.localIP = this.getIPAddress()
  }

  async init (watchDogTimeout) {
    if (watchDogTimeout !== undefined) {
      this.log.debug('Setup Watchdog to %s', watchDogTimeout)
      this.watchDogTimeout = parseInt(watchDogTimeout)
    }
    await this.resolvePeers()
    this.server = await this.initServer(xmlrpc, this.listeningPort)
  }

  /**
   * The event servers only take calls from this machine and the CCU: an event sets the state of a
   * HomeKit accessory. With the CCU on this machine they listen on 127.0.0.1 only (the interfaces
   * register 127.0.0.1 as callback, see connectInterfaces).
   */
  async resolvePeers () {
    const ccu = String((this.ccumanager && this.ccumanager.ccuIP) || '127.0.0.1')
    let ccuAddresses = [ccu]
    if (net.isIP(ccu) === 0) {
      try {
        ccuAddresses = (await dns.lookup(ccu, { all: true })).map(entry => entry.address)
      } catch (e) {
        this.log.warn('[RPC] cannot resolve the CCU host %s: %s', ccu, e.message)
      }
    }
    const loopback = ['127.0.0.1', '::1', 'localhost']
    this.localCCU = ccuAddresses.every(address => loopback.includes(address) || (address === this.localIP))
    this.allowedPeers = new Set(['127.0.0.1', '::1', this.localIP, ...ccuAddresses].flatMap(address => [address, '::ffff:' + address]))
  }

  isAllowedPeer (address) {
    return (this.allowedPeers !== undefined) && this.allowedPeers.has(address)
  }

  initServer (module, port) {
    const self = this
    let server
    this.log.debug('[RPC] creating rpc server on port %s', port)
    return new Promise((resolve, reject) => {
      this.isPortTaken(port, (error, inUse) => {
        if (error === null) {
          if (inUse === false) {
            server = module.createServer({
              host: this.localCCU ? '127.0.0.1' : '0.0.0.0',
              port
            })
            // xmlrpc keeps its http server in httpServer, binrpc its net server in server
            const socketServer = server.httpServer || server.server
            if (socketServer) {
              socketServer.on('connection', (socket) => {
                if (!self.isAllowedPeer(socket.remoteAddress)) {
                  self.log.warn('[RPC] refused an event call from %s', socket.remoteAddress)
                  socket.destroy()
                }
              })
            }

            // Both libraries re-emit errors of the socket server (e.g. EADDRINUSE) as 'error'.
            // A remote call of a method named 'error' is dispatched here too and gets an empty answer;
            // without this listener it would throw and end the process.
            server.on('error', (err, params, callback) => {
              if (typeof callback === 'function') {
                callback(null, '')
                return
              }
              self.log.error('[RPC] event server on port %s: %s', port, (err && err.message) || err)
            })

            server.on('system.listMethods', (err, params, callback) => {
              const iface = self.interfaceForEventMessage(params)
              if (iface !== undefined) {
                self.log.debug("[RPC] Method call params for 'system.listMethods': %s (%s)", JSON.stringify(params), err)
              } else {
                self.log.error('[RPC] unable to find Interface for %s', params)
              }
              callback(null, ['event', 'system.listMethods', 'system.multicall'])
            })

            server.on('listDevices', (err, params, callback) => {
              const iface = self.interfaceForEventMessage(params)
              if (iface !== undefined) {
                self.log.debug('[RPC] <- listDevices on %s - Zero Reply (%s)', iface.ifName, err)
              }
              callback(null, [])
            })

            server.on('newDevices', (err, params, callback) => {
              const iface = self.interfaceForEventMessage(params)
              if (iface !== undefined) {
                if ((iface.isRunning === true) && (iface.reconnecting === false)) {
                  self.log.debug('[RPC] <- newDevices on %s. Emit this for the ccu to requery rega (%s)', iface.ifName, err)
                  self.emit('newDevices', {})
                }
              }
              // we are not intrested in new devices cause we will fetch them at launch
              callback(null, [])
            })

            server.on('event', (err, params, callback) => {
              if (!err) {
                self.dispatchEvent('event', params)
              }
              callback(err, [])
            })

            server.on('system.multicall', (err, params, callback) => {
              if (!err) {
                params.forEach((events) => {
                  try {
                    events.forEach((event) => {
                      self.dispatchEvent(event.methodName, event.params)
                    })
                  } catch (err) { }
                })
              }
              callback(null)
            })

            self.log.info('[RPC] server for all interfaces is listening on port %s.', port)
            resolve(server)
          } else {
            self.log.error('****************************************************************************************************************************')
            self.log.error('*  Sorry the local port %s on your system is in use. Please make sure, self no other instance of this plugin is running.', port)
            self.log.error('*  you may change the initial port with the config setting for local_port in your config.json ')
            self.log.error('*  giving up ... the homematic plugin is not able to listen for ccu events on %s until you fix this. ')
            self.log.error('****************************************************************************************************************************')
            reject(new Error('port in use error'))
          }
        } else {
          self.log.error('*  Error while checking ports')
          reject(new Error('port check error'))
        }
      })
    })
  }

  dispatchEvent (method, params) {
    const iface = this.interfaceForEventMessage(params)
    if (iface === undefined) {
      this.log.error('[RPC] unable to find Interface for %s', JSON.stringify(params))
      return
    }
    if (this.stopped) {
      // disconnecting: late events must not bring an interface back
      this.log.debug('[RPC] ignoring event for %s while disconnecting', iface.ifName)
      return
    }
    if (iface.isRunning !== true) {
      // an event with our id proves the daemon registered us, even when its answer to init timed out
      iface.markConnected('delivers events, it is connected')
    }
    iface.ping()
    this.handleEvent(iface, method, params)
  }

  interfaceForEventMessage (params) {
    let result
    if ((params) && (params.length > 0)) {
      const ifTest = params[0]
      this.interfaces.forEach(iface => {
        if (iface.ifId === ifTest) {
          result = iface
        }
        // this is the cuxd extra handling cause cuxd is not rega compliant and returns alwas CUxD instead of the interface identifier from the init call
        if ((ifTest === 'CUxD') && ((iface.ifName.indexOf('CUxD') > -1))) {
          result = iface
        }
      })
    }
    return result
  }

  clientFromName (ifId) {
    let result
    this.interfaces.forEach(iface => {
      if (iface.ifName === ifId) {
        result = iface
      }
    })
    return result
  }

  connectedInterfaces () {
    return this.interfaces
  }

  handleEvent (iface, method, params) {
    const self = this
    if ((method === 'event') && (params !== undefined)) {
      const ifName = iface.ifName
      const channel = ifName + params[1]
      const datapoint = params[2]
      const value = params[3]

      const rgx = /([a-zA-Z0-9-]{1,}).([a-zA-Z0-9-_]{1,}):([0-9]{1,}).([a-zA-Z0-9-_]{1,})/g
      const parts = rgx.exec(channel + '.' + datapoint)
      if ((parts) && (parts.length > 4)) {
        const idx = parts[1]
        const address = parts[2]
        const chidx = parts[3]
        const evadr = idx + '.' + address + ':' + chidx + '.' + datapoint
        self.log.debug('[RPC] event for %s.%s with value %s', channel, datapoint, value)
        self.emit('event', { address: evadr, value })
      }
    }
  }

  addInterface (ifName, hostIP, hostPort, path, credentials) {
    if (!ifName.endsWith('.')) {
      ifName = ifName + '.'
    }
    // PowerUP rpc bin if needed
    if ((ifName.indexOf('CUxD') > -1) && (!(this.binServer))) {
      this.log.debug('[RPC] open extra Connector for CuxD')
      this.binServer = this.initServer(binrpc, this.listeningPort + 1).catch((err) => {
        this.log.error('[RPC] no event server for CUxD: %s', err.message)
      })
      this.log.debug('[RPC] Connector for CuxD is done')
    }

    this.log.debug('[RPC] adding Interface %s Host %s Port %s Path %s', ifName, hostIP, hostPort, path)
    const client = new HomeMaticRPCClient(ifName, 'HAP', hostIP, hostPort, path, this.log, credentials)
    this.interfaces.push(client)
  }

  connect () {
    const self = this
    this.log.debug('[RPC] Connecting all interfaces (%s interfaces found)', this.interfaces.length)
    this.interfaces.forEach(iface => {
      let port = self.listeningPort
      if (iface.ifName.indexOf('CUxD') > -1) {
        port = port + 1
      }
      self.log.info('[RPC] init interface %s for connection to port %s', iface.ifName, port)

      let localIp = self.localIP
      // Check if the hostIP is equal to the ccuIP so if they are , we can switch to 127.0.0.1
      // https://github.com/thkl/hap-homematic/issues/437
      if ((iface.host === this.localIP) || (iface.host === '127.0.0.1')) {
        localIp = '127.0.0.1'
        self.log.info('[RPC] looks like hap is running local so switch to 127.0.0.1')
      } else {
        self.log.info('[RPC] remote ccu %s will report  %s to connect', iface.host, this.localIP)
      }

      iface.init(localIp, port)
      iface.serverPort = port
    })

    if ((this.watchDogTimeout !== undefined) && (this.watchDogTimeout > 0)) {
      this.log.info('[RPC] init watchdog %s seconds', this.watchDogTimeout)
      this.ccuWatchDog()
    } else {
      this.log.info('[RPC] skipped watchdog (%s)', this.watchDogTimeout)
    }
    this.stopping = false
  }

  ccuWatchDog () {
    const self = this
    this.interfaces.forEach(iface => {
      // a reconnect that is still waiting for its answer is not started again
      if ((iface.lastMessage !== undefined) && (iface.reconnecting !== true)) {
        const now = Math.floor((new Date()).getTime() / 1000)
        const timeDiff = now - iface.lastMessage
        if (timeDiff > self.watchDogTimeout) {
          self.log.debug('[RPC] Watchdog Trigger - Reinit Connection for %s after idle time of %s seconds', iface.ifName, timeDiff)
          // the next attempt follows after another idle period, not with the next check
          iface.lastMessage = now
          iface.reconnecting = true // init clears it with its answer
          Promise.resolve(iface.stop()).catch(() => {
            self.log.debug('[RPC] error while watchdog interface stop of %s; will reconnect', iface.ifName)
          })
          iface.init(self.localIP, iface.listeningPort)
        }
      }
    })

    const recall = () => {
      self.ccuWatchDog()
    }

    this.watchDogTimer = setTimeout(recall, 10000)
  }

  disconnectInterfaces () {
    const self = this
    if (this.stopped) {
      return
    }
    clearTimeout(this.watchDogTimer)
    this.stopped = true
    return Promise.all(self.interfaces.map(async (iface) => {
      try {
        await iface.stop()
      } catch (e) {
        // we are disconnecting .. 's tät wurschd sein
      }
    })
    )
  }

  sendInterfaceCommand (ifId, command, parameters) {
    const self = this
    this.log.debug('[RPC] sendInterfaceCommand %s %s', ifId, command)
    return new Promise((resolve, reject) => {
      const hmRpcClient = self.clientFromName(ifId + '.')
      if (hmRpcClient) {
        self.log.debug('[RPC] interface found going ahead')
        hmRpcClient.sendRPCommand(command, parameters).then(result => {
          resolve(result)
        }).catch(error => reject(error))
      } else {
        self.log.debug('[RPC] interface %s NOT found ', ifId)
        reject(new Error('interface ' + ifId + ' is not connected'))
      }
    })
  }

  resetInterfaces () {
    this.log.debug('[RPC] reseting all interface connections')
    ;(this.interfaces || []).forEach(iface => iface.close())
    this.interfaces = []
    this.stopped = false
  }

  async stop () {
    await this.disconnectInterfaces()

    this.log.debug('[RPC] closing eventserver')
    // binServer is the promise of initServer
    const servers = [this.server, await this.binServer].filter(Boolean)
    await Promise.all(servers.map(server => Promise.resolve(server.close())
      .catch((err) => this.log.debug('[RPC] closing eventserver: %s', err.message))))
    this.log.debug('[RPC] eventserver removed')
  }

  getIPAddress () {
    const os = require('os')
    const interfaces = os.networkInterfaces()

    for (const devName in interfaces) {
      const iface = interfaces[devName]
      for (let i = 0; i < iface.length; i++) {
        const alias = iface[i]

        if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal && (alias.address.indexOf('169.254.') === -1)) {
          return alias.address
        }
      }
    }
    return '0.0.0.0'
  }

  // checks if the port is in use
  // https://gist.github.com/timoxley/1689041

  isPortTaken (port, fn) {
    const tester = net.createServer().once('error', (err) => {
      if (err.code !== 'EADDRINUSE') return fn(err)
      fn(null, true)
    })
      .once('listening', () => {
        tester.once('close', () => {
          fn(null, false)
        })
          .close()
      }).listen(port)
  }
}

module.exports = HomeMaticRPC
