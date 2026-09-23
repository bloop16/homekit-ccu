/*
 * File: index.js
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
const crypto = require('crypto')
const https = require('https')
const url = require('url')
const qs = require('querystring')
const uuid = require('@homebridge/hap-nodejs').uuid
const Logger = require(path.join(__dirname, '..', 'logger.js'))
const Rega = require(path.join(__dirname, '..', 'HomeMaticRegaRequest.js'))
const sockjs = require('sockjs')

process.title = 'homekit-ccu-config'

class ConfigurationService {
  constructor (logger) {
    this.log = logger
    // When running on the CCU (localhost), bind to 127.0.0.1 on port 39874
    // (lighttpd proxies external ports 9874/49874 to us).
    // When running remotely (-H flag), bind to 0.0.0.0 on port 9874 directly.
    this.isRemote = process.env.UIX_CCUHOST && process.env.UIX_CCUHOST !== '127.0.0.1'
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
      '.gif': 'image/gid',
      '.gz': 'application/gzip',
      '.ico': 'image/x-icon',
      '.woff2': 'font/opentype',
      '.woff': 'font/opentype',
      '.ttf': 'font/opentype',
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
    // TLS abd auth is only relevant in remote mode — on the CCU, lighttpd handles TLS
    // and proxies to us via plain HTTP
    this.useAuth = this.isRemote ? (config.useCCCAuthentication || false) : false
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

    if (fs.existsSync(safeFilePath)) {
      const stat = fs.statSync(safeFilePath)
      const contentType = this.contentTypesByExtension[path.extname(safeFilePath)]

      response.writeHead(200, {
        'Content-Type': contentType || 'text/html',
        'Content-Length': stat.size,
        'Last-Modified': new Date()
      })

      const readStream = fs.createReadStream(safeFilePath)
      readStream.pipe(response)
    } else {
      this.log.warn('File not found %s', safeFilePath)
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('ERROR File does not exist')
    }
  }

  sendJSON (object, response) {
    response.writeHead(200, {
      'Content-Type': 'application/json'
    })
    response.end(JSON.stringify(object))
  }

  async run () {
    const self = this

    function serverHandler (request, response) {
      // CORS headers — lighttpd proxies from a different port, so the browser
      // sees a cross-origin request. Reflect the request Origin so the header
      // is e.g. "https://10.0.0.20" rather than a wildcard.
      // Skip /websockets/ paths — sockjs sets its own CORS headers there.
      const origin = request.headers.origin
      if (origin && !request.url.startsWith('/websockets')) {
        response.setHeader('Access-Control-Allow-Origin', origin)
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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
            const parsed = url.parse(request.url, true)
            const post = qs.parse(body)
            const filename = parsed.pathname
            if (filename === '/api/') {
              self.processApiCall(post, response)
            } else {
              self.sendFile(filename, response)
            }
          })
        } else {
          const parsed = url.parse(request.url, true)
          const filename = parsed.pathname
          if (filename === '/api/') {
            self.processApiCall(parsed.query, response)
          } else {
            self.sendFile(filename, response)
          }
        }
    }

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
      sockjs_url: './assets/js/sockjs.min.js',
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
        } catch (e) {

        }
      })
    })

    this.sockjs_server.installHandlers(this.server, {
      prefix: '/websockets'
    })

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
    Object.keys(this.connections).map((connId) => {
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
          objDev.devices.map(device => {
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
              device.channels.map(channel => {
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
    result.update = this._version
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

  // make it fucking Node8 compatible
  getHTTP (urlStr, options) {
    return new Promise((resolve, reject) => {
      if (!options) {
        options = {}
      }
      const q = url.parse(urlStr, true)
      options.path = q.pathname
      options.host = q.hostname
      options.port = q.port

      https.get(options, (resp) => {
        let data = ''

        resp.on('data', (chunk) => {
          data += chunk
        })

        resp.on('end', () => {
          resolve(data)
        })
      }).on('error', (err) => {
        reject(err)
      })
    })
  }

  async updateSystem () {
    // first create a backup of users config
    const backupFile = await this.generateBackup()
    // move the backup to the config folder
    const version = this.fetchVersion()
    const autoBackupFile = path.join(process.env.UIX_CONFIG_PATH, 'hap-autobackup_' + version + '.tar.gz')
    try {
      if (fs.existsSync(backupFile)) {
        if (fs.existsSync(autoBackupFile)) {
          fs.unlinkSync(autoBackupFile)
        }
        fs.copyFileSync(backupFile, autoBackupFile)
      }
      // get the update command and run it
    } catch (e) {
      return { error: 'autobackup failed' }
    }
    const packageFile = path.join(__dirname, '..', '..', 'package.json')
    if (fs.existsSync(packageFile)) {
      try {
        const packageData = JSON.parse(fs.readFileSync(packageFile))
        if ((packageData) && (packageData.scripts)) {
          const updateScript = packageData.scripts.update
          const restartScript = packageData.scripts.restart
          if ((updateScript) && (restartScript)) {
            const childprocess = require('child_process')
            childprocess.execSync(updateScript)
            setTimeout(() => {
              childprocess.execSync(restartScript)
            }, 500)
          }
        }
      } catch (e) {
        const message = 'unable to get the update command ' + e.stack
        return { error: message }
      }
    }
  }

  restartSystem () {
    // get the update command and run it
    const packageFile = path.join(__dirname, '..', '..', 'package.json')
    if (fs.existsSync(packageFile)) {
      try {
        const packageData = JSON.parse(fs.readFileSync(packageFile))
        if ((packageData) && (packageData.scripts)) {
          const restartScript = packageData.scripts.restart
          this.log.debug('restart command will be %s called in 500ms', restartScript)
          if (restartScript) {
            const childprocess = require('child_process')
            setTimeout(() => {
              childprocess.execSync(restartScript)
            }, 500)
          }
        }
      } catch (e) {
        return { error: 'unable to get the restart command' }
      }
    }
  }

  deviceWithUUID (uuid) {
    let result
    this.pluginAccessories.map(device => {
      if (device.UUID === uuid) {
        result = device
      }
    })
    return result
  }

  specialDeviceWithUUID (uuid) {
    let result
    this.pluginSpecial.map(device => {
      if (device.UUID === uuid) {
        result = device
      }
    })
    return result
  }

  bridgeWithId (uuid) {
    let result
    this.bridges.map(bridge => {
      if (bridge.id === uuid) {
        result = bridge
      }
    })
    return result
  }

  variableWithName (varName) {
    let result
    this.allVariables.map(variable => {
      if ((variable.isCompatible === true) && (variable.name === varName)) {
        result = variable
      }
    })
    return result
  }

  programWithName (progName) {
    let result
    this.compatiblePrograms.map(program => {
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
      this.compatibleDevices.map(device => {
        if (device.channels) {
          device.channels.map(channel => {
            if (channel.address === channelAddress) {
              const s1 = self.services[channel.type]
              if (s1) {
                s1.map(item => {
                  // make sure we do not filter this device
                  if ((item.filterDevice) && (item.filterDevice.indexOf(device.type) === -1)) {
                    result.service.push(item)
                  }
                })
              }
              const s2 = self.services[device.type + ':' + channel.type]
              if (s2) {
                s2.map(item => {
                  result.service.push(item)
                })
              }
            }
          })
        }
      })
      if (this.pluginSpecial) {
        // also map the special devices
        this.pluginSpecial.map(spdevice => {
          const chadr = spdevice.serial + ':' + spdevice.channel
          if (chadr === channelAddress) {
            // find service
            self.services.SPECIAL.map(item => {
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
      this.services.VARIABLE.map(item => {
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
              filtered.map((item) => {
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
      Object.keys(config.mappings).map((mapping) => {
        const hkDeviceMapping = config.mappings[mapping]
        if ((hkDeviceMapping.settings) && (hkDeviceMapping.settings.showGraph) && (hkDeviceMapping.settings.showGraph !== 'DONT_SHOW')) {
          self.graphes.push({ id: mapping, item: hkDeviceMapping.settings.showGraph, name: hkDeviceMapping.name })
        }
      })
    }

    // check if we have saved files
    this.graphes.map((graph) => {
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
      Object.keys(settings.instanceIDs).map((oKey) => {
        instance.push(settings.instanceIDs[oKey])
      })
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
        Object.keys(settings).map((key) => {
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

    listChannelz.map(aChannel => {
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
    self.log.debug('[Config] savePublishingFlag old Data %s', JSON.stringify(configData))
    bridges.map(bridgeId => {
      self.log.debug('[Config] savePublishingFlag %s', bridgeId)
      const oBridge = configData.instances[bridgeId]
      oBridge.publishDevices = true
    })
    self.log.debug('[Config] savePublishingFlag new Data %s', JSON.stringify(configData))
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
    let code = Math.floor(10000000 + Math.random() * 90000000) + ''
    code = code.split('')
    code.splice(3, 0, '-')
    code.splice(6, 0, '-')
    code = code.join('')
    return code
  }

  generateSetupID () {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const bytes = crypto.randomBytes(4)
    let setupID = ''

    for (let i = 0; i < 4; i++) {
      const index = bytes.readUInt8(i) % 26
      setupID += chars.charAt(index)
    }

    return setupID
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
      Object.keys(data).map(roomId => {
        const bridgeData = data[roomId]
        if (bridgeData.create === true) {
          let isUnique = true
          const name = bridgeData.name
          const roomId = parseInt(bridgeData.roomID)
          // check unique name
          Object.keys(configData.instances).map(bridgeId => {
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
      Object.keys(configData.instances).map(bridgeId => {
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
        Object.keys(config.mappings).map(deviceId => {
          const device = config.mappings[deviceId]
          if (device.instance === uuid) {
            device.instance = 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab'
          }
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
      // we have to remove - $config/persist/AccessoryInfo.$mac.json and IdentifierCache.$mac.json
      const mac = bridge.user.replace(':', '')
      const ainfoFile = path.join(process.env.UIX_CONFIG_PATH, 'persist', 'AccessoryInfo' + mac + '.json')
      if (fs.existsSync(ainfoFile)) {
        fs.unlinkSync(ainfoFile)
      }
      const aICacheFile = path.join(process.env.UIX_CONFIG_PATH, 'persist', 'IdentifierCache' + mac + '.json')
      if (fs.existsSync(aICacheFile)) {
        fs.unlinkSync(aICacheFile)
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
        Object.keys(settings).map((key) => {
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
      this.pluginRooms.map(room => {
        const oRoom = { id: room.id, name: room.name, devices: [] }
        const cList = room.channels
        this.compatibleDevices.map(device => {
          const dCList = []
          device.channels.map(channel => {
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
      let config = this.loadSettings()

      if (config === undefined) {
        config = {}
      }
      config.useCCCAuthentication = ((oSettings.useAuth === true) || (oSettings.useAuth === 'true'))
      config.useTLS = ((oSettings.useTLS === true) || (oSettings.useTLS === 'true'))
      config.enableMonitoring = ((oSettings.enableMonitoring === true) || (oSettings.enableMonitoring === 'true'))
      config.disableHistory = ((oSettings.disableHistory === true) || (oSettings.disableHistory === 'true'))
      // make sure we have the value set
      if (oSettings.interfaceWatchdog) {
        if ((oSettings.interfaceWatchdog > 0) && (oSettings.interfaceWatchdog < 300)) {
          oSettings.interfaceWatchdog = 300 // min is 300seconds
        }
        config.interfaceWatchdog = oSettings.interfaceWatchdog
      }
      this.saveSettings(config)
    }
  }

  ccuPost (port, path, body) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
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
      Object.keys(parameters).map((key) => {
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
        const rega = new Rega(self.log, '127.0.0.1', 'isValidCCUSession')
        rega.script(script).then(regaResult => {
          const rgx = /^([0-9]*);([0-9])*;([^;]*);([^;]*);([^;]*);$/
          const usrPrts = rgx.exec(regaResult)
          self.log.debug('[Config] check auth %s', usrPrts)
          if ((usrPrts) && (usrPrts.length > 2)) {
            self.renewCCUSession(prts[1]) // renew the session in ccu
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

  fetchUpdateChangelog () {
    return new Promise(async (resolve, reject) => {
      const version = this.fetchVersion()
      const rgx = RegExp('([a-zA-Z 0-9.:\n=*-]{1,})(?=Changelog for ' + version + ')')
      const strChangeLog = await this.getHTTP('https://raw.githubusercontent.com/thkl/homekit-ccu/master/CHANGELOG.md', { headers: { 'Cache-Control': 'no-cache' } })
      const rst = rgx.exec(strChangeLog)
      resolve(((rst) && (rst.length > 0)) ? rst[0] : 'No remote changelog found')
    })
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
    const childprocess = require('child_process')
    try {
      childprocess.execSync('tar -xzf ' + tmpFile + ' -C ' + tmpDir)
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
        // create the new persist folder
        const persistFolder = path.join(process.env.UIX_CONFIG_PATH, 'persist')

        if (!fs.existsSync(persistFolder)) {
          fs.mkdirSync(persistFolder)
          // copy all persist data to the config path
          fs.readdir(path.join(tmpDir, 'persist'), (err, files) => {
            if (!err) {
              files.forEach(file => {
                fs.copyFileSync(path.join(tmpDir, 'persist', file), path.join(persistFolder, file))
              })
            }
          })
        }
        // remove the uploaded file
        fs.unlinkSync(tmpFile)
        return true
      } else {
        return false
      }
    } catch (e) {
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
    const { formidable } = require('formidable')
    const form = formidable({ multiples: false })
    const self = this
    const first = (value) => Array.isArray(value) ? value[0] : value
    form.parse(request, async (err, fields, files) => {
      if (err) {
        self.log.error('[Config] restore upload failed: %s', err.message)
      } else if (first(fields.method) === 'restore') {
        const sidOk = await self.checkSid(first(fields.sid), response)
        if (sidOk) {
          const upload = first(files.file)
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
    })
  }

  async checkSid (sid, response) {
    if (this.useAuth === true) {
      // check if the provide sid is valid and the user has level 8
      const validuser = await this.isValidCCUSession(sid)
      if (validuser === false) {
        this.log.error('[Config] invalid user')
        response.writeHead(401, 'Unauthorized')
        response.end('Unauthorized')
        return false
      }
    }
    return true
  }

  async processApiCall (query, response) {
    // if we are using ccu's authentication system
    const isValidUserSession = await this.checkSid(query.sid, response)
    if (isValidUserSession === false) {
      return
    }
    if (query.method) {
      const sid = this.extractSid(query.sid)
      let readStream
      switch (query.method) {
        case 'ccuGetDatapoints':
          const dps = await this.ccuGetDatapoints(query.cid)
          this.sendJSON(dps, response)
          break

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
        case 'variablelist':
          const srvList = this.getVariableServiceList()
          this.sendJSON({ variables: this.pluginVariables, trigger: this.pluginVariableTrigger, services: srvList }, response)
          break

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
        case 'system':
          const sysData = await this.getSystemInfo()
          this.sendJSON(sysData, response)
          break

        /** publish the hap instances to homekit */
        case 'publish':
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

        /** send the list of compatible ccu devices back to the js application */
        case 'newDevice':
          // send a list with compatible devices
          var list = []
          this.compatibleDevices.map(device => {
            const lCha = []
            const oDev = { device: device.address, name: device.name, type: device.type }
            device.channels.map(channel => {
              if (channel.isSuported === true) {
                lCha.push({ id: channel.id, address: channel.address, name: channel.name, type: channel.type })
              }
            })
            oDev.channels = lCha
            list.push(oDev)
          })
          this.sendJSON({ devices: list }, response)
          break
        case 'createapplicanceswizzard':
          this.sendJSON(this.createapplicancesWizzard(query.instanceId, JSON.parse(query.payload)), response)
          break
        case 'newVariable':
          const varlist = this.allVariables.filter(variable => variable.isCompatible === true)
          this.sendJSON({ variables: varlist }, response)
          break

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
            this.services.SPECIAL.map(item => {
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
        case 'createinstance':
          const newBridgeList = await this.createInstance(query)
          this.sendJSON(newBridgeList, response)
          break

        case 'createinstancewizzard':
          const payload = query.payload
          this.log.debug('[Config] creating instances from wizzard %s', payload)
          const newBridgeListW = await this.createMultipleInstances(payload)
          this.sendJSON(newBridgeListW, response)
          break

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

        case 'saveVariableTrigger':
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

        case 'wizzardRooms':
          this.sendJSON(this.generateRoomListWithSupportedDevices(), response)
          break

        case 'update':
          this.sendJSON(this.updateSystem(), response)
          break

        case 'restart':
          // check if we should turn debug mode on
          if (query.debug === 'true') {
            // create a indicator in /tmp named .hapdebug
            const fdebug = path.join(fs.realpathSync(os.tmpdir()), '.hapdebug')
            fs.closeSync(fs.openSync(fdebug, 'w'))
          }
          this.sendJSON({ response: 'ok' }, response)
          this.log.info('performing restart')
          this.restartSystem()
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
          this.sendJSON({ response: 'ok' }, response)
          this.restartSystem()
          break

        case 'getLog':

          var stat = fs.statSync(this.logfile)

          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename=homekit-ccu-log.txt',
            'Content-Length': stat.size
          })

          readStream = fs.createReadStream(this.logfile)
          readStream.pipe(response)
          break

        case 'backup':
          this.log.info('[Config] backup Command')
          const backupFile = await this.generateBackup()
          if (fs.existsSync(backupFile)) {
            const statBf = fs.statSync(backupFile)
            const d = new Date()
            response.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename=homekit-ccu-backup-${d.getDate()}_${d.getMonth() + 1}_${d.getFullYear()}_${d.getHours()}_${d.getMinutes()}_${d.getSeconds()}.tar.gz`,
              'Content-Length': statBf.size
            })

            readStream = fs.createReadStream(backupFile)
            readStream.pipe(response)
          } else {
            this.sendJSON({ error: 'backup file not found', path: backupFile }, response)
          }
          break

        case 'changelog':
          const cFile = path.join(__dirname, '..', '..', 'CHANGELOG.md')
          if (fs.existsSync(cFile)) {
            const stat = fs.statSync(cFile)
            response.writeHead(200, {
              'Content-Type': 'text/markdown',
              'Content-Length': stat.size
            })
            readStream = fs.createReadStream(cFile)
            readStream.pipe(response)
          } else {
            this.sendJSON({ error: 'changelog not found', path: cFile }, response)
          }
          break

        case 'updateChangelog':
          response.writeHead(200, {
            'Content-Type': 'text/markdown'
          })
          const msg = await (this.fetchUpdateChangelog())
          response.end(msg)
          break

        case 'support':
          const sData = this.getSupportData(query.address)
          var fileName = '_device.json'
          if ((sData) && (sData.devices)) {
            fileName = sData.devices[0].type + '.json'
          }
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename=' + fileName
          })

          response.end(JSON.stringify(sData, ' ', 2))
          break

        case 'listGraph':
          this.checkGraphes()
          response.end(JSON.stringify(this.graphes, ' ', 2))

          break

        case 'resetInstance':
          this.resetInstance(query)
          break

        case 'graphDetail':
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
        case 'checklost':
          const result = this.checkDevicesStillExists()
          response.end(JSON.stringify(result))
          break
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
      this.bridges.map((bridge) => {
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

const logger = new Logger('HAP ConfigServer')
logger.setDebugEnabled(process.env.UIX_DEBUG)
const pcs = new ConfigurationService(logger)
pcs.run()
pcs.process = process

logger.info('[Config] server is up and running messaging daemon about that')
process.send({
  topic: 'cfghello'
})

setInterval(() => {
  if (!process.connected) {
    console.log('[Config] Shutdown Configuration Service')
    pcs.shutdown()
    process.exit()
  }
}, 10000)

process.on('message', (message) => {
  pcs.handleIncommingIPCMessage(message)
})

process.on('disconnect', () => {
  logger.info('[Config] Shutdown Configuration Service')
  pcs.shutdown()
  process.exit()
})
