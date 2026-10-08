/*
 * File: HomeMaticCCU.js
 * Project: homekit-ccu
 * File Created: Saturday, 7th March 2020 2:20:39 pm
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
const fs = require('fs')
const Rega = require(path.join(__dirname, 'HomeMaticRegaRequest.js'))
const { isActionDatapoint, bulkReadScripts, parseBulkRead } = require(path.join(__dirname, 'util', 'regaBulkRead.js'))
const HomeMaticRPC = require(path.join(__dirname, 'HomeMaticRPC.js'))
const MonitConfig = require(path.join(__dirname, 'monitConfig.js'))
const url = require('url')
const EventEmitter = require('events')

// the values are kept by the RPC events; a periodic bulk read catches events that got lost
const VALUE_REFRESH_INTERVAL = 15 * 60 * 1000

class HomeMaticCCU extends EventEmitter {
  constructor (log, configuration) {
    super()
    this.log = log
    this.interfaces = {}
    this.cachedValues = {}
    this.pendingReads = new Map()
    this.eventCallbacks = {}
    this.variableCallbacks = {}
    this.configuration = configuration
    this.eventDataPoints = []
    this.ccuIP = configuration.ccuIP || '127.0.0.1'
    this.ccuDCDevices = {}
    this.log.debug('[CCU] init CCU Connections for %s', this.ccuIP)
    this.configurationPath = configuration.storagePath
    this.monitConfig = new MonitConfig(log)
  }

  prepareConnections () {
    const self = this
    this.log.debug('[CCU] preparing connections cleaning event table')
    this.eventCallbacks = {}
    // the start values of the datapoints registered from now on come with one bulk read
    this.startValuesPending = true
    return new Promise((resolve, reject) => {
      self._fetchInterfaces().then(o => {
        resolve()
      })
    })
  }

  async pingRega () {
    this.log.info('[CCU] check Rega is alive')
    return new Promise((resolve, reject) => {
      const rega = new Rega(this.log, this.ccuIP, 'Ping', 5)
      try {
        rega.script('Write("Pong");', 0).then(result => {
          if (result !== 'Pong') {
            this.log.warn('[CCU] Rega ping got unexpected response: "%s"', result || '(empty)')
          }
          resolve(result === 'Pong')
        }).catch(e => {
          reject(e)
        })
      } catch (e) {
        resolve(e)
      }
    })
  }

  getChannelByAddress (chAddress) {
    let result
    const dl = this.getCCUDevices()
    for (let di = 0; di < dl.length; di++) {
      const device = dl[di]
      if ((device.address) && (device.address.length > 1) && (chAddress.indexOf(device.address) > -1)) {
        for (let ci = 0; ci < device.channels.length; ci++) {
          const channel = device.channels[ci]
          if (channel.address === chAddress) {
            channel.dtype = device.type
            channel.dname = device.name
            result = channel

            break
          }
        }
      }
    }
    return result
  }

  getCCUDevices () {
    return this.unescapeDevices(this.devices || [])
  }

  getVariables () {
    return this.variables || []
  }

  getPrograms () {
    return this.programs || []
  }

  getRooms () {
    return this.rooms || []
  }

  /** the functions ("Gewerke") of the CCU: [{ id, name, channels: [channel ids] }] */
  getFunctions () {
    return this.functions || []
  }

  variableWithName (varName) {
    let result
    this.getVariables().forEach(variable => {
      if (variable.name === varName) {
        result = variable
      }
    })
    return result
  }

  unescapeDevices (devices) {
    const self = this
    if (devices) {
      try {
        devices.forEach(device => {
          device.name = unescape(device.name)
          device.channels.forEach(channel => {
            try {
              channel.name = unescape(channel.name)
            } catch (e) {
              self.log.error('decoding error channel name %s', device.name)
            }
          })
        })
      } catch (e) {
        self.log.error('decoding error for %s', JSON.stringify(devices))
      }
    }
    return devices
  }

  unescapeVariables (variables) {
    const self = this
    if (variables) {
      try {
        variables.forEach(variable => {
          variable.name = unescape(variable.name)
          variable.dpInfo = unescape(variable.dpInfo)
          variable.valuelist = unescape(variable.valuelist)
          variable.unit = unescape(variable.unit)
        })
      } catch (e) {
        self.log.error('decoding error for %s', JSON.stringify(variables))
      }
    }
    return variables
  }

  async loadDatabases (configurationPath, dryRun = false) {
    this.configurationPath = configurationPath
    this.log.info('[CCU] loading databases from %s', this.configurationPath)
    // the files keep the names as Rega writes them (UriEncode), they are unescaped once loaded
    this.devices = await this.loadObjectDatabase(path.join(configurationPath, 'devices.json'), 'devices', dryRun, () => this.fetchAllDevices())
    this.log.info('[CCU] device database loaded %s devices found', (this.devices) ? this.devices.length : 0)
    // since we are using uriencode in the script we have to unescape the names again

    this.devices = this.unescapeDevices(this.devices || [])

    const variables = await this.loadObjectDatabase(path.join(configurationPath, 'variables.json'), 'variables', dryRun, () => this.fetchVariables())

    this.variables = this.unescapeVariables(variables)

    if (this.variables === undefined) {
      this.variables = []
    }
    this.log.info('[CCU] variable database loaded %s variables found', (this.variables) ? this.variables.length : 0)

    this.programs = await this.loadObjectDatabase(path.join(configurationPath, 'programs.json'), 'programs', dryRun, () => this.fetchPrograms())
    if (this.programs === undefined) {
      this.programs = []
    }
    this.log.info('[CCU] program database loaded %s programs found', (this.programs) ? this.programs.length : 0)

    this.rooms = await this.loadObjectDatabase(path.join(configurationPath, 'rooms.json'), 'rooms', dryRun, () => this.fetchRooms())
    if (this.rooms === undefined) {
      this.rooms = []
    }
    this.log.info('[CCU] room database loaded %s rooms found', (this.rooms) ? this.rooms.length : 0)

    this.functions = await this.loadObjectDatabase(path.join(configurationPath, 'functions.json'), 'functions', dryRun, () => this.fetchFunctions())
    if (this.functions === undefined) {
      this.functions = []
    }
    this.log.info('[CCU] function database loaded %s functions found', this.functions.length)
  }

  // the list `type` of the cached database, fetched from the CCU when the file is missing or
  // unusable (an older version saved an empty answer as [] or {}); undefined when that fails too
  async loadObjectDatabase (databasePath, type, dryRun, fetchFunction) {
    this.log.info('[CCU] loading object database for %s from %s', type, databasePath)
    if (fs.existsSync(databasePath)) {
      let oDb
      try {
        oDb = JSON.parse(fs.readFileSync(databasePath))
      } catch (e) {
        this.log.warn('[CCU] unable to parse cached database.')
      }
      if (oDb && Array.isArray(oDb[type])) {
        this.log.info('[CCU] object database loaded %s objects found', oDb[type].length)
        return oDb[type]
      }
      this.log.error('[CCU] unable to load object database will get a new one')
    } else {
      this.log.error('[CCU] databse not found get a new one')
    }
    if (dryRun) {
      this.log.warn('[CCU] test mode do not fetch anything')
      return undefined
    }
    const result = await this.updateObjectDatabase(databasePath, fetchFunction)
    return result ? result[type] : undefined
  }

  // fetches a database from the CCU and saves it; when the fetch fails the saved file stays as it
  // is and the result is undefined: an empty answer of a busy Rega must not replace the devices,
  // variables and programs of the CCU, also not after the next start
  async updateObjectDatabase (databasePath, fetchFunction) {
    let oResult
    try {
      oResult = await fetchFunction()
    } catch (e) {
      this.log.warn('[CCU] %s not updated, the CCU did not answer: %s', path.basename(databasePath), e.message || e)
      return undefined
    }
    await fs.promises.writeFile(databasePath, JSON.stringify(oResult, ' ', 2)).catch(e => {
      this.log.error('[CCU] unable to save %s: %s', databasePath, e.message)
    })
    return oResult
  }

  async updateDeviceDatabase (configuratonPath) {
    if ((this.deviceDBUpdateRunning) || (this.dryRun)) {
      this.log.debug('[CCU] updateDeviceDatabase is running skip other call')
      return
    }
    this.deviceDBUpdateRunning = true
    try {
      const result = await this.updateObjectDatabase(path.join(this.configurationPath, 'devices.json'), () => this.fetchAllDevices())
      if (result) {
        this.devices = result.devices
        this.emit('devicelistchanged', null)
      }
    } finally {
      this.deviceDBUpdateRunning = false
    }
  }

  // each database is replaced only by a complete answer of the CCU, a failed one keeps the last
  async updateDatabases (databasePath) {
    if (this.dryRun) {
      return
    }
    const update = (file, fetchFunction) => this.updateObjectDatabase(path.join(databasePath, file), fetchFunction)
    let result = await update('variables.json', () => this.fetchVariables())
    if (result) {
      this.variables = this.unescapeVariables(result.variables)
    }
    result = await update('programs.json', () => this.fetchPrograms())
    if (result) {
      this.programs = result.programs
    }
    result = await update('rooms.json', () => this.fetchRooms())
    if (result) {
      this.rooms = result.rooms
    }
    result = await update('functions.json', () => this.fetchFunctions())
    if (result) {
      this.functions = result.functions
    }
  }

  async shutdown () {
    this.log.debug('[CCU] shutdown')
    await this.disconnectInterfaces()
    this.log.debug('[CCU] shutdown completed')
  }

  async disconnectInterfaces () {
    this.stopValueRefresh()
    if (this.rpc) {
      await this.rpc.disconnectInterfaces()
      this.rpc.resetInterfaces()
      this.rpc.removeAllListeners('event')
    }
  }

  fetchAllDevices () {
    const self = this
    return new Promise((resolve, reject) => {
      this.eventaddresses = []
      let script = '!devices\nstring sDeviceId;string sChannelId;boolean df = true;Write(\'{"devices":[\');foreach(sDeviceId, root.Devices().EnumIDs()){object oDevice = dom.GetObject(sDeviceId);if(oDevice){if(df) {df = false;} else { Write(\',\');}Write(\'{\');'

      script = script + self._scriptPartForElement('id', 'sDeviceId', 'number', ',')
      script = script + self._scriptPartForElement('name', 'oDevice.Name().UriEncode()', 'urlstring', ',')
      script = script + self._scriptPartForElement('address', 'oDevice.Address()', 'string', ',')
      script = script + self._scriptPartForElement('type', 'oDevice.HssType()', 'string', ',')
      script = script + 'Write(\'"channels": [\');boolean bcf = true;foreach(sChannelId, oDevice.Channels().EnumIDs()){object oChannel = dom.GetObject(sChannelId);'
      script = script + 'if(bcf) {bcf = false;} else {Write(\',\');}Write(\'{\');'
      script = script + self._scriptPartForElement('id', 'sChannelId', 'number', ',')
      script = script + self._scriptPartForElement('name', 'oChannel.Name().UriEncode()', 'urlstring', ',')
      script = script + self._scriptPartForElement('intf', 'oDevice.Interface()', 'number', ',')
      script = script + self._scriptPartForElement('address', 'oChannel.Address()', 'string', ',')
      script = script + self._scriptPartForElement('type', 'oChannel.HssType()', 'string', ',')
      script = script + self._scriptPartForElement('access', 'oChannel.UserAccessRights(iulOtherThanAdmin)', 'number')
      script = script + 'Write(\'}\');}Write(\']}\');}}Write(\']\');'
      script += 'var s = dom.GetObject("'
      script += this.subsection
      script += '");string cid;boolean sdf = true;if (s) {Write(\',"subsection":[\');foreach(cid, s.EnumUsedIDs()){ '
      script += ' if(sdf) {sdf = false;}'
      script += ' else { Write(\',\');}Write(cid);}Write(\']\');}'

      script += 'Write(\'}\');'

      resolve(self.fetchDatabase('fetchAllDevices', script, 'devices'))
    })
  }

  fetchVariables () {
    const self = this
    return new Promise((resolve, reject) => {
      let script = '!variables\nstring varid;boolean df = true;Write(\'{"variables":[\');foreach(varid, dom.GetObject(ID_SYSTEM_VARIABLES).EnumIDs()){object ovar = dom.GetObject(varid);if(df) {df = false;} else { Write(\',\');}Write(\'{\')'
      script = script + self._scriptPartForElement('id', 'varid', 'number', ',')
      script = script + self._scriptPartForElement('name', 'ovar.Name().UriEncode()', 'urlstring', ',')
      script = script + self._scriptPartForElement('dpInfo', 'ovar.DPInfo().UriEncode()', 'urlstring', ',')
      script = script + self._scriptPartForElement('unerasable', 'ovar.Unerasable()', 'string', ',')
      script = script + self._scriptPartForElement('valuetype', 'ovar.ValueType()', 'number', ',')
      script = script + self._scriptPartForElement('subtype', 'ovar.ValueSubType()', 'number', ',')
      script = script + self._scriptPartForElement('minvalue', 'ovar.ValueMin()', 'string', ',')
      script = script + self._scriptPartForElement('maxvalue', 'ovar.ValueMax()', 'string', ',')
      script = script + self._scriptPartForElement('valuelist', 'ovar.ValueList().UriEncode()', 'string', ',')
      script = script + self._scriptPartForElement('unit', 'ovar.ValueUnit().UriEncode()', 'urlstring', '')

      script = script + 'Write(\'}\');} Write(\']}\');'

      resolve(self.fetchDatabase('fetchVariables', script, 'variables'))
    })
  }

  fetchPrograms () {
    const self = this
    return new Promise((resolve, reject) => {
      let script = '!programs\nstring prgid;boolean df = true;Write(\'{"programs":[\');foreach(prgid, dom.GetObject(ID_PROGRAMS).EnumIDs()){object oprg = dom.GetObject(prgid);if(df) {df = false;} else { Write(\',\');}Write(\'{\')'
      script = script + self._scriptPartForElement('id', 'prgid', 'number', ',')
      script = script + self._scriptPartForElement('name', 'oprg.Name()', 'urlstring', ',')
      script = script + self._scriptPartForElement('dpInfo', 'oprg.PrgInfo()', 'urlstring', '')
      script = script + 'Write(\'}\');} Write(\']}\');'

      resolve(self.fetchDatabase('fetchPrograms', script, 'programs'))
    })
  }

  fetchRooms () {
    return this.fetchChannelGroups('ID_ROOMS', 'rooms')
  }

  fetchFunctions () {
    return this.fetchChannelGroups('ID_FUNCTIONS', 'functions')
  }

  /** the rooms (ID_ROOMS) or functions (ID_FUNCTIONS) of the CCU as { [key]: [{ id, name, channels }] } */
  fetchChannelGroups (listId, key) {
    const self = this
    return new Promise((resolve, reject) => {
      let script = '!' + key + '\nstring rid;boolean df = true;Write(\'{"' + key + '":[\');foreach(rid, dom.GetObject(' + listId + ').EnumIDs()){object oRoom = dom.GetObject(rid);if(df) {df = false;} else { Write(\',\');}Write(\'{\')'
      script = script + self._scriptPartForElement('id', 'rid', 'number', ',')
      script = script + self._scriptPartForElement('name', 'oRoom.Name()', 'urlstring', ',')
      script = script + self._scriptPartForElement('channels', 'oRoom.EnumUsedIDs()', 'enumeration', '')
      script = script + 'Write(\'}\');} Write(\']}\');'

      resolve(self.fetchDatabase('fetch ' + key, script, key))
    })
  }

  // the answer of a database script as object; rejects when Rega fails or the answer has no list
  // `key` (cut off, or an error text of Rega), so that it is never taken for an empty CCU
  async fetchDatabase (tag, script, key) {
    let answer
    try {
      answer = await this.runRega(tag, script, { background: true })
    } catch (e) {
      this.log.error('[CCU] %s failed: %s', tag, e.message || e)
      throw e
    }
    const oResult = this.parseResult(answer)
    if (!oResult || !Array.isArray(oResult[key])) {
      throw new Error('the answer of ' + tag + ' has no ' + key)
    }
    return oResult
  }

  parseResult (strJson) {
    try {
      return JSON.parse(strJson)
    } catch (e) {
      this.log.error('[CCU] Error while parsing json %s - (str is %s)', e, strJson)
      return {}
    }
  }

  hazDatapoint (dpName) {
    const self = this
    if (typeof dpName === 'object') {
      dpName = dpName.address()
    }
    return new Promise((resolve, reject) => {
      const script = 'Write(\'{"result":\');var x = dom.GetObject("' + dpName + '");if (x) {Write("true");}else{Write("false");}Write("}");'
      const rega = new Rega(self.log, self.ccuIP, 'hazDatapoint')
      rega.script(script).then(data => {
        let hdp = false
        try {
          const obj = JSON.parse(data)
          if ((obj) && (obj.result === true)) {
            hdp = true
          }
        } catch (e) {

        }
        self.log.debug('[CCU] check HazDP %s result is %s', dpName, hdp)
        resolve(hdp)
      }).catch(e => {
        self.log.error('[CCU] hazDatapoint failed for %s: %s', dpName, e.message || e)
        resolve(false)
      })
    })
  }

  setValue (address, newValue) {
    const self = this
    return new Promise((resolve, reject) => {
      let script = 'object o = dom.GetObject(\'' + address + '\');if (o){'
      if (typeof newValue === 'string') {
        script = script + 'o.State(\'' + newValue + '\');}'
      } else {
        script = script + 'o.State(' + newValue + ');}'
      }
      const rega = new Rega(self.log, self.ccuIP, 'setValue')
      rega.script(script).then((r) => {
        self.setCache(address, newValue)
        resolve(r)
      }).catch(e => {
        self.log.error('[CCU] setValue failed for %s: %s', address, e.message || e)
        reject(e)
      })
    })
  }

  // A read for HomeKit. The CCU reports every change of a datapoint by an RPC event, so a known value
  // is current; Rega (one script at a time) is asked only for values not known yet. ignoreCache no
  // longer sends every read to Rega: with all values of Apple Home read at once that queue took
  // longer than the 10 s of hap-nodejs and devices showed "No Response". To ask the device state
  // anew (after a command, when an expected event may be missing) use requeryValue.
  getValue (address, ignoreCache = false) {
    const cached = this.getCache(address)
    if ((cached !== undefined) && (cached !== 'undefined')) {
      this.log.debug('[CCU] %s return cached value %s', address, cached)
      return Promise.resolve(cached)
    }
    return this.readValue(address)
  }

  // the current value from Rega, passed on to the accessories like an event
  requeryValue (address) {
    return this.readValue(address)
  }

  // one Rega request per address, shared by reads that come in while it runs
  readValue (address) {
    const self = this
    if (this.pendingReads.has(address)) {
      return this.pendingReads.get(address)
    }
    this.log.debug('[CCU] ask Rega %s', address)
    const script = 'object o = dom.GetObject(\'' + address + '\');if (o){Write(o.Value());}'
    const read = this.runRega('getValue', script).then((regaResult) => {
      self.setCache(address, regaResult)
      self.fireEvent(address, regaResult)
      return regaResult
    }).finally(() => self.pendingReads.delete(address))
    this.pendingReads.set(address, read)
    return read
  }

  // background: work that waits behind the reads and commands of Apple Home in the Rega queue
  runRega (tag, script, { background = false } = {}) {
    const rega = new Rega(this.log, this.ccuIP, tag)
    rega.background = background
    return rega.script(script)
  }

  // Reads the given datapoints with a few scripts. The first read passes every value on to the
  // accessories (their start values, as the single read at registration did before); later reads
  // only pass on values that changed without an event. Stops when a reload or shutdown stops it.
  async refreshValues (addresses, initial = false) {
    const run = this.refreshRun
    for (const script of bulkReadScripts(addresses)) {
      let values
      try {
        values = parseBulkRead(await this.runRega('refreshValues', script, { background: true }), addresses)
      } catch (e) {
        this.log.warn('[CCU] reading the current values failed: %s', e.message)
        return
      }
      if (run !== this.refreshRun) return
      Object.keys(values).forEach(address => {
        const known = this.getCache(address)
        this.setCache(address, values[address])
        if (initial || ((known !== undefined) && (known !== values[address]))) {
          this.fireEvent(address, values[address])
        }
      })
    }
  }

  // all datapoints the accessories listen to: now, and again every 15 minutes
  async startValueRefresh () {
    this.stopValueRefresh()
    this.valueRefreshTimer = setInterval(() => this.refreshValues(Object.keys(this.eventCallbacks)), VALUE_REFRESH_INTERVAL)
    this.valueRefreshTimer.unref()
    const run = this.refreshRun
    try {
      await this.refreshValues(Object.keys(this.eventCallbacks), true)
    } finally {
      // a reload meanwhile has start values of its own pending
      if (run === this.refreshRun) this.startValuesPending = false
    }
  }

  stopValueRefresh () {
    clearInterval(this.valueRefreshTimer)
    this.valueRefreshTimer = undefined
    this.refreshRun = (this.refreshRun || 0) + 1 // a bulk read still running ends after its script
  }

  getVariableValue (variable) {
    const self = this
    return new Promise((resolve, reject) => {
      const script = 'object o = dom.GetObject(ID_SYSTEM_VARIABLES).Get(\'' + variable + '\');if (o){Write(o.State());}'
      const rega = new Rega(self.log, self.ccuIP, 'getVariableValue')
      rega.script(script).then((regaResult) => {
        self.log.debug('[CCU] %s return variable value %s', variable, regaResult)
        self.fireVariableEvent(variable, regaResult)
        resolve(regaResult)
      }).catch(e => {
        self.log.error('[CCU] getVariableValue failed for %s: %s', variable, e.message || e)
        reject(e)
      })
    })
  }

  setVariable (variable, value) {
    const self = this
    return new Promise((resolve, reject) => {
      const script = 'object o = dom.GetObject(ID_SYSTEM_VARIABLES).Get(\'' + variable + '\');if (o){Write(o.State(' + value + '));} else {Write(\'variable not found by rega\');}'
      const rega = new Rega(self.log, self.ccuIP, 'setVariable')
      rega.script(script).then((regaResult) => {
        resolve(regaResult)
      }).catch(e => {
        self.log.error('[CCU] setVariable failed for %s: %s', variable, e.message || e)
        reject(e)
      })
    })
  }

  runProgram (programName) {
    const self = this
    return new Promise((resolve, reject) => {
      const script = 'object o = dom.GetObject(ID_PROGRAMS).Get(\'' + programName + '\');if (o){Write(o.ProgramExecute());} else {Write(\'program not found by rega\');}'
      const rega = new Rega(self.log, self.ccuIP, 'runProgram')
      rega.script(script).then((regaResult) => {
        if (regaResult.indexOf('program not found by') !== -1) {
          self.log.error('Unable to launch %s program was not found by rega', programName)
        }
        resolve(regaResult)
      }).catch(e => {
        self.log.error('[CCU] runProgram failed for %s: %s', programName, e.message || e)
        reject(e)
      })
    })
  }

  setCache (address, newValue) {
    this.cachedValues[address] = newValue
  }

  getCache (address) {
    return this.cachedValues[address]
  }

  getInterfaceWithID (interfaceId) {
    let intf = this.interfaces[interfaceId]
    if (intf === undefined) {
      intf = { id: interfaceId, name: 'unknown', type: '', typename: '', info: '', url: '' }
      this.interfaces[interfaceId] = intf
    }
    return intf
  }

  getInterfaceWithName (interfaceName) {
    let result
    const self = this
    Object.keys(this.interfaces).forEach(ifId => {
      const oInteface = self.interfaces[ifId]
      if (oInteface.name === interfaceName) {
        result = oInteface
      }
    })
    return result
  }

  // getDeviceDescription of a device address, cached for all its channels
  getDeviceDescription (interfaceId, deviceAddress) {
    if (!this.deviceDescriptions) {
      this.deviceDescriptions = new Map()
    }
    const key = interfaceId + '.' + deviceAddress
    if (!this.deviceDescriptions.has(key)) {
      const request = Promise.resolve(this.sendInterfaceCommand(interfaceId, 'getDeviceDescription', [deviceAddress]))
        .catch(() => undefined)
      this.deviceDescriptions.set(key, request)
    }
    return this.deviceDescriptions.get(key)
  }

  sendInterfaceCommand (interfaceId, command, parameters) {
    if (this.rpc) {
      this.log.debug('[CCU] sendInterfaceCommand %s %s', interfaceId, command)
      return this.rpc.sendInterfaceCommand(interfaceId, command, parameters)
    }
  }

  async updateCCUVarTrigger (triggerDataPoint) {
    const self = this
    const varList = Object.keys(this.variableCallbacks)
    this.log.debug('[CCU] updateCCUVarTrigger get datapoint and channel ids %s', triggerDataPoint)
    const getIDMessage = 'object x = dom.GetObject(\'' + triggerDataPoint + '\');Write(\'{"DpId":\' # x.ID() # \',\');Write(\'"ChId":\' # x.Channel() # \'}\');'
    const rega = new Rega(this.log, this.ccuIP, 'updateCCUVarTrigger')
    // the helper program of the CCU is background work for Apple Home
    rega.background = true
    const getResult = await rega.script(getIDMessage)
    if (getResult) {
      try {
        const ids = JSON.parse(getResult)
        const channelID = ids.ChId
        const channelDpId = ids.DpId
        const tmpProg = '_hap_autotrigger_'
        // Core Block
        let regaMessage = 'object oPTmp = dom.GetObject( ID_PROGRAMS );'
        regaMessage = regaMessage + 'object program = dom.GetObject("' + tmpProg + '");'
        regaMessage = regaMessage + 'if (program) {'
        regaMessage = regaMessage + ' dom.DeleteObject(program);'
        regaMessage = regaMessage + '}'
        regaMessage = regaMessage + 'program = dom.CreateObject(OT_PROGRAM);'
        regaMessage = regaMessage + 'program.PrgInfo("This program will autotrigger the variable updater for homekit-ccu.");'
        regaMessage = regaMessage + 'program.Name("' + tmpProg + '");'
        regaMessage = regaMessage + 'boolean bF1 = oPTmp.Add(program.ID());'
        regaMessage = regaMessage + 'object rule = program.Rule();'
        regaMessage = regaMessage + 'object destn = rule.RuleDestination();'
        regaMessage = regaMessage + 'object n_condition;'
        regaMessage = regaMessage + 'if (rule.RuleConditions().Count()>0) {'
        regaMessage = regaMessage + 'n_condition = rule.RuleConditions(0);'
        regaMessage = regaMessage + '} else {'
        regaMessage = regaMessage + 'n_condition = rule.RuleAddCondition();'
        regaMessage = regaMessage + '}'
        regaMessage = regaMessage + 'n_condition.CndOperatorType(2);'
        regaMessage = regaMessage + 'object s_cond;'
        // Destination Block
        regaMessage = regaMessage + 'object dest = destn.DestAddSingle();'
        regaMessage = regaMessage + 'dest.DestinationParam(ivtObjectId);'
        regaMessage = regaMessage + 'dest.DestinationChannel(' + channelID + ');'
        regaMessage = regaMessage + 'dest.DestinationDP(' + channelDpId + ');'
        regaMessage = regaMessage + 'dest.DestinationValueType(ivtBinary);'
        regaMessage = regaMessage + 'dest.DestinationValue(1);'

        // loop thru all variables
        varList.forEach((variable) => {
          const oVar = self.variableWithName(variable)
          self.log.debug('[CCU] add variable condition : %s', JSON.stringify(oVar))
          if ((oVar) && (oVar.id)) {
            if ((oVar.valuetype === 4) || (oVar.valuetype === 2) || (oVar.valuetype === 16)) { // ivtFloat - 4  ivtBinary - 2  ivtInteger - 16
              let regaCheck = ''
              switch (oVar.subtype) {
                case 2: // istBool
                case 6: // istAlarm
                case 23: // istPresent
                  self.log.debug('[CCU] adding boolean checks')
                  regaCheck = regaCheck + this.getVariableCondition(oVar.id, 9, 0) // 9 >=
                  regaCheck = regaCheck + this.getVariableCondition(oVar.id, 9, 1)
                  break
                case 29: // istEnum
                  // loop thru all values
                  self.log.debug('[CCU] adding choice checks')
                  if (oVar.valuelist) {
                    const sz = oVar.valuelist.split(';').length
                    for (let i = 0; i < sz; i++) {
                      regaCheck = regaCheck + this.getVariableCondition(oVar.id, undefined, i)
                    }
                  }
                  break
                case 0: // istGeneric
                  self.log.debug('[CCU] adding generic number checks')
                  regaCheck = regaCheck + this.getVariableCondition(oVar.id, 9, oVar.minvalue) // 9 >=
                  break
              }
              regaMessage = regaMessage + regaCheck
            } else {
              regaMessage = regaMessage + this.getVariableCondition(oVar.id, undefined, '""')
            }
          }
        })
        // and send regaMessage
        regaMessage = regaMessage + 'program.Active(true);'
        regaMessage = regaMessage + 'dom.RTUpdate(0);'
        await rega.script(regaMessage)
      } catch (e) {
        this.log.error(e)
      }
    } else {
      this.log.debug('[CCU] updateCCUVarTrigger unable to get datapointids')
    }
  }

  getVariableCondition (varId, conditionType, comparison) {
    let regaMessage = ''
    regaMessage = regaMessage + 's_cond = n_condition.CndAddSingle();'
    regaMessage = regaMessage + 's_cond.OperatorType(2);'
    if (conditionType) {
      regaMessage = regaMessage + 's_cond.ConditionType(' + conditionType + ');'
    }
    regaMessage = regaMessage + 's_cond.ConditionType2(13);'
    regaMessage = regaMessage + 's_cond.LeftValType(19);'
    regaMessage = regaMessage + 's_cond.ConditionChannel(65535);'
    regaMessage = regaMessage + 's_cond.LeftVal(' + varId + ');'
    regaMessage = regaMessage + 's_cond.RightVal1(' + comparison + ');'
    return regaMessage
  }

  /**
   * The duty cycle of the radio modules, by their address. Like the CCU itself
   * (/bin/updateDCVars.tcl) it asks BidCos-RF and HmIP-RF: without BidCos devices only HmIP-RF
   * answers (TYPE HMIP_CCU2). An interface without devices in use is not asked.
   * @param {boolean} onlyReturnDevices the modules found by the last query, without asking again
   * @returns {Promise<object>} { address: duty cycle in % }
   */
  async getCCUDutyCycle (onlyReturnDevices) {
    if (onlyReturnDevices) {
      this.log.debug('[CCU] just return previously saved interfaces %s', JSON.stringify(this.ccuDCDevices))
      return this.ccuDCDevices
    }

    // if there are no interface infos ... fetch them
    if (Object.keys(this.interfaces).length === 0) {
      await this._fetchInterfaces()
    }

    const result = {}
    for (const name of ['BidCos-RF', 'HmIP-RF']) {
      const intf = this.getInterfaceWithName(name)
      if (!intf || (intf.inUse !== true)) {
        continue
      }
      this.log.debug('[CCU] fetching the duty cycle of %s', name)
      try {
        const modules = await this.sendInterfaceCommand(intf.name, 'listBidcosInterfaces', [])
        this.log.debug('[CCU] %s listBidcosInterfaces result %s', name, JSON.stringify(modules))
        ;(Array.isArray(modules) ? modules : []).forEach(module => {
          if (module && module.ADDRESS && (module.DUTY_CYCLE !== undefined)) {
            result[module.ADDRESS] = module.DUTY_CYCLE
          }
        })
      } catch (e) {
        this.log.warn('[CCU] duty cycle of %s not available: %s', name, e.message)
      }
    }
    this.ccuDCDevices = result
    this.log.debug('[CCU] save DC Interfaces %s', JSON.stringify(this.ccuDCDevices))
    return result
  }

  /**
   * depending on debugging the monitoring service will be enabled if user has set the flag for that
   */
  processMonitoring () { // if we are in debug remove the monitor
    if (this.ccuIP !== '127.0.0.1') {
      this.log.info('ignore monitoring cause seems to be a remote ccu')
      return
    }
    // monitoring is optional: whatever goes wrong here must not stop the start
    try {
      if (this.log.isDebugEnabled()) {
        this.log.info('[CCU] skip Monitoring as we are in debug')
        this._removemonitconfig()
        this.log.info('[CCU] monit config removed')
      } else if ((this.configuration) && (this.configuration.enableMonitoring === true)) {
        this.log.info('[CCU] enable Monitoring')
        this._buildmonitconfig()
      } else {
        this.log.info('[CCU] disable Monitoring')
        this._removemonitconfig()
      }
    } catch (e) {
      this.log.warn('[CCU] monitoring setup failed: %s', e.message)
    }
  }

  prepareInterfaces () {
    const self = this

    if (this.configuration.interfaceWatchdog === undefined) {
      this.configuration.interfaceWatchdog = 300
    }

    self.log.debug('[CCU] creating eventserver (%s)', this.configuration.interfaceWatchdog)
    // create an rpc server if not in use yet
    if (!this.rpc) {
      this.rpc = new HomeMaticRPC(this, 9875)
      this.rpc.init(parseInt(this.configuration.interfaceWatchdog))
      this.processMonitoring()
    }
    self.log.debug('[CCU] adding %s interfaces to rpc manager', Object.keys(this.interfaces).length)
    Object.keys(this.interfaces).forEach(ifId => {
      const oInteface = self.interfaces[ifId]
      if (oInteface.inUse === true) {
        const iUrl = oInteface.url.replace('xmlrpc://', 'http://').replace('xmlrpc_bin://', 'http://')
        self.log.debug('If URL is %s', iUrl)
        // eslint-disable-next-line n/no-deprecated-api -- legacy parser kept on purpose (behavior-preserving)
        const oUrl = url.parse(iUrl)
        let port = oUrl.port
        let hostname = oUrl.hostname
        self.log.debug('If Host %s Port %s Path %s', hostname, port, oUrl.pathname)
        if (self.ccuIP !== '127.0.0.1') {
          self.log.debug('[CCU] we are remote so change the host')
          hostname = self.ccuIP
          // Rega returns internal daemon ports (32001/32010/39292) which are only
          // reachable on localhost. For remote access, use the lighttpd-proxied
          // external ports (2001/2010/9292). The convention is internal - 30000.
          if (port >= 30000) {
            self.log.debug('[CCU] remapping internal port %s to external port %s for %s', port, port - 30000, oInteface.name)
            port = port - 30000
          }
        } else {
          self.log.debug('[CCU] local ccu so nothing will be replaced')
        }
        // When running remotely with authentication enabled on the CCU,
        // the lighttpd-proxied XML-RPC ports require basic auth.
        const credentials = (self.configuration.rpcUser && self.configuration.rpcPass)
          ? { user: self.configuration.rpcUser, pass: self.configuration.rpcPass }
          : undefined
        self.log.debug('[CCU] adding interface %s with id %s', oInteface.name, ifId)
        self.rpc.addInterface(oInteface.name, hostname, port, oUrl.pathname, credentials)
      } else {
        self.log.info('[CCU] interface %s seems not to be in use', oInteface.name)
      }
    })
    this.rpc.on('event', (event) => {
      self.log.debug('[CCU] event %s', event.address)
      self.setCache(event.address, event.value)
      self.fireEvent(event.address, event.value)
    })

    this.rpc.on('newDevices', () => {
      if (!self.dryRun) {
        self.log.debug('[CCU] refresh device database on newDevices message from ccu')
        self.updateDeviceDatabase()
      }
    })
    self.log.info('[CCU]', 'connecting interfaces')
    this.rpc.connect()
  }

  fireEvent (address, value) {
    const self = this
    const cbList = this.eventCallbacks[address]
    if (cbList) {
      self.log.debug('[CCU] event %s will be handled by %s registered callback', address, cbList.length)
      cbList.forEach(cb => {
        cb(value)
      })
    }
  }

  fireVariableEvent (varName, value) {
    const cbList = this.variableCallbacks[varName]
    if (cbList) {
      this.log.debug('[CCU] var Update Event %s will be handled by %s registered callback', varName, cbList.length)
      cbList.forEach(cb => {
        cb(value)
      })
    } else {
      this.log.debug('[CCU] no registered event callbacks for %s', varName)
    }
  }

  registerVariableForEventProcessingAtAccessory (varName, callback) {
    if (typeof callback === 'function') {
      this.log.debug('[CCU] register variable %s for events', varName)
      if (this.variableCallbacks[varName] === undefined) {
        this.variableCallbacks[varName] = []
      }
      this.variableCallbacks[varName].push(callback)
      // also do a remote fetch for this address
      this.getVariableValue(varName, true)
    } else {
      this.log.warn('[CCU] unable to register %s event %s is not a function ', varName, callback)
    }
  }

  updateRegisteredVariables () {
    const self = this
    Object.keys(this.variableCallbacks).forEach((varName) => {
      self.getVariableValue(varName, true)
    })
  }

  registerAddressForEventProcessingAtAccessory (address, callback) {
    this.log.debug('[CCU] register address %s for events', address)
    if (this.eventCallbacks[address] === undefined) {
      this.eventCallbacks[address] = []
    }
    this.eventCallbacks[address].push(callback)
    if (isActionDatapoint(address)) {
      return // a key press has no start value: the last one read again would be a new press
    }
    if (this.startValuesPending === true) {
      return // startValueRefresh reads all of them with a few scripts
    }
    const known = this.getCache(address)
    if ((known !== undefined) && (known !== 'undefined')) {
      callback(known)
    } else {
      this.readValue(address).catch(e => this.log.debug('[CCU] no start value of %s: %s', address, e.message))
    }
  }

  processEventDatapoints () {
    const self = this
    const dpsToAdd = []
    const dpsToRemove = []
    let dpsCache = []
    this.log.debug('[CCU] register all new event datapoints via reportValueUsages')

    // we will check all dps in this.eventCallbacks
    const dps = Object.keys(this.eventCallbacks)

    const evdpFile = path.join(this.configurationPath, 'evdps.json')
    if (fs.existsSync(evdpFile)) {
      try {
        dpsCache = JSON.parse(fs.readFileSync(evdpFile))
      } catch (e) { }
    }
    // build datapoints which will be removed from iterface
    dpsCache.forEach((cachedItem) => {
      if (dps.indexOf(cachedItem) === -1) {
        dpsToRemove.push(cachedItem)
      }
    })
    // build datapoints to add to the interface
    dps.forEach((usedItem) => {
      if (dpsCache.indexOf(usedItem) === -1) {
        dpsToAdd.push(usedItem)
      }
    })

    this.log.debug('[CCU] %s datapoints to add', dpsToAdd.length)
    this.log.debug('[CCU] %s datapoints to remove', dpsToRemove.length)

    // registration is done on every interface so we have to loop thru known intefaces
    const ifList = this.rpc.connectedInterfaces()
    ifList.forEach((ccuInterface) => {
      let itemsInInterface = {}
      dpsToAdd.forEach((dpName) => {
        const idx = dpName.indexOf(ccuInterface.ifName)
        if (idx === 0) {
          itemsInInterface[dpName] = self.eventCallbacks[dpName].length || 1
        }
      })
      // if there are new Datepoints .. register them
      if (Object.keys(itemsInInterface).length > 0) {
        self.log.debug('[CCU] register %s datapoints for interface %s', Object.keys(itemsInInterface).length, ccuInterface.ifName)
        ccuInterface.reportValueUsage(itemsInInterface)
      }
      itemsInInterface = []
      dpsToRemove.forEach((dpName) => {
        const idx = dpName.indexOf(ccuInterface.ifName)
        if (idx === 0) {
          itemsInInterface[dpName] = 0
        }
      })
      // if there are dps to remove do so
      if (Object.keys(itemsInInterface).length > 0) {
        self.log.debug('[CCU] UNregister %s datapoints from interface %s', Object.keys(itemsInInterface).length, ccuInterface.ifName)
        ccuInterface.reportValueUsage(itemsInInterface)
      }
    })
    // and save the cache to do this only on changed dps at next time
    fs.writeFileSync(evdpFile, JSON.stringify(dps))
  }

  _fetchInterfaces () {
    const self = this
    this.log.debug('[CCU] fetching Interfaces')
    return new Promise((resolve, reject) => {
      const rega = new Rega(self.log, self.ccuIP, 'fetchInterfaces')
      let script = '!interfaces\nstring sifId;boolean df = true;Write(\'{"interfaces":[\');foreach(sifId, root.Interfaces().EnumIDs()){object oIf = dom.GetObject(sifId);if ((oIf) && (oIf.TypeName()=="INTERFACE")) {if(df) {df = false;} else { Write(\',\');}Write(\'{\')'
      script = script + self._scriptPartForElement('id', 'sifId', 'number', ',')
      script = script + self._scriptPartForElement('name', 'oIf.Name()', 'string', ',')
      script = script + self._scriptPartForElement('type', 'oIf.Type()', 'string', ',')
      script = script + self._scriptPartForElement('typename', 'oIf.TypeName()', 'string', ',')
      script = script + self._scriptPartForElement('info', 'oIf.InterfaceInfo()', 'string', ',')
      script = script + self._scriptPartForElement('url', 'oIf.InterfaceUrl()', 'string')
      script = script + 'Write(\'}\');}} Write(\']}\');'

      rega.script(script).then(strInterfaces => {
        if (strInterfaces) {
          const interfaces = JSON.parse(strInterfaces)
          interfaces.interfaces.forEach(oInterface => {
            self.interfaces[oInterface.id] = oInterface
          })
          resolve()
        } else {
          reject(new Error('unable to fetch Interfaces'))
        }
      }).catch(e => { resolve() })
    })
  }

  _scriptPartForElement (elementName, functionName, type, leadingComa = '') {
    let result
    if (type === 'urlstring') {
      result = 'Write(\'"' + elementName + '": "\');'
      result = result + 'WriteXML(' + functionName + ');'
      result = result + 'Write(\'"' + leadingComa + '\');'
      return result
    } else
      if (type === 'string') {
        return 'Write(\'"' + elementName + '": "\' # ' + functionName + ' # \'"' + leadingComa + '\');'
      } else if (type === 'number') {
        return 'Write(\'"' + elementName + '": \' # ' + functionName + ' # \'' + leadingComa + '\');'
      } else if (type === 'enumeration') {
        result = 'Write(\'"' + elementName + '": [\');'
        result = result + 'string idf;boolean tf = true;foreach(idf,' + functionName + '){if(tf){tf=false;} else { Write(\',\');}'
        result = result + 'Write(\'\' # idf # \'\');}'
        result = result + 'Write(\']\');'
        return result
      }
  }

  _removemonitconfig () {
    this.monitConfig.remove()
  }

  _buildmonitconfig () {
    // writes the config only while the rc.d script's pid file exists, removes it otherwise
    this.monitConfig.install()
  }
}

module.exports = HomeMaticCCU
