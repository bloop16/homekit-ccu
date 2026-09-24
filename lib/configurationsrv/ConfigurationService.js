/*
 * File: ConfigurationService.js
 * Project: homekit-ccu
 * File Created: Tuesday, 10th March 2020 7:15:57 pm
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
const os = require('os')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const url = require('url')
const qs = require('querystring')
const uuid = require('@homebridge/hap-nodejs').uuid
const Rega = require(path.join(__dirname, '..', 'HomeMaticRegaRequest.js'))
const hapIds = require(path.join(__dirname, '..', 'util', 'hapIds.js'))
const { upgradeConfigVersion } = require(path.join(__dirname, '..', 'util', 'configMigration.js'))
const { normalizeInstance, removeInstanceFrom } = require(path.join(__dirname, '..', 'util', 'mappingInstances.js'))
const { stageRestoredPersist, removePairing } = require(path.join(__dirname, '..', 'util', 'hapPersist.js'))
const sockjs = require('sockjs')
const childProcess = require('child_process')

const RCD_SCRIPT = process.env.HOMEKIT_CCU_RCD || '/etc/config/rc.d/homekit-ccu'
const RESTART_DELAY_MS = 500
const MAX_RESTORE_SIZE = 20 * 1024 * 1024
const LOCALHOST = '127.0.0.1'
// a validated CCU session is trusted for this long before the CCU is asked again
const SESSION_CACHE_MS = 30 * 1000

// lowercase hostname of an Origin (with scheme) or Host (without) header, undefined if unparsable
function hostnameOf (value, hasScheme) {
  try {
    return new URL(hasScheme ? value : 'http://' + value).hostname.toLowerCase()
  } catch (e) {
    return undefined
  }
}

// A request without Origin (non-browser client, same-origin GET) is fine; a browser request
// from another page is accepted only when the Origin's hostname is the requested Host's
// hostname (scheme and port may differ: the UI on :80 calls the API on :9874).
function isSameOrigin (headers) {
  if (headers.origin === undefined) {
    return true
  }
  const originHost = hostnameOf(headers.origin, true)
  return Boolean(originHost) && originHost === hostnameOf(headers.host || '', false)
}

class ConfigurationService {
  constructor (logger) {
    this.log = logger
    // When running on the CCU (localhost), bind to 127.0.0.1 on port 39874
    // (lighttpd proxies external ports 9874/49874 to us).
    // When running remotely (-H flag), bind to 0.0.0.0 on port 9874 directly.
    this.ccuHost = process.env.UIX_CCUHOST || LOCALHOST
    this.isRemote = this.ccuHost !== LOCALHOST
    this.configServerPort = this.isRemote ? 9874 : 39874
    this.configServerBind = this.isRemote ? '0.0.0.0' : '127.0.0.1'

    this.contentTypesByExtension = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.json': 'application/json; charset=utf-8',
      '.mp3': 'audio/mpeg',
      '.gif': 'image/gif',
      '.gz': 'application/gzip',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
      '.svg': 'image/svg+xml',
      '.md': 'text/plain; charset=utf-8',
      '.mp4': 'video/mp4'
    }
    this.programs = []
    this.variables = []
    this.pluginAccessories = []
    this.bridges = []
    this.allVariables = []
    this.compatibleDevices = []

    let config = this.loadSettings()
    if (config === undefined) {
      config = {}
    }
    // Every api call needs a valid CCU admin session unless useCCCAuthentication is
    // explicitly false (not recommended: then everyone on the LAN can use the api).
    this.useAuth = (config.useCCCAuthentication !== false) && (config.useCCCAuthentication !== 'false')
    this.validSessions = new Map()
    // TLS is only relevant in remote mode — on the CCU, lighttpd handles TLS
    // and proxies to us via plain HTTP
    this.useTLS = this.isRemote ? (config.useTLS || false) : false
    this.interfaceWatchdog = config.interfaceWatchdog || 300
    this.enableMonitoring = config.enableMonitoring || false
    this.disableHistory = config.disableHistory || false
    this.forceCache = config.forceCache || false
    this.forceRefresh = false
  }

  shutdown () {
    this.server.close()
    this.log.close()
  }

  sendFile (unsafeSuffix, response) {
    const safeSuffix = path.normalize(unsafeSuffix).replace(/^(\.\.(\/|\\|$))+/, '')
    let safeFilePath = path.join(__dirname, 'html', safeSuffix)

    if (safeFilePath.endsWith('/')) {
      safeFilePath = path.join(safeFilePath, 'index.html')
    }

    const stat = fs.statSync(safeFilePath, { throwIfNoEntry: false })
    if (stat && stat.isFile()) {
      const contentType = this.contentTypesByExtension[path.extname(safeFilePath)]
      this.streamFile(safeFilePath, {
        'Content-Type': contentType || 'text/html',
        'Content-Length': stat.size,
        'Last-Modified': new Date()
      }, response)
    } else {
      this.log.warn('File not found %s', safeFilePath)
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('ERROR File does not exist')
    }
  }

  // sends the file with status 200 once it is open; a read error becomes a 500 (or ends
  // the response if the headers are already out) instead of an unhandled 'error' event
  streamFile (filePath, headers, response) {
    const readStream = fs.createReadStream(filePath)
    readStream.on('open', () => {
      response.writeHead(200, headers)
      readStream.pipe(response)
    })
    readStream.on('error', (err) => {
      this.log.error('[Config] unable to read %s: %s', filePath, err.message)
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' })
        response.end('ERROR unable to read file')
      } else {
        response.destroy(err)
      }
    })
  }

  sendJSON (object, response) {
    response.writeHead(200, {
      'Content-Type': 'application/json'
    })
    response.end(JSON.stringify(object))
  }

  handleHttpRequest (request, response) {
    const self = this
    // CORS headers — the UI is served by lighttpd on port 80, the api on 9874/49874, so the
    // browser sees a cross-origin request. Only the same host is allowed (see isSameOrigin;
    // guardForeignOrigins has already rejected every other origin).
    // Skip /websockets/ paths — sockjs sets its own CORS headers there.
    const origin = request.headers.origin
    if (origin && isSameOrigin(request.headers) && !request.url.startsWith('/websockets')) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      response.setHeader('Vary', 'Origin')
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (request.url === '/restore/' && request.method.toLowerCase() === 'post') {
      self.processRestore(request, response)
    } else
      if (request.method === 'POST') {
        let body = ''
        request.on('data', (data) => {
          body += data
          if (body.length > 1e6) {
            request.connection.destroy()
          }
        })

        request.on('end', () => {
          // eslint-disable-next-line n/no-deprecated-api -- legacy parser kept on purpose (behavior-preserving)
          const parsed = url.parse(request.url, true)
          const post = qs.parse(body)
          const filename = parsed.pathname
          if (filename === '/api/') {
            self.processApiCall(post, response).catch(e => self.handleApiError(e, response))
          } else {
            self.sendFile(filename, response)
          }
        })
      } else {
        // eslint-disable-next-line n/no-deprecated-api -- legacy parser kept on purpose (behavior-preserving)
        const parsed = url.parse(request.url, true)
        const filename = parsed.pathname
        if (filename === '/api/') {
          self.processApiCall(parsed.query, response).catch(e => self.handleApiError(e, response))
        } else {
          self.sendFile(filename, response)
        }
      }
  }

  // Runs before sockjs and handleHttpRequest: a request (or websocket upgrade) from a page of
  // another host is refused outright, so no other site can drive the api from a browser.
  guardForeignOrigins (server) {
    const refuse = {
      request: (request, response) => {
        response.writeHead(403, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'Forbidden' }))
      },
      upgrade: (request, socket) => {
        socket.on('error', () => {})
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      }
    }
    Object.keys(refuse).forEach((event) => {
      const listeners = server.listeners(event).slice()
      server.removeAllListeners(event)
      server.on(event, (request, ...rest) => {
        if (!isSameOrigin(request.headers)) {
          this.log.warn('[Config] refused %s %s from origin %s', request.method, JSON.stringify(request.url), JSON.stringify(request.headers.origin))
          refuse[event](request, ...rest)
          return
        }
        listeners.forEach(listener => listener.call(server, request, ...rest))
      })
    })
  }

  async run () {
    const self = this
    const serverHandler = (request, response) => this.handleHttpRequest(request, response)

    this.log.info('[Config] launching configuration service')
    const keyFile = '/etc/config/server.pem'
    const certFile = '/etc/config/server.pem'
    if ((this.useTLS === true) && (fs.existsSync(keyFile)) && (fs.existsSync(certFile))) {
      // Just use Homematics TLS Certificate :o)
      const privateKey = fs.readFileSync(keyFile, 'utf8')
      const certificate = fs.readFileSync(certFile, 'utf8')
      const credentials = { key: privateKey, cert: certificate }
      try {
        this.server = https.createServer(credentials, serverHandler)
      } catch (e) {
        // fallback
        this.server = http.createServer(serverHandler)
      }
    } else {
      this.server = http.createServer(serverHandler)
    }

    this.sockjs_server = sockjs.createServer({
      sockjs_url: './vendor/sockjs/sockjs.min.js',
      log: function (message) {
        self.log.debug(message)
      }
    })

    this.sockjs_server.on('connection', function (conn) {
      conn.on('close', function () {
        self.log.debug('Socked Close Message for %s', conn.id)
        self.handleSocketRequest(conn, {
          command: 'close'
        })
      })

      conn.on('data', function (message) {
        try {
          self.handleSocketRequest(conn, JSON.parse(message))
            .catch(e => self.log.error('[Config] socket request failed: %s', e.stack || e))
        } catch (e) {

        }
      })
    })

    this.sockjs_server.installHandlers(this.server, {
      prefix: '/websockets'
    })
    this.guardForeignOrigins(this.server)

    this.server.listen(this.configServerPort, this.configServerBind, () => {
      self.log.info('[Config] running %s configuration server on port %s', (this.useTLS ? 'secure' : ''), self.configServerPort)
    })

    this.connections = {}
    self.log.info('Config Start heartBeat')
    this.heartBeat()
    self.log.info('Config Server is running')
  }

  sendMessageToSockets (message) {
    const self = this
    Object.keys(this.connections).forEach((connId) => {
      const conn = self.connections[connId]
      try {
        if (conn) {
          conn.write(JSON.stringify(message))
        }
      } catch (error) {
        if (conn) {
          try {
            conn.close()
          } catch (error) { }
        }
      }
    })
  }

  async handleSocketRequest (conn, message) {
    if (message.command === 'hello') {
      // the socket receives the same data as the api (bridges with their pincodes)
      if (!(await this.isAuthorized(message.sid))) {
        this.log.warn('[Config] socket %s without a valid CCU session', conn.id)
        conn.write(JSON.stringify({ message: 'unauthorized' }))
        return
      }
      this.log.debug('[Config] add %s to sockets', conn.id)
      this.connections[conn.id] = conn
      // Send hello
      const sysData = await this.getSystemInfo()
      conn.write(JSON.stringify({ message: 'ackn', payload: sysData }))
    }

    if (message.command === 'close') {
      if (this.connections[conn.id] !== undefined) {
        this.log.debug('[Config] remove %s from sockets', conn.id)
        delete this.connections[conn.id]
      }
    }
  }

  fetchVersion () {
    const packageFile = path.join(__dirname, '..', '..', 'package.json')
    this.log.debug('[Config] Check Version from %s', packageFile)
    if (fs.existsSync(packageFile)) {
      try {
        this.packageData = JSON.parse(fs.readFileSync(packageFile))
        this.log.debug('[Config] version is %s', this.packageData.version)
        return this.packageData.version
      } catch (e) {
        return 'no version found'
      }
    }
    return 'no version found'
  }

  getSupportData (address) {
    // first get the device file
    const deviceFile = path.join(process.env.UIX_CONFIG_PATH, 'devices.json')
    if (fs.existsSync(deviceFile)) {
      try {
        const objDev = JSON.parse(fs.readFileSync(deviceFile))
        const result = {}
        if ((objDev) && (objDev.devices)) {
          objDev.devices.forEach(device => {
            let id = 1000
            // make it random
            const digits = Math.floor(Math.random() * 9000000000) + 1000000000
            const dummyAdr = digits.toString() + 'ABCD'
            if (device.address === address) {
              result.devices = []
              const tmpD = {
                id,
                intf: 0,
                intfName: '',
                name: device.type,
                address: dummyAdr,
                type: device.type,
                channels: []
              }
              id = id + 1
              device.channels.forEach(channel => {
                const chn = channel.address.split(':').slice(1, 2)[0]
                const tmpC = {
                  id,
                  name: dummyAdr + ':' + chn,
                  intf: 0,
                  address: dummyAdr + ':' + chn,
                  type: channel.type,
                  access: channel.access
                }
                tmpD.channels.push(tmpC)
                id = id + 1
              })
              result.devices.push(tmpD)
            }
          })
          return result
        }
      } catch (e) {
        return 'error while creating the file ' + e.stack
      }
    }
    return 'devices.json not found'
  }

  async getSystemInfo () {
    const result = {}
    result.cpu = os.cpus()
    result.mem = os.freemem()
    result.uptime = os.uptime()
    result.hapuptime = process.uptime()
    if (!this._version) {
      this._version = this.fetchVersion()
    }
    result.version = this._version
    result.debug = this.log.isDebugEnabled()
    result.useAuth = this.useAuth
    result.useTLS = this.useTLS
    result.isRemote = this.isRemote
    result.enableMonitoring = this.enableMonitoring
    result.disableHistory = this.disableHistory
    result.forceRefresh = this.forceRefresh
    result.forceCache = this.forceCache
    result.interfaceWatchdog = this.interfaceWatchdog
    this.forceRefresh = false
    return result
  }

  handleApiError (e, response) {
    this.log.error('[Config] api call failed: %s', e.stack || e)
    if (!response.headersSent) {
      response.writeHead(500, 'Internal Server Error')
    }
    response.end()
  }

  restartSystem () {
    if (!fs.existsSync(RCD_SCRIPT)) {
      this.log.error('[Config] restart not available (no rc.d script at %s)', RCD_SCRIPT)
      return false
    }
    this.log.info('[Config] restarting via %s restart in %sms', RCD_SCRIPT, RESTART_DELAY_MS)
    setTimeout(() => {
      try {
        // The rc.d script stops this process and its parent, so it runs detached
        // with ignored stdio (its log output would otherwise hit a closed pipe).
        const child = childProcess.spawn(RCD_SCRIPT, ['restart'], { detached: true, stdio: 'ignore' })
        child.on('error', (err) => this.log.error('[Config] restart via %s failed: %s', RCD_SCRIPT, err.message))
        child.unref()
      } catch (err) {
        this.log.error('[Config] restart via %s failed: %s', RCD_SCRIPT, err.message)
      }
    }, RESTART_DELAY_MS)
    return true
  }

  deviceWithUUID (uuid) {
    let result
    this.pluginAccessories.forEach(device => {
      if (device.UUID === uuid) {
        result = device
      }
    })
    return result
  }

  specialDeviceWithUUID (uuid) {
    let result
    this.pluginSpecial.forEach(device => {
      if (device.UUID === uuid) {
        result = device
      }
    })
    return result
  }

  bridgeWithId (uuid) {
    let result
    this.bridges.forEach(bridge => {
      if (bridge.id === uuid) {
        result = bridge
      }
    })
    return result
  }

  variableWithName (varName) {
    let result
    this.allVariables.forEach(variable => {
      if ((variable.isCompatible === true) && (variable.name === varName)) {
        result = variable
      }
    })
    return result
  }

  programWithName (progName) {
    let result
    this.compatiblePrograms.forEach(program => {
      if (program.name === progName) {
        result = program
      }
    })
    return result
  }

  serviceSettingsFor (channelAddress) {
    const result = {}
    result.service = []
    const self = this
    if (this.compatibleDevices) {
      this.compatibleDevices.forEach(device => {
        if (device.channels) {
          device.channels.forEach(channel => {
            if (channel.address === channelAddress) {
              const s1 = self.services[channel.type]
              if (s1) {
                s1.forEach(item => {
                  // make sure we do not filter this device
                  if ((item.filterDevice) && (item.filterDevice.indexOf(device.type) === -1)) {
                    result.service.push(item)
                  }
                })
              }
              const s2 = self.services[device.type + ':' + channel.type]
              if (s2) {
                s2.forEach(item => {
                  result.service.push(item)
                })
              }
            }
          })
        }
      })
      if (this.pluginSpecial) {
        // also map the special devices
        this.pluginSpecial.forEach(spdevice => {
          const chadr = spdevice.serial + ':' + spdevice.channel
          if (chadr === channelAddress) {
            // find service
            self.services.SPECIAL.forEach(item => {
              result.service.push(item)
            })
          }
        })
      }
    }
    return result
  }

  getVariableServiceList () {
    const result = []
    if ((this.services) && (this.services.VARIABLE)) {
      this.services.VARIABLE.forEach(item => {
        result.push(item)
      })
    }
    return result
  }

  loadSettings () {
    const configFile = path.join(process.env.UIX_CONFIG_PATH, 'config.json')
    if (fs.existsSync(configFile)) {
      return JSON.parse(fs.readFileSync(configFile))
    }
    return undefined
  }

  saveSettings (configData) {
    const configFile = path.join(process.env.UIX_CONFIG_PATH, 'config.json')
    fs.writeFileSync(configFile, JSON.stringify(configData, ' ', 1))
  }

  loadGraph (graph) {
    const hostname = os.hostname()
    const result = []
    const key = graph.item
    const id = graph.id
    if (id) {
      const hdidParts = id.split(':')
      if (hdidParts.length > 1) {
        const config = this.loadSettings()
        let cachePath = config.cache

        if (cachePath !== undefined) {
          cachePath = path.join(cachePath, 'evehistory')
        } else {
          cachePath = process.env.UIX_CONFIG_PATH
        }

        const filename = hostname + '_' + hdidParts[0] + '_' + hdidParts[1] + '_persist.json'
        const filePath = path.join(cachePath, filename)
        if (fs.existsSync(filePath)) {
          try {
            const dta = JSON.parse(fs.readFileSync(filePath))
            if ((dta) && (dta.history)) {
              // filter only the last 24 hours

              const ts = Math.round(new Date().getTime() / 1000)
              const tsYesterday = ts - (24 * 3600)

              const filtered = dta.history.filter(item => item.time > tsYesterday)
              filtered.forEach((item) => {
                if (item[key]) {
                  result.push({ timestamp: item.time, value: item[key] })
                }
              })
            }
          } catch (e) {
            this.log.error('[Config] parsing error for graph data %s', e)
          }
        } else {
          this.log.debug('[Config] unable to load graph data from %s', filePath)
        }
      }
    }
    return result
  }

  checkGraphes () {
    this.graphes = []
    const self = this
    const config = this.loadSettings()
    if ((config) && (config.mappings)) {
      Object.keys(config.mappings).forEach((mapping) => {
        const hkDeviceMapping = config.mappings[mapping]
        if ((hkDeviceMapping.settings) && (hkDeviceMapping.settings.showGraph) && (hkDeviceMapping.settings.showGraph !== 'DONT_SHOW')) {
          self.graphes.push({ id: mapping, item: hkDeviceMapping.settings.showGraph, name: hkDeviceMapping.name })
        }
      })
    }

    // check if we have saved files
    this.graphes.forEach((graph) => {
      const id = graph.id
      let cachePath = config.cache

      if (cachePath !== undefined) {
        cachePath = path.join(cachePath, 'evehistory')
      } else {
        cachePath = process.env.UIX_CONFIG_PATH
      }

      const hostname = os.hostname()
      const hdidParts = id.split(':')
      if (hdidParts.length > 1) {
        const filename = hostname + '_' + hdidParts[0] + '_' + hdidParts[1] + '_persist.json'
        const filePath = path.join(cachePath, filename)
        self.log.debug('Check Historyfile %s', filePath)
        if (!fs.existsSync(filePath)) {
          self.log.warn('File not exists removing graph')
          self.graphes = self.graphes.filter(item => item.id !== id)
        }
      }
    })
  }

  async saveDevice (data) {
    const name = data.name
    let channel = data.address
    let isSpecial

    if (channel === 'new:special') {
      isSpecial = uuid.generate('special_' + name)
      channel = isSpecial + ':0'
    }

    const settings = (data.settings) ? JSON.parse(data.settings) : {}

    let instance = uuid.generate('0')

    if (settings.instanceIDs !== undefined) {
      this.log.debug('[Config] settings up instances')
      instance = []
      Object.keys(settings.instanceIDs).forEach((oKey) => {
        instance.push(settings.instanceIDs[oKey])
      })
      // one bridge: store its id, an array only for a device on several bridges
      instance = normalizeInstance(instance)
    } else {
      // if not in settings ... so use the first we'vfound
      if (data['instanceIDs[0]']) {
        instance = data['instanceIDs[0]']
      }
    }

    const service = data.serviceClass

    if ((name) && (channel) && (service)) {
      let configData = this.loadSettings()
      // generate the containers if not here yet
      if (configData === undefined) {
        configData = {}
      }
      if (configData.mappings === undefined) {
        configData.mappings = {}
      }

      if (configData.channels === undefined) {
        configData.channels = []
      }

      // There is a Special Array so put this also in
      if (isSpecial !== undefined) {
        if (configData.special === undefined) {
          configData.special = []
        }
        configData.special.push(isSpecial)
      }

      // remove settings which are not part of the class settings
      const clazzFile = path.join(__dirname, '..', 'services', service + '.js')
      if (fs.existsSync(clazzFile)) {
        const oClazz = require(clazzFile)
        const oClazzSettings = await oClazz.configurationItems()
        Object.keys(settings).forEach((key) => {
          if (Object.keys(oClazzSettings).indexOf(key) === -1) {
            delete settings[key]
            this.log.debug('[Config] removed %s which is not part of %s settings.', key, service)
          }
        })
      } else {
        this.log.debug('[Config] clazzFile %s not found', clazzFile)
      }

      // Add the mapping
      configData.mappings[channel] = {
        name,
        Service: service,
        instance,
        settings
      }

      if (configData.channels.indexOf(channel) === -1) {
        // Add the Channel if not here .. otherwise just override the config
        configData.channels.push(channel)
      }
      // Save the stuff
      this.saveSettings(configData)
      return { result: 'saved' }
    } else {
      return { result: 'error saving' }
    }
  }

  createapplicancesWizzard (instanceID, listChannelz) {
    const self = this
    let configData = this.loadSettings()

    if (configData === undefined) {
      configData = {}
    }
    if (configData.mappings === undefined) {
      configData.mappings = {}
    }

    if (configData.channels === undefined) {
      configData.channels = []
    }

    if ((configData.instances) && (configData.instances[instanceID])) {
      configData.instances[instanceID].publishDevices = true
    }

    listChannelz.forEach(aChannel => {
      // get the default service
      const sList = self.services[aChannel.type]
      if (sList) {
        if (configData.channels.indexOf(aChannel.address) === -1) {
          configData.channels.push(aChannel.address)
        }
        const serviceClazz = sList[0].serviceClazz
        configData.mappings[aChannel.address] = {
          name: aChannel.name,
          Service: serviceClazz,
          instance: instanceID,
          settings: {}
        }
      }
    })
    this.saveSettings(configData)
    this.process.send({
      topic: 'reloadApplicances'
    })
    return { result: 'saved' }
  }

  savePublishingFlag (bridges) {
    const self = this
    const configData = this.loadSettings() || { instances: { 0: { name: 'default' } } }
    bridges.forEach(bridgeId => {
      self.log.debug('[Config] savePublishingFlag %s', bridgeId)
      const oBridge = configData.instances[bridgeId]
      oBridge.publishDevices = true
    })
    // config.json holds the setup codes, so it is not written to the log
    this.saveSettings(configData)
  }

  randomMac () {
    let mac = '12:34:56'

    for (let i = 0; i < 6; i++) {
      if (i % 2 === 0) mac += ':'
      mac += Math.floor(Math.random() * 16).toString(16)
    }

    return mac.toUpperCase()
  }

  generatePin () {
    return hapIds.generatePin()
  }

  generateSetupID () {
    return hapIds.generateSetupID()
  }

  createMultipleInstances (payload) {
    const self = this
    try {
      this.log.debug('[Config] payload Data %s', payload)
      const data = JSON.parse(payload)
      // load all data
      let configData = this.loadSettings()
      if (configData === undefined) {
        configData = {}
      }
      if (configData.instances === undefined) {
        configData.instances = {}
      }
      this.log.debug('[Config] payload %s', data)
      Object.keys(data).forEach(roomId => {
        const bridgeData = data[roomId]
        if (bridgeData.create === true) {
          let isUnique = true
          const name = bridgeData.name
          const roomId = parseInt(bridgeData.roomID)
          // check unique name
          Object.keys(configData.instances).forEach(bridgeId => {
            const bridge = configData.instances[bridgeId]
            if (bridge.name === name) {
              isUnique = false
            }
          })
          if (isUnique === true) {
            const newUUID = uuid.generate(String(Math.random()))
            const mac = self.randomMac()
            const instData = { name, user: mac, pincode: self.generatePin(), roomId, setupID: self.generateSetupID() }
            self.log.debug('[Config] will create instance %s', JSON.stringify(instData))
            configData.instances[newUUID] = instData
          }
        }
      })
      this.saveSettings(configData)
      this.process.send({
        topic: 'reloadApplicances'
      })
      return ({ message: 'created', payload: configData.instances })
    } catch (e) {
      this.log.error(e)
      return { error: e }
    }
  }

  createInstance (query) {
    const self = this
    return new Promise((resolve, reject) => {
      const name = query.name
      const publish = query.publish
      const roomId = (query.roomId) ? parseInt(query.roomId) : undefined
      let configData = this.loadSettings()
      if (configData === undefined) {
        configData = {}
      }
      if (configData.instances === undefined) {
        configData.instances = {}
      }
      let isUnique = true
      Object.keys(configData.instances).forEach(bridgeId => {
        const bridge = configData.instances[bridgeId]
        if (bridge.name === name) {
          isUnique = false
        }
      })
      if (isUnique === true) {
        const newUUID = uuid.generate(String(Math.random()))
        const mac = self.randomMac()
        configData.instances[newUUID] = { name, user: mac, pincode: self.generatePin(), roomId, setupID: self.generateSetupID() }
        self.saveSettings(configData)
        self.ensureFirewallPorts()
      } else {
        reject(new Error('name not unique'))
      }
      if ((publish === true) || (publish === 'true')) {
        self.process.send({
          topic: 'reloadApplicances'
        })
      }
      setTimeout(() => {
        resolve(self.bridges)
      }, 2000)
    })
  }

  removeInstance (uuid) {
    const bridge = this.bridgeWithId(uuid)
    if ((bridge !== undefined) && (bridge.id !== 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab')) {
      // first set all devices to the default bridge
      const config = this.loadSettings()
      if (config.mappings !== undefined) {
        Object.keys(config.mappings).forEach(deviceId => {
          const device = config.mappings[deviceId]
          // instance is a bridge id or an array of them (device on several bridges)
          device.instance = removeInstanceFrom(device.instance, uuid, 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab')
        })
      }
      delete config.instances[uuid]
      this.saveSettings(config)
      if (bridge.port) {
        this.removeFirewallPort(bridge.port)
      }
      this.process.send({
        topic: 'reloadApplicances'
      })
    }
  }

  removeDeletedDevice (channelID) {
    const configData = this.loadSettings()
    this.log.debug('[Config] will remove deleted device with address %s', channelID)
    if ((configData) && (configData.channels)) {
      const index = configData.channels.indexOf(channelID)
      if (index > -1) {
        this.log.debug('[Config] channel data found .. remove')
        configData.channels.splice(index, 1)
      }
    }
    if ((configData) && (configData.mappings)) {
      this.log.debug('[Config] remove mapping configuration')
      delete configData.mappings[channelID]
    }
    this.saveSettings(configData)
    // send the main system a message to remove the persistent data
    this.process.send({
      topic: 'remove',
      uuid: null
    })
    return { result: 'deleted' }
  }

  removeDevice (uuid) {
    let device = this.deviceWithUUID(uuid)
    if (!device) {
      this.log.debug('[Config] check special device for removal')
      device = this.specialDeviceWithUUID(uuid) // check if its a special device
    }
    if (device) {
      // remove the channel and the settings
      const configData = this.loadSettings()
      const address = device.serial + ':' + device.channel
      this.log.debug('[Config] will remove device with address %s', address)
      if ((configData) && (configData.channels)) {
        const index = configData.channels.indexOf(address)
        if (index > -1) {
          this.log.debug('[Config] channel data found .. remove')
          configData.channels.splice(index, 1)
        }
      }
      if ((configData) && (configData.mappings)) {
        this.log.debug('[Config] remove mapping configuration')
        delete configData.mappings[address]
      }

      // remove it from special if its there
      if ((configData) && (configData.special)) {
        const index = configData.special.indexOf(device.serial)
        if (index > -1) {
          this.log.debug('[Config] special entry found ... remove')
          configData.special.splice(index, 1)
        }
      }

      this.saveSettings(configData)
      // send the main system a message to remove the persistent data
      this.process.send({
        topic: 'remove',
        uuid
      })
      return { result: 'deleted' }
    } else {
      return { result: 'not found' }
    }
  }

  editInstance (query) {
    this.log.debug('[Config] edit Instance')
    const uuid = query.uuid
    const name = query.displayName
    const roomId = query.roomId
    this.log.debug('[Config] updating %s with %s', uuid, name)
    const bridge = this.bridgeWithId(uuid)
    this.log.debug('[Config] bridge %s', (bridge !== undefined))
    if ((bridge) && (name)) {
      // change the name in the config and reload everything
      const config = this.loadSettings()
      if ((config) && (config.instances)) {
        const instance = config.instances[uuid]
        instance.name = name
        if (roomId) {
          instance.roomId = parseInt(roomId)
        }
        this.saveSettings(config)
        this.process.send({
          topic: 'reloadApplicances',
          uuid
        })
        return { result: 'saved' }
      }
    }
    return { result: 'error name not filled or bridge not found' }
  }

  deactivateInstance (query) {
    this.log.debug('[Config] deactivating Instance')
    const uuid = query.uuid
    const bridge = this.bridgeWithId(uuid)
    this.log.debug('[Config] bridge %s', (bridge !== undefined))
    if (bridge) {
      // change the name in the config and reload everything
      const config = this.loadSettings()
      if ((config) && (config.instances)) {
        const instance = config.instances[uuid]
        delete instance.publishDevices
        this.saveSettings(config)
        this.process.send({
          topic: 'reloadApplicances',
          uuid
        })
        return { result: 'saved' }
      }
    }
    return { result: 'bridge not found' }
  }

  resetInstance (query) {
    this.log.debug('[Config] resetting Instance')
    const uuid = query.uuid
    const bridge = this.bridgeWithId(uuid)
    this.log.debug('[Config] bridge %s', (bridge !== undefined))
    if (bridge) {
      try {
        const removed = removePairing({ configDir: process.env.UIX_CONFIG_PATH, username: bridge.user })
        this.log.info('[Config] reset of bridge %s removed %s', bridge.user, removed.join(', ') || 'nothing')
      } catch (e) {
        this.log.error('[Config] cannot reset the pairing of bridge %s: %s', bridge.user, e.message)
      }
      // then reboot the instances
      this.process.send({
        topic: 'reloadApplicances',
        uuid
      })
    }
  }

  saveObject (query, objectType) {
    this.log.debug('[Config] save %s', objectType)
    const serial = query.serial
    const newName = query.name || serial
    const instance = query.instanceID
    let settings = {}
    if (query.settings) {
      try {
        settings = JSON.parse(query.settings)
      } catch (e) {

      }
    }
    const serviceClass = query.serviceClass
    const bridge = this.bridgeWithId(instance)
    if ((serial) && (newName) && (bridge)) {
      const config = this.loadSettings()
      // add or save variable
      if (!config[objectType]) {
        config[objectType] = []
      }
      if (config[objectType].indexOf(serial) === -1) {
        config[objectType].push(serial)
      }
      if (config.mappings === undefined) {
        config.mappings = {}
      }

      // remove settings which are not part of the class settings
      const clazzFile = path.join(__dirname, '..', 'services', serviceClass + '.js')
      if (fs.existsSync(clazzFile)) {
        const oClazz = require(clazzFile)
        const oClazzSettings = oClazz.configurationItems()
        Object.keys(settings).forEach((key) => {
          if (Object.keys(oClazzSettings).indexOf(key) === -1) {
            delete settings[key]
            this.log.debug('[Config] removed %s which is not part of %s settings.', key, serviceClass)
          }
        })
      } else {
        this.log.debug('[Config] clazzFile %s not found', clazzFile)
      }
      // add mapping data
      config.mappings[serial + ':0'] = {
        name: newName,
        instance,
        Service: serviceClass,
        settings
      }
      this.saveSettings(config)
      this.process.send({
        topic: 'reloadApplicances',
        uuid
      })
      return { result: 'saved' }
    } else {
      return { result: 'error name or serial or instance not found' }
    }
  }

  removeObject (serial, uuid, objectType) {
    if (serial) {
      this.log.debug('[Config] try to remove %s %s', objectType, serial)
      // remove the channel and the settings
      const configData = this.loadSettings()

      if ((configData) && (configData[objectType])) {
        const index = configData[objectType].indexOf(serial)
        if (index > -1) {
          configData[objectType].splice(index, 1)
        }
      }
      if ((configData) && (configData.mappings)) {
        delete configData.mappings[serial + ':0']
      }

      this.saveSettings(configData)
      // send the main system a message to remove the persistent data
      this.process.send({
        topic: 'remove',
        uuid
      })
      return { result: 'deleted' }
    } else {
      return { result: 'not found' }
    }
  }

  saveVariableTrigger (datapoint, autoUpdateVarTriggerHelper) {
    if (datapoint) {
      const configData = this.loadSettings()
      configData.VariableUpdateEvent = datapoint
      configData.autoUpdateVarTriggerHelper = ((autoUpdateVarTriggerHelper === true) || (autoUpdateVarTriggerHelper === 'true'))
      this.saveSettings(configData)
      this.process.send({
        topic: 'reloadApplicances',
        uuid
      })
      return { result: 'saved' }
    } else {
      return { result: 'missing argument' }
    }
  }

  getRoombyId (roomID) {
    return this.pluginRooms.filter(room => room.id === roomID)[0] || undefined
  }

  generateRoomListWithSupportedDevices () {
    const result = []
    if (this.pluginRooms) {
      this.pluginRooms.forEach(room => {
        const oRoom = { id: room.id, name: room.name, devices: [] }
        const cList = room.channels
        this.compatibleDevices.forEach(device => {
          const dCList = []
          device.channels.forEach(channel => {
            if ((cList.indexOf(channel.id) > -1) && (channel.isSuported === true)) {
              dCList.push(channel)
            }
          })
          if (dCList.length > 0) {
            const oDevice = { id: device.id, name: device.name, type: device.type, channels: dCList }
            oRoom.devices.push(oDevice)
          }
        })
        result.push(oRoom)
      })
    }
    return result
  }

  saveGlobalSettings (query) {
    if (query.settings) {
      const oSettings = JSON.parse(query.settings)
      const isOn = (value) => (value === true) || (value === 'true')
      // The main process has upgraded config.json before it started us; a config without
      // configVersion here (e.g. an old backup restored since) gets the same upgrade, so its
      // unconscious useCCCAuthentication=false is not stamped as a version 2 choice.
      const { config, upgraded } = upgradeConfigVersion(this.loadSettings() || {})
      if (upgraded) {
        this.log.warn('[Config] configuration upgraded to version %s: the session check is on (useCCCAuthentication=true)', config.configVersion)
      }
      const changes = {
        useTLS: isOn(oSettings.useTLS),
        enableMonitoring: isOn(oSettings.enableMonitoring),
        disableHistory: isOn(oSettings.disableHistory)
      }
      // keep the stored value when the UI did not send one (missing means "on", see constructor)
      if (oSettings.useAuth !== undefined) {
        changes.useCCCAuthentication = isOn(oSettings.useAuth)
      }
      // make sure we have the value set
      if (oSettings.interfaceWatchdog) {
        const watchdog = oSettings.interfaceWatchdog
        changes.interfaceWatchdog = ((watchdog > 0) && (watchdog < 300)) ? 300 : watchdog // min is 300 seconds
      }
      this.saveSettings({ ...config, ...changes })
    }
  }

  ccuPost (port, path, body) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.ccuHost || LOCALHOST,
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length
        }
      }

      const req = http.request(options, (res) => {
        let data = ''
        res.on('data', (d) => {
          data = data + d
        })

        res.on('end', () => {
          resolve(data)
        })
      })

      req.on('error', (error) => {
        reject(error)
      })

      req.write(body)
      req.end()
    })
  }

  existsDevice (channelAdr) {
    return this.compatibleDevices.filter(device => {
      return (channelAdr.indexOf(device.address) > -1)
    }).length > 0
  }

  checkDevicesStillExists () {
    // load the channels from config
    this.log.debug('Check Lost and found')
    const config = this.loadSettings()
    const lostChannels = []
    const result = []
    const self = this

    if ((config !== undefined) && (config.channels !== undefined)) {
      // match the list
      config.channels.forEach((channelAdr) => {
        self.log.debug('probing channel %s', channelAdr)
        if (!self.existsDevice(channelAdr)) {
          if (!channelAdr.endsWith(':0')) { // uuid:0 are special channels so we will skip them
            self.log.debug('%s was removed from the ccu', channelAdr)
            lostChannels.push(channelAdr)
          }
        } else {
          self.log.debug('%s still exists', channelAdr)
        }
      })
    }

    lostChannels.forEach(channelAdr => {
      const dta = config.mappings[channelAdr]
      dta.address = channelAdr
      result.push(dta)
    })
    return result
  }

  async ccuGetDatapoints (channelID) {
    let script = "Write('{\"datapoints\":[');string sid;boolean dpf = true;var x = dom.GetObject("
    script += channelID
    script += ");if (x) {foreach(sid, x.DPs().EnumUsedIDs()) {if (dpf) {dpf=false;} else {Write(',');}Write('\"');Write(dom.GetObject(sid).Name());Write('\"');}}Write(']}');"
    const result = await this.ccuPost(8181, '/tclrega.exe', script)
    try {
      const pos = result.lastIndexOf('<xml><exec>')
      const response = (result.substring(0, pos))
      return JSON.parse(response)
    } catch (e) {
      return {}
    }
  }

  async ccuCGICall (sid, method, parameters) {
    const lParameters = { _session_id_: sid }
    if (parameters) {
      Object.keys(parameters).forEach((key) => {
        lParameters[key] = parameters[key]
      })
    }
    const body = { version: '1.1', method, params: lParameters }
    const result = await this.ccuPost(80, '/api/homematic.cgi', JSON.stringify(body))
    try {
      return JSON.parse(result)
    } catch (e) {
      return {}
    }
  }

  async renewCCUSession (sid) {
    await this.ccuCGICall(sid, 'Session.renew')
  }

  isValidCCUSession (sid) {
    const self = this
    return new Promise((resolve, reject) => {
      // first remove the @ char
      const regex = /@([0-9a-zA-Z]{10})@/g
      const prts = regex.exec(sid)
      if ((prts) && (prts.length > 1)) {
        const script = 'Write(system.GetSessionVarStr(\'' + prts[1] + '\'));'
        const rega = new Rega(self.log, self.ccuHost || LOCALHOST, 'isValidCCUSession')
        rega.script(script).then(regaResult => {
          const rgx = /^([0-9]*);([0-9])*;([^;]*);([^;]*);([^;]*);$/
          const usrPrts = rgx.exec(regaResult)
          self.log.debug('[Config] check auth %s', usrPrts)
          if ((usrPrts) && (usrPrts.length > 2)) {
            // renew the session in ccu; a failure must not end the config server
            self.renewCCUSession(prts[1]).catch(e => self.log.warn('[Config] unable to renew the CCU session: %s', e.message || e))
            resolve(parseInt(usrPrts[2]) >= 8)
          } else {
            resolve(false)
          }
        }).catch(() => resolve(false))
      } else {
        resolve(false)
      }
    })
  }

  async getCCUFirewallConfiguration () {
    // get the /etc/config/firewall.conf
    const config = {}
    const fireWallConfig = path.join('/', 'etc', 'config', 'firewall.conf')
    if (fs.existsSync(fireWallConfig)) {
      const dta = fs.readFileSync(fireWallConfig)
      if (dta) {
        const rgxMode = /MODE.=.([a-zA-Z_]{1,})/
        const rgxModeParts = rgxMode.exec(dta)
        if ((rgxModeParts) && (rgxModeParts.length > 1)) {
          config.mode = rgxModeParts[1]
        }
        const rgxPorts = /USERPORTS.=.([0-9 ]{1,})/
        const rgxPortsParts = rgxPorts.exec(dta)
        if ((rgxPortsParts) && (rgxPortsParts.length > 1)) {
          config.userports = rgxPortsParts[1].split(' ')
        }
      } else {
        this.log.error('[Config] firewallConfig not readable')
      }
    } else {
      this.log.error('[Config] unable to find firewall config %s', fireWallConfig)
    }
    return config
  }

  runFirewallTcl (script) {
    if (!fs.existsSync('/lib/libfirewall.tcl')) {
      this.log.debug('[Config] libfirewall.tcl not found, skipping firewall update')
      return
    }
    const { spawn } = require('child_process')
    const tclsh = spawn('tclsh', [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    tclsh.stderr.on('data', (data) => { stderr += data })
    tclsh.on('close', (code) => {
      if (code !== 0) {
        this.log.warn('[Config] firewall TCL script failed (exit %s): %s', code, stderr)
      }
    })
    tclsh.stdin.write(script)
    tclsh.stdin.end()
  }

  ensureFirewallPorts () {
    const ports = [9874, 49874, 9875]
    this.bridges.forEach(bridge => {
      if (bridge.port) ports.push(bridge.port)
    })
    const portList = ports.join(' ')
    this.log.info('[Config] ensuring firewall ports: %s', portList)
    this.runFirewallTcl(`source /lib/libfirewall.tcl
Firewall_loadConfiguration
global Firewall_USER_PORTS
foreach port {${portList}} {
  if {[lsearch $Firewall_USER_PORTS $port] == -1} {
    lappend Firewall_USER_PORTS $port
  }
}
Firewall_saveConfiguration
Firewall_configureFirewall
`)
  }

  removeFirewallPort (port) {
    this.log.info('[Config] removing firewall port: %s', port)
    this.runFirewallTcl(`source /lib/libfirewall.tcl
Firewall_loadConfiguration
global Firewall_USER_PORTS
set idx [lsearch $Firewall_USER_PORTS ${port}]
if {$idx != -1} {
  set Firewall_USER_PORTS [lreplace $Firewall_USER_PORTS $idx $idx]
}
Firewall_saveConfiguration
Firewall_configureFirewall
`)
  }

  generateBackup () {
    const self = this
    return new Promise((resolve, reject) => {
      this.log.info('[Config] creating backup')
      const backupFile = '/tmp/hap_homematic_backup.tar.gz'
      // remove the old backup if there is one
      if (fs.existsSync(backupFile)) {
        this.log.warn('[Config] old backup found. will remove this')
        fs.unlinkSync(backupFile)
      }
      const backupCommand = 'tar -C ' + process.env.UIX_CONFIG_PATH + ' -czvf ' + backupFile + ' --exclude="*persist.json" --exclude="hap-autobackup_*.*" .'
      this.log.info('[Config] running %s', backupCommand)
      const childprocess = require('child_process')
      childprocess.exec(backupCommand, (error, stdout, stderr) => {
        self.log.info('[Config] creating backup done will return %s', stdout)
        if (error) {
          reject(error)
        }
        resolve(backupFile)
      })
    })
  }

  checkAndExtractUploadedConfig (tmpFile) {
    // create a tmp directory and extract the file
    const tmpDir = path.join('/', 'tmp', 'haptmp')
    if (fs.existsSync(tmpDir)) {
      // clean up by removing old stuff
      this.deleteFolderRecursive(tmpDir)
    }
    fs.mkdirSync(tmpDir)
    // extract the files there
    try {
      childProcess.execFileSync('tar', ['-xzf', tmpFile, '-C', tmpDir])
    } catch (e) {
      this.log.error('[Config] error while extracting the upload')
      return false
    }

    // check config.json
    try {
      const tmpConfig = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json')))
      if (tmpConfig) {
        // move the config to my folder
        const myConfigFile = path.join(process.env.UIX_CONFIG_PATH, 'config.json')
        if (fs.existsSync(myConfigFile)) {
          fs.unlinkSync(myConfigFile)
        }
        fs.copyFileSync(path.join(tmpDir, 'config.json'), path.join(process.env.UIX_CONFIG_PATH, 'config.json'))
        // copy the persistent files
        const rgx1 = new RegExp(os.hostname + '_.*.pstore')
        const rgx2 = new RegExp(os.hostname + '_.*_persist.json')
        fs.readdir(tmpDir, (err, files) => {
          if (!err) {
            files.forEach(file => {
              if ((file.match(rgx1)) || (file.match(rgx2))) {
                fs.copyFileSync(path.join(tmpDir, file), path.join(process.env.UIX_CONFIG_PATH, file))
              }
            })
          }
        })
        // HomeKit pairing data is staged and replaces the running bridge's keys on restart
        const staged = stageRestoredPersist({ extractedDir: tmpDir, configDir: process.env.UIX_CONFIG_PATH })
        this.log.info('[Config] restore: %s HomeKit pairing files staged for the next start', staged.length)
        // remove the uploaded file
        fs.unlinkSync(tmpFile)
        return true
      } else {
        return false
      }
    } catch (e) {
      this.log.error('[Config] restore failed: %s', e.message)
      return false
    }
  }

  async heartBeat () {
    const self = this
    if (Object.keys(this.connections).length > 0) {
      const sysData = await this.getSystemInfo()
      this.sendMessageToSockets({ message: 'heartbeat', payload: sysData })
    }
    setTimeout(() => {
      self.heartBeat()
    }, 180 * 1000)
  }

  extractSid (sid) {
    const regex = /@([0-9a-zA-Z]{10})@/g
    const prts = regex.exec(sid)
    if ((prts) && (prts.length > 1)) {
      return prts[1]
    } else {
      return undefined
    }
  }

  deleteFolderRecursive (pathRemove) {
    const self = this
    if (fs.existsSync(pathRemove)) {
      fs.readdirSync(pathRemove).forEach((file, index) => {
        const curPath = path.join(pathRemove, file)
        if (fs.lstatSync(curPath).isDirectory()) { // recurse
          self.deleteFolderRecursive(curPath)
        } else { // delete file
          fs.unlinkSync(curPath)
        }
      })
      fs.rmdirSync(pathRemove)
    }
  }

  processRestore (request, response) {
    const { formidable, errors: formidableErrors } = require('formidable')
    const uploadDir = process.env.HOMEKIT_CCU_UPLOAD_DIR || os.tmpdir()
    const form = formidable({ uploadDir, maxFiles: 1, maxFileSize: MAX_RESTORE_SIZE, maxFields: 5 })
    const self = this
    // every file formidable starts writing; on a rejected request `files` may not list them
    const created = []
    let finished = false
    form.on('fileBegin', (_name, file) => {
      created.push(file)
      if (finished) {
        // formidable can still begin a file after it reported the error; formidable opens
        // the file right after this event, so remove it once that happened
        setImmediate(() => self.removeUploadedFile(file))
      }
    })
    const first = (value) => Array.isArray(value) ? value[0] : value
    const tooLargeCodes = [formidableErrors.biggerThanMaxFileSize, formidableErrors.biggerThanTotalMaxFileSize]
    form.parse(request, async (err, fields, files) => {
      const upload = files ? first(files.file) : undefined
      try {
        if (err) {
          self.log.error('[Config] restore upload failed: %s', err.message)
          const tooLarge = (err.httpCode === 413) || tooLargeCodes.includes(err.code)
          response.writeHead(tooLarge ? 413 : 400, tooLarge ? 'Payload Too Large' : 'Bad Request')
          response.end()
          return
        }
        if (first(fields.method) === 'restore') {
          const sidOk = await self.checkSid(first(fields.sid), response)
          if (sidOk) {
            if (upload && upload.filepath) {
              if (self.checkAndExtractUploadedConfig(upload.filepath)) {
                self.restartSystem()
              }
            } else {
              self.log.error('[Config] restore: no file in upload')
            }
          }
        }
        if (!response.headersSent) {
          response.writeHead(200, 'OK')
          response.end('OK')
        }
      } catch (e) {
        self.log.error('[Config] restore failed: %s', e.stack || e)
        if (!response.headersSent) {
          response.writeHead(500, 'Internal Server Error')
        }
        response.end()
      } finally {
        // checkAndExtractUploadedConfig may already have removed the upload; force makes that harmless
        finished = true
        const leftovers = new Set(created)
        if (upload && upload.filepath) {
          leftovers.add(upload)
        }
        leftovers.forEach(file => self.removeUploadedFile(file))
      }
    })
  }

  removeUploadedFile (file) {
    const remove = () => fs.rm(file.filepath, { force: true }, () => {})
    // A rejected request can end while formidable's write stream (internal `_writeStream`)
    // is still opening or open; removing before it closes would let the file reappear.
    const stream = file._writeStream
    if (stream && !stream.closed) {
      stream.once('close', remove)
      stream.destroy()
    } else {
      remove()
    }
  }

  // true when authentication is off or sid is a valid CCU session of an admin (level 8);
  // a valid session is remembered for SESSION_CACHE_MS so a burst of UI calls asks the CCU once
  async isAuthorized (sid) {
    if (this.useAuth === false) {
      return true
    }
    if (!this.validSessions) {
      this.validSessions = new Map()
    }
    const now = Date.now()
    if ((this.validSessions.get(sid) || 0) > now) {
      return true
    }
    const valid = (await this.isValidCCUSession(sid)) === true
    if (valid) {
      this.validSessions.forEach((expires, key) => {
        if (expires <= now) {
          this.validSessions.delete(key)
        }
      })
      this.validSessions.set(sid, now + SESSION_CACHE_MS)
    }
    return valid
  }

  async checkSid (sid, response) {
    if (await this.isAuthorized(sid)) {
      return true
    }
    this.log.warn('[Config] refused a request without a valid CCU session')
    response.writeHead(401, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Unauthorized' }))
    return false
  }

  async processApiCall (query, response) {
    // if we are using ccu's authentication system
    const isValidUserSession = await this.checkSid(query.sid, response)
    if (isValidUserSession === false) {
      return
    }
    if (query.method) {
      const sid = this.extractSid(query.sid)
      switch (query.method) {
        case 'ccuGetDatapoints': {
          const dps = await this.ccuGetDatapoints(query.cid)
          this.sendJSON(dps, response)
          break
        }

        case 'refresh':
          this.sendObjects(sid)
          this.sendJSON({ result: 'ok' }, response)
          break

        case 'refreshCache':
          this.process.send({
            topic: 'refreshCache'
          })

          this.sendJSON({ result: 'initiated' }, response)
          break

        /** returns all known devices */
        case 'devicelist':
          this.sendJSON(this.pluginAccessories, response)
          break
        /** returns all known variables */
        case 'variablelist': {
          const srvList = this.getVariableServiceList()
          this.sendJSON({ variables: this.pluginVariables, trigger: this.pluginVariableTrigger, services: srvList }, response)
          break
        }

        /** returns all known programs */
        case 'programlist':
          this.sendJSON({ programs: this.pluginPrograms }, response)
          break

        case 'speciallist':
          this.sendJSON({ special: this.pluginSpecial }, response)
          break

        /** returns all known rooms */
        case 'roomlist':
          this.sendJSON({ rooms: this.pluginRooms }, response)
          break

        /** returns all hap instances */
        case 'bridges':
          if (sid) {
            this.getCCUFirewallConfiguration(sid)
          }
          this.sendJSON(this.bridges, response)
          break
        /** returns system informations */
        case 'system': {
          const sysData = await this.getSystemInfo()
          this.sendJSON(sysData, response)
          break
        }

        /** publish the hap instances to homekit */
        case 'publish': {
          // Save PublishDevices Infos
          const bridgesToPublish = query.bridges
          if (bridgesToPublish) {
            this.log.debug('[Config] setPublish flag for %s', bridgesToPublish)
            this.savePublishingFlag(JSON.parse(bridgesToPublish))
          }

          this.process.send({
            topic: 'reloadApplicances'
          })

          this.sendJSON({ result: 'initiated' }, response)
          break
        }

        /** send the list of compatible ccu devices back to the js application */
        case 'newDevice': {
          // send a list with compatible devices
          const list = []
          this.compatibleDevices.forEach(device => {
            const lCha = []
            const oDev = { device: device.address, name: device.name, type: device.type }
            device.channels.forEach(channel => {
              if (channel.isSuported === true) {
                lCha.push({ id: channel.id, address: channel.address, name: channel.name, type: channel.type })
              }
            })
            oDev.channels = lCha
            list.push(oDev)
          })
          this.sendJSON({ devices: list }, response)
          break
        }
        case 'createapplicanceswizzard':
          this.sendJSON(this.createapplicancesWizzard(query.instanceId, JSON.parse(query.payload)), response)
          break
        case 'newVariable': {
          const varlist = this.allVariables.filter(variable => variable.isCompatible === true)
          this.sendJSON({ variables: varlist }, response)
          break
        }

        case 'allVariables':
          this.sendJSON({ variables: this.allVariables }, response)
          break

        case 'newProgram':
          this.sendJSON({ programs: this.compatiblePrograms }, response)
          break

        case 'virtualKeys':
          this.sendJSON({ virtualKeys: this.virtualKeys }, response)
          break

        /** returns the list of known services */
        case 'service':
          if (query.channelAddress === 'new:special') {
            const result = {}
            result.service = []
            this.services.SPECIAL.forEach(item => {
              result.service.push(item)
            })
            this.sendJSON(result, response)
          } else {
            this.sendJSON(this.serviceSettingsFor(query.channelAddress), response)
          }
          break

        /** save a new device */
        case 'saveNewDevice':
          this.sendJSON(this.saveDevice(query), response)
          break

        case 'saveDevice':
          this.sendJSON(this.saveDevice(query), response)
          break
        /** remove a device */
        case 'removeDevice':
          this.sendJSON(this.removeDevice(query.uuid), response)
          break

        case 'removeDeletedDevice':
          this.sendJSON(this.removeDeletedDevice(query.address), response)
          break

        case 'removeVariable':
          this.sendJSON(this.removeObject(query.serial, query.uuid, 'variables'), response)
          break

        case 'removeProgram':
          this.sendJSON(this.removeObject(query.serial, query.uuid, 'programs'), response)
          break

        /** creates a new hap instance */
        case 'createinstance': {
          const newBridgeList = await this.createInstance(query)
          this.sendJSON(newBridgeList, response)
          break
        }

        case 'createinstancewizzard': {
          const payload = query.payload
          this.log.debug('[Config] creating instances from wizzard %s', payload)
          const newBridgeListW = await this.createMultipleInstances(payload)
          this.sendJSON(newBridgeListW, response)
          break
        }

        /** edit the name of an instance */
        case 'editinstance':
          this.sendJSON(this.editInstance(query), response)
          break

        case 'deactivateInstance':
          this.sendJSON(this.deactivateInstance(query), response)
          break

        case 'removehapinstance':
          this.sendJSON(this.removeInstance(query.id), response)
          break

        case 'saveVariable':
          if (this.variableWithName(query.serial)) {
            this.sendJSON(this.saveObject(query, 'variables'), response)
          } else {
            this.sendJSON({ error: 'unknown variable' }, response)
          }
          this.sendObjects()
          break

        case 'saveProgram':
          if (this.programWithName(query.serial)) {
            this.sendJSON(this.saveObject(query, 'programs'), response)
          } else {
            this.sendJSON({ error: 'unknown program' }, response)
          }
          this.sendObjects()
          break

        case 'saveVariableTrigger': {
          this.sendJSON(this.saveVariableTrigger(query.datapoint, query.autoUpdateVarTriggerHelper), response)
          this.sendObjects()
          const configData = this.loadSettings()
          if (configData.autoUpdateVarTriggerHelper === true) {
            // Update the Trigger Program
            this.process.send({
              topic: 'createTrigger'
            })
          }
          break
        }

        case 'wizzardRooms':
          this.sendJSON(this.generateRoomListWithSupportedDevices(), response)
          break

        case 'restart':
          // check if we should turn debug mode on
          if (query.debug === 'true') {
            // create a indicator in /tmp named .hapdebug
            const fdebug = path.join(fs.realpathSync(os.tmpdir()), '.hapdebug')
            fs.closeSync(fs.openSync(fdebug, 'w'))
          }
          this.log.info('performing restart')
          if (this.restartSystem()) {
            this.sendJSON({ response: 'ok' }, response)
          } else {
            this.sendJSON({ error: 'restart not available' }, response)
          }
          break

        case 'debug':
          this.process.send(
            {
              topic: 'debug',
              debug: (query.enable === 'true')
            }
          )
          this.sendJSON({ response: 'ok' }, response)
          this.heartBeat() // trigger a new websocks push so the UI will change
          break

        case 'saveSettings':
          this.saveGlobalSettings(query)
          if (this.restartSystem()) {
            this.sendJSON({ response: 'ok' }, response)
          } else {
            this.sendJSON({ error: 'restart not available' }, response)
          }
          break

        case 'getLog': {
          const stat = fs.statSync(this.logfile)
          this.streamFile(this.logfile, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename=homekit-ccu-log.txt',
            'Content-Length': stat.size
          }, response)
          break
        }

        case 'backup': {
          this.log.info('[Config] backup Command')
          const backupFile = await this.generateBackup()
          if (fs.existsSync(backupFile)) {
            const statBf = fs.statSync(backupFile)
            const d = new Date()
            this.streamFile(backupFile, {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename=homekit-ccu-backup-${d.getDate()}_${d.getMonth() + 1}_${d.getFullYear()}_${d.getHours()}_${d.getMinutes()}_${d.getSeconds()}.tar.gz`,
              'Content-Length': statBf.size
            }, response)
          } else {
            this.sendJSON({ error: 'backup file not found', path: backupFile }, response)
          }
          break
        }

        case 'changelog': {
          const cFile = path.join(__dirname, '..', '..', 'CHANGELOG.md')
          if (fs.existsSync(cFile)) {
            const stat = fs.statSync(cFile)
            this.streamFile(cFile, {
              'Content-Type': 'text/markdown',
              'Content-Length': stat.size
            }, response)
          } else {
            this.sendJSON({ error: 'changelog not found', path: cFile }, response)
          }
          break
        }

        case 'support': {
          const sData = this.getSupportData(query.address)
          let fileName = '_device.json'
          if ((sData) && (sData.devices)) {
            fileName = sData.devices[0].type + '.json'
          }
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename=' + fileName
          })

          response.end(JSON.stringify(sData, ' ', 2))
          break
        }

        case 'listGraph':
          this.checkGraphes()
          response.end(JSON.stringify(this.graphes, ' ', 2))

          break

        case 'resetInstance':
          this.resetInstance(query)
          break

        case 'graphDetail': {
          this.checkGraphes()
          const graphId = query.id
          this.log.debug('[Config] searching graph id %s', graphId)
          const selectedGraph = this.graphes.filter(graph => graph.id === graphId)
          if (selectedGraph) {
            const data = await this.loadGraph(selectedGraph[0])
            response.end(JSON.stringify(data))
          } else {
            response.end(JSON.stringify([

            ]))
          }

          break
        }
        case 'checklost': {
          const result = this.checkDevicesStillExists()
          response.end(JSON.stringify(result))
          break
        }
        /** fallback */
        default:
          this.sendJSON({ error: 'unknown method' }, response)
          break
      }
    } else {
      this.sendJSON({ error: 'missing arguments' }, response)
    }
  }

  async sendObjects () {
    this.log.debug('sendObjects fetching firewall data')
    // check the current firewall settings match the used ports
    const data = await this.getCCUFirewallConfiguration()
    const fwConfig = data
    if (fwConfig) {
      this.log.debug('fw Config found %s', fwConfig)
      this.bridges.forEach((bridge) => {
        if ((fwConfig.mode) && (fwConfig.mode === 'MOST_OPEN')) {
          bridge.ccuFirewall = true
        } else
          if ((fwConfig.mode) && (fwConfig.mode === 'RESTRICTIVE') && (fwConfig.userports) && (fwConfig.userports.indexOf(String(bridge.port)) > -1)) {
            bridge.ccuFirewall = true
          } else {
            bridge.ccuFirewall = false
          }
      })
    }
    const socketPayload = {
      accessories: this.pluginAccessories,
      variables: this.pluginVariables,
      variableTrigger: this.pluginVariableTrigger,
      autoUpdateVarTriggerHelper: this.autoUpdateVarTriggerHelper,
      variableServices: this.getVariableServiceList(),
      programs: this.pluginPrograms,
      rooms: this.pluginRooms,
      special: this.pluginSpecial,
      bridges: this.bridges,
      ccuDevices: this.compatibleDevices
    }

    this.log.debug('send Socket Message %s', JSON.stringify(socketPayload))
    this.sendMessageToSockets({
      message: 'serverdata',
      payload: socketPayload
    })
  }

  handleIncommingIPCMessage (message) {
    if (message.topic) {
      switch (message.topic) {
        case 'serverdata':
          this.log.debug('Incomming IPC Serverdata: %s', JSON.stringify(message))
          if (message.accessories) {
            this.pluginAccessories = message.accessories
          }
          if (message.variables) {
            this.pluginVariables = message.variables
          }
          if (message.variableTrigger) {
            this.pluginVariableTrigger = message.variableTrigger
          }
          if (message.autoUpdateVarTriggerHelper) {
            this.autoUpdateVarTriggerHelper = message.autoUpdateVarTriggerHelper
          }
          if (message.programs) {
            this.pluginPrograms = message.programs
          }
          if (message.rooms) {
            this.pluginRooms = message.rooms
          }

          if (message.special) {
            this.pluginSpecial = message.special
          }

          if (message.logfile) {
            this.logfile = message.logfile
          }
          this.sendObjects()
          break

        case 'virtualKeys':
          this.virtualKeys = message.virtualKeys
          break

        case 'bridges':
          this.bridges = message.bridges
          this.ensureFirewallPorts()
          break
        case 'services':
          // logger.debug('Services :%s', JSON.stringify(message.services))
          this.services = message.services
          break

        case 'compatibleObjects':
          this.compatibleDevices = message.devices
          this.allVariables = message.variables
          this.compatiblePrograms = message.programs
          this.sendObjects()
          break

        case 'shutdown':
          console.log('Shutdown ConfigService')
          this.process.exit()
          break

        case 'debug':
          this.log.setDebugEnabled(message.debug)
          break
      }
    }
  }
}

module.exports = ConfigurationService
