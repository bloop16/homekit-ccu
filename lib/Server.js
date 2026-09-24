/*
 * File: Server.js
 * Project: homekit-ccu
 * File Created: Saturday, 7th March 2020 12:47:00 pm
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

const { uuid, Bridge, HAPStorage, Service, Characteristic, Categories, Formats, Perms, Units, MDNSAdvertiser } = require('@homebridge/hap-nodejs')
const BridgeMock = require('./BridgeMock.js')
const path = require('path')
const fs = require('fs')
const childProcess = require('child_process')
const HomeMaticCCU = require(path.join(__dirname, 'HomeMaticCCU.js'))
const HomeMaticTestCCU = require(path.join(__dirname, 'HomeMaticTestCCU.js'))
const hapIds = require(path.join(__dirname, 'util', 'hapIds.js'))
const { migrateInstances } = require(path.join(__dirname, 'util', 'instanceMigration.js'))
const { CONFIG_VERSION, upgradeConfigVersion } = require(path.join(__dirname, 'util', 'configMigration.js'))
const { normalizeMappingInstances } = require(path.join(__dirname, 'util', 'mappingInstances.js'))
const { RENAMED_SERVICES, migrateServiceNames } = require(path.join(__dirname, 'util', 'serviceMigration.js'))
const hapPersist = require(path.join(__dirname, 'util', 'hapPersist.js'))
const { bridgeDisplayName, ADDON_NAME } = require(path.join(__dirname, 'util', 'homekitName.js'))
const { hapFirmwareRevision } = require(path.join(__dirname, 'util', 'firmware.js'))
const { REMOTE_SERVICE } = require(path.join(__dirname, 'util', 'remoteMapping.js'))
const { coveringAddress } = require(path.join(__dirname, 'util', 'combinedChannels.js'))
const { serviceClassFile } = require(path.join(__dirname, 'util', 'serviceClass.js'))
const { withoutSecrets } = require(path.join(__dirname, 'util', 'logSecrets.js'))
const { orderServiceList, defaultServiceFor } = require(path.join(__dirname, 'util', 'defaultServices.js'))

const ApplianceType = {
  Device: 0,
  Variable: 1,
  Program: 2,
  Special: 3
}

class Server {
  constructor (log, configurationPath, ccuHost, rpcUser, rpcPass) {
    this.log = log
    this.ccuHost = ccuHost
    this.rpcUser = rpcUser
    this.rpcPass = rpcPass
    if (configurationPath) {
      this.log.info('using configuration at %s', configurationPath)
      this._configurationPath = configurationPath
      this._hapCache = path.join(configurationPath, 'persist')
      this._publishedAccessories = {}
      this._variableAccessories = [] // used to äÄöÖüÜ fetch all at the key event
      this._specialAccessories = []
      this._configuration = {}
      this.isTestMode = false

      this.gatoHomeBridge = {
        hap: { Characteristic, Service, Formats, Perms, Units },
        user: {
          storagePath: () => { return this._configurationPath }
        }
      }
    } else {
      this._configuration = {}
      this.gatoHomeBridge = {
        hap: { Characteristic, Service, Formats, Perms, Units },
        user: {
          storagePath: () => { return null }
        }
      }
    }
  }

  async init (dryRun) {
    const self = this
    this.dryRun = dryRun

    this.log.info('[Server] settings loading ...')
    await this.loadSettings()
    this.log.info('[Server] settings loading is done ; continuing init')

    this.log.info('[Server] Using config from %s', this._hapCache)
    this.preparePairingStorage()
    HAPStorage.setCustomStoragePath(this._hapCache)
    this.launchUIConfigurationServer()
    if (this.ccuHost !== undefined) {
      this._configuration.ccuIP = this.ccuHost
    }
    if (this.rpcUser && this.rpcPass) {
      this._configuration.rpcUser = this.rpcUser
      this._configuration.rpcPass = this.rpcPass
    }
    this._configuration.storagePath = this._configurationPath
    this._ccu = new HomeMaticCCU(this.log, this._configuration)

    // read the restart count and increment it
    let rcCounter = 0
    const rcFile = path.join(this._hapCache, 'restartCounter.json')
    if (fs.existsSync(rcFile)) {
      rcCounter = JSON.parse(fs.readFileSync(rcFile))
    }
    rcCounter = rcCounter + 1
    this.log.info('[Server] current restart count is  %s', rcCounter)
    if (rcCounter >= 5) {
      this.log.info('[Server] current restart count is  >= 5 disable monitoring')
      // disable monitoring cause somethin is seriously wrong
      this._ccu.configuration.enableMonitoring = false // remove the flag
      this._ccu._removemonitconfig()
    }
    try {
      fs.writeFileSync(rcFile, JSON.stringify(rcCounter))
    } catch (e) {

    }
    this._ccu.dryRun = this.dryRun
    if (this.dryRun) {
      this.log.info('[Server] this is just a dress rehearsal')
      this.continueInitialization()
    } else {
      this.checkRegaAlive()
    }

    // setup a Timer for 1hour to remove the rcFile if there is one
    // this will also reset the timer
    setTimeout(() => {
      try {
        self.log.info('[Server] seems we are stable since 1 hour remove the restart counter')
        if (fs.existsSync(rcFile)) {
          fs.unlinkSync(rcFile)
          // also resetup the monitoring
          self._ccu.processMonitoring()
        }
      } catch (e) {
        self.log.error('[Server] unable to reset restart counter or enable monitoring')
      }
    }, 60 * 60 * 1000)
  }

  // HomeKit keys must be in place before HAP reads its storage: a restored backup waits in
  // persist.restore until this start
  preparePairingStorage () {
    try {
      hapPersist.applyStagedRestore({ configDir: this._configurationPath, log: this.log })
    } catch (e) {
      this.log.error('[Server] cannot prepare the HomeKit pairing storage: %s', e.message)
    }
  }

  reset () {
    // this will remove the current config
    const self = this
    const files = ['config.json', 'rooms.json', 'functions.json', 'devices.json', 'programs.json', 'variables.json', 'persist', hapPersist.RESTORE_DIR]
    files.forEach(file => {
      const configFileName = path.join(self._configurationPath, file)
      if (fs.existsSync(configFileName)) {
        if (fs.lstatSync(configFileName).isDirectory()) {
          self.deleteFolderRecursive(configFileName)
        } else {
          fs.unlinkSync(configFileName)
        }
      }
    })
  }

  deleteFolderRecursive (pathname) {
    const self = this
    if (fs.existsSync(pathname)) {
      fs.readdirSync(pathname).forEach((file, index) => {
        const curPath = path.join(pathname, file)
        if (fs.lstatSync(curPath).isDirectory()) { // recurse
          self.deleteFolderRecursive(curPath)
        } else { // delete file
          fs.unlinkSync(curPath)
        }
      })
      fs.rmdirSync(pathname)
    }
  };

  async checkRegaAlive () {
    // wait until the ccu is alive
    this.log.info('[Server] Checking rega connection')
    const self = this
    let ccuIsRegaAlive = false
    try {
      ccuIsRegaAlive = await this._ccu.pingRega()
    } catch (e) {
      self.log.error('[Server] Rega ping failed: %s', e.message || e)
      ccuIsRegaAlive = false
    }
    if (ccuIsRegaAlive) {
      this.log.info('[Server] Rega is alive going ahead')
      this.continueInitialization()
    } else {
      // wait 2 secondz
      setTimeout(() => {
        self.log.warn('[Server] Rega is out of home .. try again in 10 seconds')
        self.checkRegaAlive()
      }, 10000)
    }
  }

  getConfig (key) {
    return this._configuration[key]
  }

  /**
   * mDNS advertiser from config.json key "advertiser".
   * Supported on the CCU: bonjour-hap (default), ciao, avahi. Anything else falls back to bonjour-hap.
   */
  getAdvertiser () {
    const requested = this.getConfig('advertiser') || MDNSAdvertiser.BONJOUR
    const valid = [MDNSAdvertiser.BONJOUR, MDNSAdvertiser.CIAO, MDNSAdvertiser.AVAHI]
    if (!valid.includes(requested)) {
      this.log.warn('[Server] unknown advertiser %s, falling back to %s (valid: %s)', requested, MDNSAdvertiser.BONJOUR, valid.join(', '))
      return MDNSAdvertiser.BONJOUR
    }
    return requested
  }

  async continueInitialization () {
    const self = this
    this.log.info('[Server] continueInitialization')
    await this.connectCCU()
    this.log.info('[Server] Bridge Connections are up for %s bridges', this._bridges.length)

    this._ccu.on('devicelistchanged', async () => {
      // rebuild the service list
      self.log.debug('[Server] CCU DeviceList just changed')
      await self._buildCompatibleObjectList()
    })
    await self.publishServiceTable()
  }

  async simulate (simPath, simData) {
    // Load the simfile
    const self = this
    if (simPath !== undefined) {
      this.log.info('Simulation starts')
      this._configurationPath = simPath
      const simfile = path.join(simPath, 'devices.json')
      if (fs.existsSync(simfile)) {
        const oDb = JSON.parse(fs.readFileSync(simfile))
        const serviceList = await this.buildServiceList()
        const supportedChannelList = Object.keys(serviceList)

        const devAdrList = []
        const devList = []
        if (oDb.devices) {
          oDb.devices.forEach(device => {
            device.channels.forEach(channel => {
              // first check DEVICETYPE:CHANNELTYPE
              if (supportedChannelList.indexOf(device.type + ':' + channel.type) > -1) {
                channel.isSuported = true
                if (devAdrList.indexOf(device.address) === -1) {
                  devAdrList.push(device.address)
                  devList.push(device)
                }
              }

              if (supportedChannelList.indexOf(channel.type) > -1) {
                channel.isSuported = true
                if (devAdrList.indexOf(device.address) === -1) {
                  devList.push(device)
                  devAdrList.push(device.address)
                }
              }
            })
          })
        }
        this.log.info('[Server] list of supported devices')
        devList.forEach(device => {
          self.log.info('Device : %s | %s', device.name, device.address)
          device.channels.forEach(channel => {
            if (channel.isSuported === true) {
              self.log.info('Channel : %s | %s', device.name, channel.address)
            }
          })
        })
      } else {
        this.log.error('File not found %s', simfile)
      }
      this.log.info('Simulation status end will power up the system in test mode')
      await this.loadSettings()
      this.launchUIConfigurationServer()
      await this.publishServiceTable()
      this._ccu = new HomeMaticCCU(this.log, this._configuration)
      await this._ccu.loadDatabases(simPath, true) // Start CCU in testMOde
      this.log.info('[Server] Bridge Connections skipped as we are in test mode')
      this._bridges = []
      this._publishedAccessories = {}
      await self._buildCompatibleObjectList()
      this.publishAccessoriesToConfigurationService()
      this.publishBridgeInfosToConfigurationService()
      return
    }
    if (simData) {
      // this is for unit tests
      if ((simData.config) && (simData.devices)) {
        this.isTestMode = true
        this._configuration = simData.config
        this.log.debug('[Server] Powering Test CCU')
        this._ccu = new HomeMaticTestCCU(this.log, this._configuration)
        this._ccu.setDummyDevices(simData.devices)
        if (simData.values) {
          this._ccu.setDummyValues(simData.values)
        }
        this._ccu.setDummyDeviceDescriptions(simData.deviceDescriptions)
        this.log.debug('[Server] Bridge Connections skipped as we are in test mode')
        this._bridges = []
        this._publishedAccessories = {}
        await self._buildCompatibleObjectList()
        if (simData.mappings) {
          this.log.debug('[Server] TestMode Mapping : %s', JSON.stringify(simData.mappings))
        }
        this._configuration.mappings = simData.mappings || {}
        await this.publishServiceTable()
        this.buildMappings(this._configuration.mappings, this.serviceConfig)
        this.log.debug('[Server] power up mockup bridge as we are in test mode')
        const channels = []
        // create a empty mapping if not set by the test
        this._configuration.channels.forEach(channelAddress => {
          let channel = {}

          // generate a dummy channel objectservice used for
          simData.devices.forEach(simDevice => {
            simDevice.channels.forEach(simChannel => {
              if (simChannel.address === channelAddress) {
                channel = simChannel
                channel.dtype = simDevice.type
              }
            })
          })

          channels.push(channel)
        })

        // create a test Instance b6589fc6-ab0d-4c82-8f12-099d1c2d40ab is default id
        this.powerUpBridges({ 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab': { name: 'test', user: '11:22:33:44:55:66', pincode: '123-456-789' } }, channels, [], [], [])
        this.log.debug('[Server] test mode setup done')
      }
    }
  }

  powerUpBridges (lInstances, channelsToMap, variables, programs, special) {
    const self = this
    this.currentPortNum = 9877
    // Check Instances to power up
    Object.keys(lInstances).forEach(instanceID => {
      self.log.debug('[Server] loading instance %s with name %s', instanceID, (lInstances[instanceID] || {}).name)
      const instanceData = lInstances[instanceID] || { pincode: self.generatePin(), setupID: self.generateSetupID(), name: 'default' }
      self.log.debug('[Server] instance will run on port %s', self.currentPortNum)
      const bridge = self.loadInstance(instanceID, instanceData, channelsToMap, variables, programs, special, self.currentPortNum)
      self._bridges.push(bridge)
      self.currentPortNum = self.currentPortNum + 1
    })
  }

  saveSettings (settings) {
    const configFile = path.join(this._configurationPath, 'config.json')
    fs.writeFileSync(configFile, JSON.stringify(settings, ' ', 1))
  }

  /** @returns the parsed config.json, or undefined when there is none or it is unreadable */
  _readStoredConfig () {
    const configFile = path.join(this._configurationPath, 'config.json')
    if (!fs.existsSync(configFile)) {
      return undefined
    }
    try {
      return JSON.parse(fs.readFileSync(configFile, 'utf8'))
    } catch (e) {
      this.log.warn('[Server] unable to read %s: %s', configFile, e.message)
      return undefined
    }
  }

  /** creates the default homekit instance */
  createDefaultInstance () {
    const defInst = uuid.generate('0')
    const instances = {}
    instances[defInst] = { name: 'default', user: this.randomMac(), pincode: this.generatePin(), setupID: this.generateSetupID() }
    // keep what is stored (not this._configuration: it carries the runtime ccuIP/rpc credentials)
    this.saveSettings({ ...(this._readStoredConfig() || { configVersion: CONFIG_VERSION }), instances })
    this._configuration.instances = instances
    return this._configuration.instances
  }

  async connectCCU () {
    const self = this
    this._bridges = []
    this.log.debug('[Server] preparing interface communication to ccu')
    if (!this.dryRun) {
      await this._ccu.prepareConnections()
    }
    await this._ccu.loadDatabases(this._configurationPath)

    let lInstances = this._configuration.instances
    if (lInstances === undefined) {
      lInstances = this.createDefaultInstance()
    }
    this.log.debug('[Server]', 'instances to load : %s', JSON.stringify(withoutSecrets(lInstances)))
    const channelsToMap = []
    self.log.debug('[Server]', 'mapping requested channels')
    if (this._configuration.channels) {
      this._configuration.channels.forEach(chaddress => {
        const channel = self._ccu.getChannelByAddress(chaddress)
        if (channel) {
          channelsToMap.push(channel)
        }
      })
    }

    self.log.debug('[Server] setup used interfaces for %s mapped channels', channelsToMap.length)
    channelsToMap.forEach((channel) => {
      const oInterface = self._ccu.getInterfaceWithID(channel.intf)
      if (oInterface) {
        oInterface.inUse = true
      } else {
        self.log.warn('[Server] interface %s for channel %s not found', channel.intf, channel.name)
      }
    })

    self.log.debug('[Server] mapping variables')
    const variablesToMap = []
    if (this._configuration.variables) {
      this._configuration.variables.forEach(variable => {
        // create a fake channel address so the splitter will work
        variablesToMap.push({ name: variable, address: variable + ':0' })
      })
    }
    self.log.debug('[Server] mapping requested variables %s found', variablesToMap.length)

    const programsToMap = []
    if (this._configuration.programs) {
      this._configuration.programs.forEach(program => {
        // create a fake channel address so the splitter will work
        programsToMap.push({ name: program, address: program + ':0' })
      })
    }

    const specialToMap = []
    if (this._configuration.special) {
      this._configuration.special.forEach(special => {
        // create a fake channel address so the splitter will work
        specialToMap.push({ name: special, address: special + ':0' })
      })
    }

    self.log.debug('[Server] mapping requested programs %s found', programsToMap.length)

    self.log.debug('[Server] asking rpc manager to power up the interface connections')
    await this._ccu.prepareInterfaces()
    if ((channelsToMap.length > 0) || (variablesToMap.length > 0) || (programsToMap.length > 0) || (specialToMap.length > 0)) {
      this.powerUpBridges(lInstances, channelsToMap, variablesToMap, programsToMap, specialToMap)
      this.log.info('[Server] publishing accessories')
      this.publishAccessoriesToConfigurationService()
      this.publishBridgeInfosToConfigurationService()
      this.publishVirtualKeys()
      // Setup the Variable Update Event
      if (this._configuration.VariableUpdateEvent) {
        this._ccu.registerAddressForEventProcessingAtAccessory(this._configuration.VariableUpdateEvent, () => {
          // loop thru all ccu variable events
          self._ccu.updateRegisteredVariables() // this is the new method
        })
      }
    } else {
      this.log.warn('[Server] no channels to map in configuration found')
      // Power up the instances in dry mode
      this.powerUpBridges(lInstances, [], [], [], [])
      // ok we will need this for wizzard start
      this.publishAccessoriesToConfigurationService()
      this.publishBridgeInfosToConfigurationService()
      this.publishVirtualKeys()
    }
    this._buildCompatibleObjectList()
    this.reloadMode = false
    // we are done with the initialization so update the databases
    this._ccu.updateDatabases(this._configurationPath)
    // send all dps in use to the ccu
    this._ccu.processEventDatapoints()
    this.log.debug('[Server] initial DC fetch')
    await this._ccu.getCCUDutyCycle()
    this.log.debug('[Server] rebuild settings')
    this.rebuildClassSettings()
  }

  randomMac () {
    let mac = '12:34:56'

    for (let i = 0; i < 6; i++) {
      if (i % 2 === 0) mac += ':'
      mac += Math.floor(Math.random() * 16).toString(16)
    }

    return mac
  }

  generatePin () {
    return hapIds.generatePin()
  }

  generateSetupID () {
    return hapIds.generateSetupID()
  }

  loadInstance (instId, instanceData, ccuDevices, variables, programs, special) {
    const self = this
    // the setup code is never logged: users attach the log to support requests
    // `pin` is the key hap-homematic used for its default instance; loadSettings migrates it
    const pin = instanceData.pincode || instanceData.pin || this.generatePin()
    const hkfname = bridgeDisplayName(instanceData.name)
    const instanceName = hkfname
    const username = instanceData.user || self.randomMac()
    const setupID = instanceData.setupID || self.generateSetupID()
    let bridge
    if (this.isTestMode) {
      self.log.debug('[Server] powering up test bridge : %s with userid %s', hkfname, username)
      bridge = new BridgeMock(hkfname, instId)
    } else {
      self.log.info('[Server] powering up bridge : %s with id %s , userid %s', hkfname, instId, username)
      bridge = new Bridge(hkfname, instId)
      self.log.info('[Server]', 'bridge is up')
    }

    // load Channels and Build accessories
    self.log.debug('[Server] loading devices for instance %s', instId)
    let hazObjects = true
    if (ccuDevices) {
      if (!self._loadAccessories(ccuDevices, instId, bridge, instanceData.publishDevices)) {
        hazObjects = false
      }
    } else {
      self.log.warn('[Server]', 'no ccuDevices found in instance %s', instId)
    }
    // load variables and Build accessories
    self.log.debug('[Server] loading variables for instance %s', instId)

    if (!self._loadVariables(variables, instId, bridge, instanceData.publishDevices)) {
      hazObjects = false
    }
    self.log.debug('[Server] loading programs for instance %s', instId)

    if (!self._loadPrograms(programs, instId, bridge, instanceData.publishDevices)) {
      hazObjects = false
    }

    self.log.debug('[Server] loading special devices for instance %s', instId)

    if (!self._loadSpecialDevices(special, instId, bridge, instanceData.publishDevices)) {
      hazObjects = false
    }

    if (!hazObjects) {
      this.log.debug('[Server] no devices in %s', instanceName)
    }

    const info = bridge.getService(Service.AccessoryInformation)
    bridge.instanceId = instId
    bridge.instanceName = hkfname
    bridge.roomId = instanceData.roomId || 0
    // the CCU rooms of a bridge for a floor or several rooms (setup assistant)
    bridge.roomIds = Array.isArray(instanceData.roomIds) ? instanceData.roomIds : []
    info.setCharacteristic(Characteristic.Manufacturer, ADDON_NAME)
    info.setCharacteristic(Characteristic.Model, 'OpenCCU Bridge')
    info.setCharacteristic(Characteristic.SerialNumber, username)
    info.setCharacteristic(Characteristic.FirmwareRevision, hapFirmwareRevision(self.getVersion()) || '0.0.0')

    const advertiser = this.getAdvertiser()
    const publishInfo = {
      username,
      port: this.currentPortNum,
      pincode: pin,
      setupID,
      advertiser,
      category: Categories.BRIDGE
    }

    bridge.port = this.currentPortNum
    // test bridges are never advertised
    if (this.isTestMode) {
      bridge.publish(publishInfo)
    } else {
      Promise.resolve(bridge.publish(publishInfo, false)).catch(e => self.log.error('[Server] failed to publish bridge %s: %s', hkfname, e.stack || e))
    }

    bridge.on('listening', port => {
      self.log.info('[Server] homekit-ccu instance %s (%s) is running on port %s.', instanceName, username, port)
    })

    // the setup assistant waits for the pairing of new bridges
    bridge.on('paired', () => self.publishBridgeInfosToConfigurationService())
    bridge.on('unpaired', () => self.publishBridgeInfosToConfigurationService())

    bridge.on('identify', (paired, callback) => {
      self.log.info('[Server] identify %s %s', bridge.instanceId, paired ? '-paired-' : '-not paired-')
      callback()
    })
    self.log.info('[Server] bridge %s is ready; its setup code is shown in the HomeKit-CCU configuration', instanceName)
    return bridge
  }

  getVersion () {
    const packageFile = path.join(__dirname, '..', 'package.json')
    this.log.debug('[Server] Check Version from %s', packageFile)
    if (fs.existsSync(packageFile)) {
      try {
        const packageData = JSON.parse(fs.readFileSync(packageFile))
        this.log.debug('[Server] version is %s', packageData.version)
        return packageData.version
      } catch (e) {
        return 'no version found'
      }
    } else {
      return 'no version found'
    }
  }

  async loadSettings () {
    const self = this
    return new Promise((resolve, reject) => {
      const configFileName = path.join(this._configurationPath, 'config.json')
      this.log.debug('[Server] will load config from %s', configFileName)
      if (fs.existsSync(configFileName)) {
        try {
          const config = JSON.parse(fs.readFileSync(configFileName).toString())

          // todo Validate the stuff
          if ((config) && (config.special)) {
            const validatedConfig = config
            this.log.info('[Server] validating special config')
            // make sure we have special devices only once
            const validatedSpecial = []
            config.special.forEach(specialDevice => {
              if (validatedSpecial.indexOf(specialDevice) === -1) {
                validatedSpecial.push(specialDevice)
              }
            })
            validatedConfig.special = validatedSpecial

            this._configuration = validatedConfig
          } else {
            this._configuration = config
          }
          // saved here, before init spawns the config server, which reads config.json itself
          this._migrateConfig()
        } catch (e) {
          this.log.error('[Server] JSON Error in configuration file %s: %s', configFileName, e.message)
          const confgBackup = path.join(this._configurationPath, 'config_' + new Date().getTime() + '.backup')
          this.log.info('[Server] will start with a clean config. Your old file will be saved as %s maybe u are able to fix this', confgBackup)
          fs.renameSync(configFileName, confgBackup)
          fs.writeFileSync(configFileName, JSON.stringify({}))
          this._configuration = {}
          resolve()
        }
      } else {
        this.log.warn('[Server] configuration not found %s', configFileName)
      }
      this.log.info('[Server] config loading completed; start building servicetable')
      // load dynamic classes
      this.buildServiceList().then((cfg) => {
        self.serviceConfig = cfg
        self.log.info('[Server] service loading completed; publishing services')
        self.publishServiceTable()
        self.buildMappings(self._configuration.mappings, self.serviceConfig)
        resolve()
      })
    })
  }

  /**
   * Brings the loaded configuration to the current format and saves it once when anything
   * changed: config version (see util/configMigration.js), bridge PINs (see
   * _migrateInstanceSettings), one-element instance arrays of mappings and mappings naming
   * a removed service class (see util/serviceMigration.js).
   */
  _migrateConfig () {
    const config = this._configuration
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return
    }
    const steps = [
      (cfg) => this._migrateInstanceSettings(cfg),
      (cfg) => this._migrateMappingInstances(cfg),
      (cfg) => this._migrateServiceNames(cfg),
      (cfg) => this._migrateConfigVersion(cfg)
    ]
    const migrated = steps.reduce((cfg, step) => step(cfg), config)
    if (migrated === config) {
      return
    }
    this._configuration = migrated
    try {
      this.saveSettings(migrated)
    } catch (e) {
      this.log.error('[Server] unable to save the migrated configuration: %s', e.message)
    }
  }

  /**
   * Stores a stable pincode and setupID for every bridge instance (instances created by
   * hap-homematic kept the code under `pin`, so a fresh bridge got a new PIN on every start),
   * so the UI, the log and the published bridge agree.
   * @returns the config with migrated instances, or the input when nothing changed
   */
  _migrateInstanceSettings (config) {
    const { instances, migrated } = migrateInstances(config.instances, {
      generatePin: () => this.generatePin(),
      generateSetupID: () => this.generateSetupID()
    })
    if (migrated.length === 0) {
      return config
    }
    migrated.forEach(entry => {
      this.log.info('[Server] migrated bridge settings of instance %s (%s): %s', entry.id, entry.name, entry.changes.join(', '))
    })
    return { ...config, instances }
  }

  _migrateMappingInstances (config) {
    const { mappings, normalized } = normalizeMappingInstances(config.mappings)
    if (normalized.length === 0) {
      return config
    }
    this.log.info('[Server] stored the bridge of %s as a single id instead of an array', normalized.join(', '))
    return { ...config, mappings }
  }

  _migrateServiceNames (config) {
    const { mappings, changed } = migrateServiceNames(config.mappings)
    if (changed === 0) {
      return config
    }
    const renames = Object.entries(RENAMED_SERVICES).map(([from, to]) => `${from} -> ${to}`).join(', ')
    this.log.info('[Server] replaced removed service classes in %s mapping(s): %s', changed, renames)
    return { ...config, mappings }
  }

  _migrateConfigVersion (config) {
    const { config: upgraded, upgraded: changed } = upgradeConfigVersion(config)
    if (changed) {
      this.log.warn('[Server] configuration upgraded to version %s: the configuration UI now requires a CCU administrator session (useCCCAuthentication=true). Turn it off in the settings only if you really want an unprotected configuration UI.', CONFIG_VERSION)
    }
    return upgraded
  }

  buildMappings (mappings, serviceConfig) {
    // merge service mappings from user settings with internal config
    if (mappings === undefined) {
      mappings = {}
    }
    Object.keys(serviceConfig).forEach(key => {
      // create a new List for this type if not yet into the list
      if (mappings[key] === undefined) {
        mappings[key] = []
      }
      // add all services for this type
      serviceConfig[key].forEach(serviceName => {
        if (mappings[key].indexOf(serviceName) === -1) {
          mappings[key].push(serviceName)
        }
      })
    })
    return mappings
  }

  async publishServiceTable () {
    // this.log.info('[Server] current Service table %s', JSON.stringify(this.serviceConfig))
    if (this.configUI) {
      try {
        this.configUI.send({
          topic: 'services',
          services: this.serviceConfig
        })
      } catch (e) {
        this.log.error(e)
      }
    } else {
      this.log.debug('[Server] skipping service publishing to config server cause there is no config server (yet)')
      this.configpushwasSkipped = true
    }
  }

  async rebuildClassSettings () {
    this.log.debug('[Server] rebuild configuration as requested by enviroment change')
    const pending = []
    Object.keys(this.serviceConfig).forEach((classType) => {
      this.serviceConfig[classType].forEach((serviceItem) => {
        pending.push(this._loadClassSettings(serviceItem))
      })
    })
    // wait until every class has its settings, including async lookups such as the duty cycle devices
    await Promise.all(pending)
    this.publishServiceTable()
  }

  _requireServiceClass (serviceClazz) {
    return require(path.join(__dirname, 'services', serviceClazz))
  }

  async _loadClassSettings (serviceItem) {
    try {
      const clazz = this._requireServiceClass(serviceItem.serviceClazz)
      serviceItem.settings = await Promise.resolve(clazz.configurationItems(this._ccu))
    } catch (e) {
      // a single failing class must not prevent publishing the service table
      this.log.error('[Server] unable to load settings for %s: %s', serviceItem.serviceClazz, e.stack || e)
    }
  }

  buildServiceList () {
    this.log.debug('[Server] build up service list')
    const self = this
    const serviceConfig = {}
    // this will loop thru all HomeMatic*Accessory.js files and get the ChannelTypes
    const sPath = path.join(__dirname, 'services')

    return new Promise((resolve, reject) => {
      fs.readdir(sPath, async (err, items) => {
        if (err) {
          self.log.error('[Server] error while reading the service classes %s', err)
          reject(err)
          return
        }
        self.log.debug('[Server] start loading services')
        await Promise.all(
          items.map(async (item) => {
            try {
              if (item.match(/HomeMatic.*Accessory.js/)) {
                self.log.debug('[Server] processing service file %s', item)
                const test = require(path.join(__dirname, 'services', item))
                const serviceName = test.name
                const channelTypes = test.channelTypes()
                const priority = test.getPriority()
                const serviceDescription = test.serviceDescription()
                const filterDevice = test.filterDevice()
                let settings
                try {
                  settings = await Promise.resolve(test.configurationItems(self._ccu))
                } catch (e) {
                  // keep the class available; rebuildClassSettings() refreshes the settings later
                  self.log.error('[Server] unable to load settings for %s: %s', serviceName, e.stack || e)
                  settings = {}
                }
                if ((channelTypes) && (channelTypes.length > 0)) {
                  channelTypes.forEach(channelType => {
                    if (serviceConfig[channelType] === undefined) {
                      serviceConfig[channelType] = []
                    }
                    const config = {
                      serviceClazz: serviceName,
                      settings,
                      priority,
                      description: serviceDescription,
                      filterDevice
                    }
                    serviceConfig[channelType].push(config)
                  })
                  self.log.debug('[Server] processing service file %s is done', item)
                } else {
                  self.log.warn('[Server] WARNING There is no Channeltype declaration in %s::channelTypes', serviceName)
                }
              } else {
                self.log.debug('[Server] --- service file %s did not match HomeMatic*Accessory.js', item)
              }
            } catch (e) {
              // one broken service class must not stall the startup
              self.log.error('[Server] unable to load service file %s: %s', item, e.stack || e)
            }
          })
        )
        self.log.debug('[Server] ordering services: native default first, then priority and name')
        // the first entry is the default service of the channel type (see util/defaultServices.js)
        Object.keys(serviceConfig).forEach(key => {
          serviceConfig[key] = orderServiceList(serviceConfig[key], key)
        })
        self.log.debug('[Server] done loading services')
        resolve(serviceConfig)
      })
    })
  }

  addAccessory (accessory, bridge, publishToBridge) {
    const bridgeID = accessory.instanceID
    const acUID = accessory.getUUID()
    if (this._publishedAccessories[bridgeID + '_' + acUID] === undefined) {
      this.log.debug('[Server] adding accessory %s', accessory.getName())
      this._publishedAccessories[bridgeID + '_' + acUID] = accessory
    } else {
      this.log.warn('[Server] warning a accessory with the same uuid %s as one added before', bridgeID + '_' + acUID)
    }
    // we add the accessory when the bridge is set to publish devices or its a non bridgedAccessory
    if ((publishToBridge === true) || (accessory.isBridgedAccessory() === false)) {
      if (accessory.isBridgedAccessory() === true) {
        this.log.debug('[Server] %s is a bridged accessory', accessory.getName())
        try {
          bridge.addBridgedAccessory(accessory.getHomeKitAccessory())
          bridge.hasPublishedDevices = true
        } catch (e) {
          this.log.error('[Server] unable to add accessory %s', e.stack)
          return false
        }
      } else {
        this.log.debug('[Server] %s is a single accessory on port %s', accessory.getName(), this.currentPortNum)
        accessory.publishSingleAccessory(this.currentPortNum)
        this.currentPortNum = this.currentPortNum + 1
      }
      accessory.isPublished = true
    }
    return true
  }

  publishAccessoriesToConfigurationService () {
    const deviceData = []
    const variableData = []
    const programData = []
    const specialDev = []
    const self = this
    self.log.debug('[Server] number of published accessories: %s', Object.keys(self._publishedAccessories).length)
    Object.keys(self._publishedAccessories).forEach((advertiseAddress) => {
      const accessory = self._publishedAccessories[advertiseAddress]
      // Sort the Appliances into diff arrays for WebUI
      switch (accessory.applianceType) {
        case ApplianceType.Variable:
          variableData.push(accessory._dictionaryPresentation())
          break
        case ApplianceType.Program:
          programData.push(accessory._dictionaryPresentation())
          break
        case ApplianceType.Special:
          specialDev.push(accessory._dictionaryPresentation())
          break
        case ApplianceType.Device:
          deviceData.push(accessory._dictionaryPresentation())
          break
      }
    })
    if (this.configUI) {
      const message = {
        topic: 'serverdata',
        accessories: deviceData,
        variables: variableData,
        programs: programData,
        special: specialDev,
        variableTrigger: this._configuration.VariableUpdateEvent,
        autoUpdateVarTriggerHelper: this._configuration.autoUpdateVarTriggerHelper,
        rooms: this._ccu.getRooms(),
        functions: this._ccu.getFunctions(),
        logfile: this.log.getLogFile()
      }
      try {
        this.configUI.send(message)
      } catch (e) {
        this.log.error(e)
      }
    }
  }

  publishBridgeInfosToConfigurationService () {
    const data = []
    this.log.debug('[Server] publish bridge info')
    this._bridges.forEach(bridge => {
      const bAcInfo = bridge._accessoryInfo
      data.push({
        id: bridge.instanceId,
        user: bAcInfo.username,
        displayName: bAcInfo.displayName,
        pincode: bAcInfo.pincode,
        hasPublishedDevices: bridge.hasPublishedDevices,
        setupID: bAcInfo.setupID,
        roomId: bridge.roomId,
        roomIds: bridge.roomIds || [],
        paired: (typeof bAcInfo.paired === 'function') ? bAcInfo.paired() : false,
        port: bridge.port,
        setupURI: bridge.setupURI()
      })
    })
    if (this.configUI) {
      try {
        this.configUI.send({
          topic: 'bridges',
          bridges: data
        })
      } catch (e) {
        this.log.error(e)
      }
    }
  }

  publishVirtualKeys () {
    const result = []
    const self = this
    this._ccu.getCCUDevices().forEach((device) => {
      if (((device.type === 'HmIP-RCV-50') || (device.type === 'HM-RCV-50')) && (device.channels) && (device.channels.length > 0)) {
        const usedInterface = self._ccu.getInterfaceWithID(device.channels[0].intf)
        device.ifName = (usedInterface) ? usedInterface.name : 'unknown'
        result.push(device)
      }
    })
    if (this.configUI) {
      try {
        this.configUI.send({
          topic: 'virtualKeys',
          virtualKeys: result
        })
      } catch (e) {
        this.log.error(e)
      }
    }
  }

  shutdownBridgeInstances () {
    const self = this
    if (this._bridges) {
      this._bridges.forEach(bridge => {
        self.log.info('[Server] shutting down Homekit bridge %s', bridge.instanceName)
        bridge.unpublish()
      })
    }
    Object.keys(self._publishedAccessories).forEach((advertiseAddress) => {
      self._publishedAccessories[advertiseAddress].getHomeKitAccessory().unpublish()
      self._publishedAccessories[advertiseAddress].shutdown()
    })
    this._bridges = []
    this._publishedAccessories = {}
    this._variableAccessories = []
    this._specialAccessories = []
  }

  _removeDevice (uuid) {
    const self = this
    const accessory = self._publishedAccessories[uuid]
    if (accessory) {
      accessory.removeData()
    }
  }

  shutdown () {
    this.log.info('[Server] shutting down all homekit instances')
    this.shutdownBridgeInstances()

    setTimeout(() => {
      process.exit()
    }, 2000)

    this._ccu.shutdown()
    this.log.info('[Server] bye')
  }

  launchUIConfigurationServer () {
    const self = this
    process.env.UIX_CONFIG_PATH = this._configurationPath
    process.env.UIX_DEBUG = this.log.isDebugEnabled()
    if (this.ccuHost) {
      process.env.UIX_CCUHOST = this.ccuHost
    }

    this.configUI = childProcess.fork(path.resolve(__dirname, 'configurationsrv'), null, {
      env: process.env
    })

    this.log.info('Spawning configuration service with PID', this.configUI.pid)

    this.configUI.on('message', (message) => {
      self._handleIncommingIPCMessage(message)
    })
  }

  async _reloadAppliances () {
    if (this.reloadMode === true) {
      this.log.warn('[Server] skip reload currently running')
      return
    }
    this.reloadMode = true
    this.log.info('[Server] reloading all appliances')
    const self = this
    this.shutdownBridgeInstances()
    await this._ccu.disconnectInterfaces()
    setTimeout(() => {
      self.loadSettings()
      self.connectCCU()
    }, 1000)
  }

  _handleIncommingIPCMessage (message) {
    if ((message) && (message.topic)) {
      switch (message.topic) {
        case 'reloadApplicances':
          this._reloadAppliances()
          break

        case 'createTrigger':
          this._ccu.updateCCUVarTrigger(this._configuration.VariableUpdateEvent)
          break
        case 'refreshCache':
          this._ccu.updateDatabases(this._configurationPath)
          this._ccu.updateDeviceDatabase()
          break

        // tell the device to remove its history and persistent data
        case 'remove':
          this._removeDevice(message.uuid)
          // reload all stuff
          this._reloadAppliances()
          break
        case 'debug':
          this.log.setDebugEnabled(message.debug)
          if (this.configUI) {
            try {
              this.configUI.send({
                topic: 'debug',
                debug: this.log.isDebugEnabled()
              })
            } catch (e) {
              this.log.error(e)
            }
          }
          break

        case 'cfghello':
          this.log.debug('[Server] configuration server is alive')
          if (this.configpushwasSkipped === true) {
            this.log.debug('[Server] publish service table again since we have config server now')
            this.publishServiceTable()
          }
          break
        default:
          break
      }
    }
  }

  _findServiceClass (channel) {
    // First try settings address
    this.log.debug('[Server] try find serviceclazz for %s', channel.address)
    const mappings = this._configuration.mappings || {}
    const byAddress = mappings[channel.address]
    // Channel:Address Mapping is an object
    if ((byAddress) && (typeof byAddress === 'object') && (byAddress.Service)) {
      this.log.debug('[Server] service %s found thru address %s', byAddress.Service, channel.address)
      return byAddress.Service
    }

    const deviceTypeKey = channel.dtype + ':' + channel.type
    const configured = this._configuredServiceFor(mappings, deviceTypeKey) || this._configuredServiceFor(mappings, channel.type)
    if (configured) {
      this.log.debug('[Server] service %s found thru configured mapping for %s', configured, deviceTypeKey)
      return configured
    }

    // the native default: see util/defaultServices.js
    const serviceTable = this.serviceConfig || {
      [deviceTypeKey]: [].concat(mappings[deviceTypeKey] || []),
      [channel.type]: [].concat(mappings[channel.type] || [])
    }
    const sClass = defaultServiceFor(serviceTable, channel.dtype, channel.type)
    if (sClass) {
      this.log.debug('[Server] default service %s used for %s', sClass, deviceTypeKey)
      return sClass
    }
    this.log.debug('[Server] nothing found for %s %s:%s', channel.address, channel.dtype, channel.type)
    return undefined
  }

  /**
   * A service the configuration maps a device or channel type to (legacy "mappings" entries
   * { serviceClazz } or lists that do not come from the service classes); undefined otherwise.
   */
  _configuredServiceFor (mappings, key) {
    const entry = mappings[key]
    if ((!entry) || (typeof entry !== 'object')) {
      return undefined
    }
    if (!Array.isArray(entry)) {
      return entry.serviceClazz
    }
    const builtIn = (this.serviceConfig && this.serviceConfig[key]) || []
    const first = entry[0]
    const isConfigured = (first !== undefined) && (this.serviceConfig !== undefined) && !builtIn.includes(first)
    return isConfigured ? first.serviceClazz : undefined
  }

  async _buildCompatibleObjectList () {
    // loop thru all devices an channels and try to find services
    this.log.debug('[Server] build compatible device list')
    const self = this
    if (!this.serviceConfig) {
      this.serviceConfig = await this.buildServiceList()
    }
    this.log.debug('[Server] .. services fetched')
    const supportedChannelList = Object.keys(this.serviceConfig)
    this.log.debug('[Server] .. %s supported channeltypes', supportedChannelList.length)

    this._compatibleDevices = []
    const devAdrList = [] // this is only for indication that we add the device just once
    if (this._ccu.getCCUDevices()) {
      this.log.debug('[Server] got %s devices from your ccu', this._ccu.getCCUDevices().length)
      this._ccu.getCCUDevices().forEach(device => {
        device.channels.forEach(channel => {
          // first check DEVICETYPE:CHANNELTYPE
          if (supportedChannelList.indexOf(device.type + ':' + channel.type) > -1) {
            channel.isSuported = true
            if (devAdrList.indexOf(device.address) === -1) {
              devAdrList.push(device.address)
              self._compatibleDevices.push(device)
            }
          }
          if (supportedChannelList.indexOf(channel.type) > -1) {
            // get the device filter and make sure the given device is not in the list
            const item = self.serviceConfig[channel.type]
            item.forEach(sClass => {
              if (sClass.filterDevice.indexOf(device.type) === -1) {
                channel.isSuported = true
                if (devAdrList.indexOf(device.address) === -1) {
                  devAdrList.push(device.address)
                  self._compatibleDevices.push(device)
                }
              }
            })
          }
        })
      })
    } else {
      this.log.error('[Server] unable to generate service list. CCU Devicelist is empty')
    }
    this.log.debug('[Server] ... devicelist completed')
    this._ccuVariables = this._ccu.getVariables()
    // Loop thru all variables an select the boolean ones
    this._ccuVariables.forEach(variable => {
      if (variable) {
        if (((variable.valuetype === 2) && (variable.subtype === 2)) ||
          ((variable.valuetype === 4) && (variable.subtype === 0)) ||
          ((variable.valuetype === 16) && (variable.subtype === 29))
        ) {
          variable.isCompatible = true
        } else {
          variable.isCompatible = false
        }
      }
    })
    this.log.debug('[Server] ..variables completed')
    // send the list to the configuration service
    if (this.configUI) {
      try {
        this.log.debug('[Server] send List %', this._compatibleDevices.length)

        this.configUI.send({
          topic: 'compatibleObjects',
          devices: this._compatibleDevices,
          variables: this._ccuVariables,
          programs: this._ccu.getPrograms()
        })
      } catch (e) {
        this.log.error(e)
      }
    }
    // oh boy !
    if (this.isTestMode) {
      this.log.debug('[Server] %s compatible devices found', devAdrList.length)
    } else {
      this.log.info('[Server] %s compatible devices found', devAdrList.length)
    }
  }

  _loadVariables (variables, forInstanceID, bridge, publish) {
    const self = this
    let hazObjects = false
    variables.forEach(variable => {
      // Varaibles use there own Clazz
      const varObject = self._ccu.variableWithName(variable.name)
      if (varObject) {
        let instanceToAdd = uuid.generate('0') // default is Instance 0
        let settings = self._configuration.mappings[variable.address]
        if ((settings !== undefined) && (settings.instance !== undefined)) {
          instanceToAdd = settings.instance
        }

        const sClass = (settings) ? (settings.Service || 'HomeMaticVariableAccessory') : 'HomeMaticVariableAccessory'
        const clazZFile = serviceClassFile(sClass)

        // make sure we only initialize the channels for this instance
        if ((clazZFile === undefined) && self._deviceHazInstance(instanceToAdd, forInstanceID)) {
          self.log.error('[Server] unknown service class %s for variable %s', JSON.stringify(sClass), variable.name)
        } else if (self._deviceHazInstance(instanceToAdd, forInstanceID)) {
          self.log.debug('[Server] try adding variable %s to bridge %s using service %s', variable.name, forInstanceID, sClass)
          const Appliance = require(clazZFile)
          if (settings === undefined) {
            settings = {}
          }
          const accessory = new Appliance(variable, 'Variable', self, settings)
          // save the variable
          accessory.variable = varObject
          accessory.nameInCCU = varObject.name
          accessory.init()
          accessory.instanceID = forInstanceID
          accessory.serviceClass = sClass
          accessory.settings = settings
          accessory.applianceType = ApplianceType.Variable
          this.addAccessory(accessory, bridge, publish)
          this._variableAccessories.push(accessory)
          hazObjects = true
        }
      } else {
        self.log.warn('[Server] variable with name %s not found at ccu', variable.name)
      }
    })
    return hazObjects
  }

  _loadSpecialDevices (special, forInstanceID, bridge, publish) {
    const self = this
    let hazObjects = false
    self.log.debug('[Server] start adding special devices')
    special.forEach(spDevice => {
      // Varaibles use there own Clazz
      let instanceToAdd = uuid.generate('0') // default is Instance 0
      let settings = self._configuration.mappings[spDevice.address]
      if ((settings !== undefined) && (settings.instance !== undefined)) {
        instanceToAdd = settings.instance
        self.log.debug('[Server] setup %s to add to bridge %s completed', settings.name, forInstanceID)
      } else {
        self.log.warn('[Server] did not find settings for special device with id %s', spDevice.address)
      }
      if (settings) {
        const sClass = settings.Service
        const clazZFile = serviceClassFile(sClass)
        if (clazZFile === undefined) {
          self.log.error('[Server] unknown service class %s for special device %s', JSON.stringify(sClass), spDevice.address)
        } else if (self._deviceHazInstance(instanceToAdd, forInstanceID)) {
          const Appliance = require(clazZFile)
          if (settings === undefined) {
            settings = {}
          }
          const accessory = new Appliance(spDevice, 'Special', self, settings)
          accessory.init()
          accessory.instanceID = forInstanceID
          accessory.serviceClass = sClass
          accessory.settings = settings
          accessory.applianceType = ApplianceType.Special
          self.log.debug('[Server] try adding special device %s to bridge %s', settings.name, forInstanceID)
          this.addAccessory(accessory, bridge, publish)
          hazObjects = true
        }
      } else {
        self.log.debug('[Server] looks like there are no settings for %s', special)
      }
    })

    return hazObjects
  }

  _loadPrograms (programs, forInstanceID, bridge, publish) {
    const self = this
    let hazObjects = false
    const sClass = 'HomeMaticProgramAccessory'
    const clazZFile = serviceClassFile(sClass)
    programs.forEach(program => {
      // Varaibles use there own Clazz
      let instanceToAdd = uuid.generate('0') // default is Instance 0
      let settings = self._configuration.mappings[program.address]
      if ((settings !== undefined) && (settings.instance !== undefined)) {
        instanceToAdd = settings.instance
      }
      if (self._deviceHazInstance(instanceToAdd, forInstanceID)) {
        self.log.debug('[Server] try adding %s to bridge %s', program.name, forInstanceID)
        const Appliance = require(clazZFile)
        if (settings === undefined) {
          settings = {}
        }
        const accessory = new Appliance(program, 'Program', self, settings)
        accessory.applianceType = ApplianceType.Program
        accessory.nameInCCU = program.name

        accessory.init()
        accessory.instanceID = forInstanceID
        accessory.serviceClass = sClass
        accessory.settings = settings

        this.addAccessory(accessory, bridge, publish)
        hazObjects = true
      }
    })

    return hazObjects
  }

  _deviceHazInstance (instances, search) {
    if (typeof instances === 'string') {
      return (instances === search)
    } else {
      return (instances.indexOf(search) > -1)
    }
  }

  _loadAccessories (channelList, forInstanceID, bridge, publish) {
    const self = this
    let hazObjects = false
    const defaultRemotes = new Set() // devices that got a remote as default service of an unmapped key
    channelList.forEach(channel => {
      const settings = self._configuration.mappings[channel.address]
      // a key of a remote or an output combined into another accessory has none of its own (util/combinedChannels.js)
      if ((settings === undefined) && (coveringAddress(self._configuration.mappings, channel) !== undefined)) {
        self.log.debug('[Server] %s is part of the accessory of %s', channel.address, coveringAddress(self._configuration.mappings, channel))
        return
      }
      let instanceToAdd = uuid.generate('0') // default is Instance 0
      // if there are settings ... use instances from settings
      if ((settings !== undefined) && (settings.instance !== undefined)) {
        instanceToAdd = settings.instance
      }
      // make sure we only initialize the channels for this instance
      if (self._deviceHazInstance(instanceToAdd, forInstanceID)) {
        const sClass = self._findServiceClass(channel)
        // one remote per device, also when it is the default service of several unmapped keys
        if ((settings === undefined) && (sClass === REMOTE_SERVICE)) {
          const serial = String(channel.address).split(':')[0]
          if (defaultRemotes.has(serial)) {
            self.log.debug('[Server] %s is a button of the remote of its device', channel.address)
            return
          }
          defaultRemotes.add(serial)
        }
        if (sClass) {
          self.log.debug('[Server] try adding %s to bridge %s', channel.name, forInstanceID)
          const oInterface = self._ccu.getInterfaceWithID(channel.intf)
          if (oInterface) {
            oInterface.inUse = true
            if (!self.isTestMode) {
              self.log.info('[Server] service used for %s is %s', channel.name, sClass)
            } else {
              self.log.debug('[Server-TestMode] service used for %s is %s', channel.name, sClass)
            }
            // Init the service class and create a appliance object
            try {
              const clazZFile = serviceClassFile(sClass)
              if (clazZFile !== undefined) {
                const Appliance = require(clazZFile)
                const channelTypes = Appliance.channelTypes()
                const filterDevice = Appliance.filterDevice()
                if (((channelTypes.indexOf(channel.type) > -1) || (channelTypes.indexOf(channel.dtype + ':' + channel.type) > -1)) &&
                    // additional check the device type should not been in the filterDevice list
                    (filterDevice.indexOf(channel.dtype) === -1)) {
                  const accessory = new Appliance(channel, oInterface.name, self, settings)
                  accessory.init()
                  accessory.instanceID = forInstanceID
                  accessory.serviceClass = sClass
                  accessory.settings = settings
                  accessory.applianceType = ApplianceType.Device
                  // add the accessory to the bridge
                  if (publish === true) {
                    self.log.info('[Server] add %s to bridge instance %s', channel.name, forInstanceID)
                  }
                  if (self.addAccessory(accessory, bridge, publish)) {
                    hazObjects = true
                  } else {
                    self.log.error('[Server] unable to initialize %s see previous error', channel.name)
                  }
                } else {
                  self.log.error('[Server] unable to initialize %s', channel.name)
                  self.log.error('[Server] requested ServiceClass %s did not provide a service for %s', sClass, channel.type)
                }
              } else {
                self.log.error('Unable to initialize %s file %s was not found.', channel.name, clazZFile)
              }
            } catch (e) {
              self.log.error('Unable to initialize %s Error is %s', channel.name, e.stack)
            }
          } else {
            self.log.warn('[Server] Interface %s not found in ccu manager', channel.intf)
          }
        } else {
          self.log.warn('[Server] there is no known service for %s:%s on channel %s', channel.dtype, channel.type, channel.address)
        }
      } else {
        // not my instance
      }
    })
    return hazObjects
  }
}

module.exports = Server
