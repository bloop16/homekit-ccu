/*
 * File: application.js
 * Project: homekit-ccu
 * File Created: Tuesday, 10th March 2020 8:10:00 pm
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

import { Network } from './network.js'

import { Button, Grid, Label, DatabaseGrid, Dialog, CheckBox, ButtonInput } from './ui.js'

import { HAPWebSockets } from './sockets.js'

import {
  PublishDevicesSettingsWizzard, EditDeviceWizzard, DeleteDeviceWizzard,
  NewHAPInstanceWizzard, DeleteHapInstanceWizzard, EditHapInstanceWizzard,
  NewObjectWizzard, EditObjectWizzard, DeleteVariableWizzard,
  RebootUpdateDialog, DeactivateInstanceWizzard, DeleteProgramWizzard,
  InvalidCredentialsDialog, SettingsDialog, SupportDialog, BackupRestoreDialog,
  SelectTriggerDialog, LostDevicesWizzard
} from './wizzards.js'

import { SetupAssistant } from './setupassistant.js'

import { NewDeviceWizzard } from './newdevicewizzard.js'

import { Localization } from './localization.js'

export class Application {
  constructor () {
    // extract SID from the index url

    let queryString = window.location.search
    // prevent a bug
    if (queryString.startsWith('?')) {
      queryString = queryString.replace('?', '')
    }
    const urlParams = new URLSearchParams(queryString)
    this.sid = urlParams.get('sid')
    const network = new Network(this.sid)
    this.apiBase = network.apiBase
    this.makeApiRequest = network.makeApiRequest
    this.makeFormRequest = network.makeFormRequest
  }

  userFriendlySeconds (seconds) {
    if (seconds < 50) {
      return this.__('less that 1 minute')
    }
    if (seconds < 3600) {
      return this.__('%s min', Math.round((seconds / 60)))
    }
    if (seconds < 86400) {
      const hr = Math.round((seconds / 60 / 60))
      return (hr === 1) ? this.__('%s hour', hr) : this.__('%s hours', hr)
    }
    const d = Math.floor((seconds / 60 / 60 / 24))
    return (d === 1) ? this.__('%s day', d) : this.__('%s days', d)
  }

  statList (rows) {
    const list = $('<ul>').addClass('stat-list')
    rows.forEach(([label, value]) => {
      list.append($('<li>').append($('<span>').text(label)).append($('<span>').text(value)))
    })
    return list
  }

  buildOverview () {
    const oOv = $('#deviceOverview')
    oOv.empty()
    const devices = (this.deviceList) ? this.deviceList.length : 0
    oOv.append($('<div>').addClass('stat-value').text(devices))
    oOv.append($('<div>').addClass('stat-label').text(this.__('Devices')))
    oOv.append(this.statList([
      [this.__('Variables'), (this.variableList) ? this.variableList.length : 0],
      [this.__('Programs'), (this.programList) ? this.programList.length : 0],
      [this.__('Special devices'), (this.specialList) ? this.specialList.length : 0]
    ]))

    const bOv = $('#bridgeOverview')
    bOv.empty()
    const bridges = this.bridges || []
    bOv.append($('<div>').addClass('stat-value').text(bridges.length))
    bOv.append($('<div>').addClass('stat-label').text(this.__('HomeKit Instances')))
    bOv.append(this.statList(bridges.map(bridge => [bridge.displayName, bridge.pincode])))

    if (this.systemInfo) {
      const cpu = (this.systemInfo.cpu && this.systemInfo.cpu[0]) || {}
      const mem = (parseInt(this.systemInfo.mem) / 1000000).toFixed(0)
      const sOv = $('#sysOverview')
      sOv.empty()
      sOv.append($('<div>').addClass('stat-value').text(this.systemInfo.version))
      sOv.append($('<div>').addClass('stat-label').text('HomeKit-CCU'))
      sOv.append(this.statList([
        [this.__('HomeKit-CCU uptime'), this.userFriendlySeconds(this.systemInfo.hapuptime)],
        [this.__('CCU uptime'), this.userFriendlySeconds(this.systemInfo.uptime)],
        [this.__('Free memory'), mem + ' MB'],
        [this.__('CPU'), ((this.systemInfo.cpu || []).length) + ' × ' + (cpu.model || '?')]
      ]))
    }

    this.debugMode = ((this.systemInfo) && ((this.systemInfo.debug === true) || (this.systemInfo.debug === 'true')))
    $('#lbl_btn_debug').text(this.debugMode ? this.__('Disable Debug') : this.__('Enable Debug'))
  }

  buildDeviceList () {
    const self = this
    $('#containerTitle').html(self.__('Devices'))
    this.activateMenuItem('showDevices')

    const deviceContainer = $('#container')
    const chartContainer = $('<div>')
    chartContainer.attr('id', 'chart_container')

    const containerFooter = $('#container_footer')

    deviceContainer.empty()
    deviceContainer.append(chartContainer)

    const grid = new DatabaseGrid('deviceList', undefined, {})
    grid.setBeforeQuery(() => {
      grid.dataset = self.deviceList // will fix #83
    })

    self.currentGrid = grid

    grid.setTitleLabels([self.__('Address'), self.__('Homekit name'), self.__('Service'), self.__('Instance')])
    grid.setColumns([
      { sz: { sm: 6, md: 2, lg: 2, xl: 2 }, sort: 0 },
      { sz: { sm: 6, md: 2, lg: 2, xl: 2 }, sort: 1 },
      { sz: { sm: 6, md: 2, lg: 2, xl: 3 }, sort: 2 },
      { sz: { sm: 6, md: 2, lg: 2, xl: 2 }, sort: 3 },
      { sz: { sm: 6, md: 2, lg: 2, xl: 2 } },
      { sz: { sm: 6, md: 2, lg: 2, xl: 1 } }
    ])
    grid.addSearchBar(self.__('Search'), self.__('Clear'), (element, filter) => {
      return (((element.name) && (element.name.toLowerCase().indexOf(filter.toLowerCase()) > -1)) ||
      ((element.serial) && (element.serial.toLowerCase().indexOf(filter.toLowerCase()) > -1)))
    })

    grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return (a.serial + ':' + a.channel).localeCompare(b.serial + ':' + b.channel)
        case 1:
          return a.name.localeCompare(b.name)
        case 2:
          return a.serviceClass.localeCompare(b.serviceClass)
        case 3: {
          const ba = this.getBridgeWithId(a.instanceID)
          const bb = this.getBridgeWithId(b.instanceID)
          return ((ba && ba.displayName) || '').localeCompare((bb && bb.displayName) || '')
        }
        default:
          return true
      }
    }

    grid.columnSort = 0

    grid.setRenderer((row, item) => {
      const editButton = new Button('outline-primary', self.__('Edit'), (e, btn) => {
        new EditDeviceWizzard(this).run(item)
      }, true)

      const deleteButton = new Button('outline-danger', self.__('Delete'), (e, btn) => {
        new DeleteDeviceWizzard(this).run(item)
      }, true)

      const bridgeNames = self.bridgeBadge(item)

      if ((item.settings) && (item.settings.instance)) {
        if ((typeof item.settings.instance !== 'string') && (item.settings.instance.length > 1)) {
          bridgeNames.append(' +' + (item.settings.instance.length - 1))
        }
      }

      return ([
        item.serial + ':' + item.channel,
        item.name,
        item.serviceClass,
        bridgeNames,

        editButton.render(),
        deleteButton.render()])
    })

    deviceContainer.append(grid.render())

    const newButton = new Button('primary', self.__('New'), async (e, btn) => {
      const mapDevices = await this.makeApiRequest({ method: 'newDevice' })
      new NewDeviceWizzard(this).run(mapDevices.devices, mapDevices.iconBase)
    })
    newButton.setStyle('float:right')
    containerFooter.empty()
    containerFooter.append(newButton.render())
  }

  getDeviceList () {
    return this.deviceList || []
  }

  getBridges () {
    return this.bridges || []
  }

  getRooms () {
    return this.roomList || []
  }

  // published (green) or pending (grey) badge with the name of the item's HomeKit instance
  bridgeBadge (item) {
    const bridge = this.getBridgeWithId(item.instanceID)
    const badgeState = (item.isPublished === true) ? 'text-bg-success' : 'text-bg-secondary'
    const name = bridge ? bridge.displayName : '?'
    return $('<span>').addClass('badge rounded-pill ' + badgeState).attr('title', name).text(name)
  }

  getBridgeWithId (id) {
    return this.getBridges().filter(bridge => bridge.id === id)[0] || undefined
  }

  getServiceByAddress (chAddress) {
    return this.getDeviceList().filter(device => device.serial + ':' + device.channel === chAddress)[0] || undefined
  }

  getRoombyId (roomID) {
    return this.getRooms().filter(room => room.id === roomID)[0] || undefined
  }

  getRoombyChannelId (channelID) {
    return this.getRooms().filter(room => (room.channels.indexOf(channelID) > -1))[0] || undefined
  }

  getVariableBySerial (varSerial) {
    return this.variableList.filter(variable => variable.nameInCCU === varSerial)[0] || undefined
  }

  getProgramBySerial (progSerial) {
    return this.programList.filter(program => program.nameInCCU === progSerial)[0] || undefined
  }

  // the bridge of a room: made for this room, else one holding it among several rooms (a floor)
  getHapInstanceByRoomId (roomId) {
    return this.bridges.find(bridge => bridge.roomId === roomId) ||
      this.bridges.find(bridge => (bridge.roomIds || []).includes(roomId))
  }

  getChannelByAddress (chAddress) {
    const dAdr = chAddress.split(':')[0]
    const matchedDevices = this.ccuDevices.filter(device => (device.address === dAdr))
    if ((matchedDevices) && (matchedDevices.length > 0)) {
      return matchedDevices[0].channels.filter(channel => (channel.address === chAddress))[0] || undefined
    }
    return undefined
  }

  getPredictedHapInstanceForChannel (channel) {
    // first get the room
    if (channel) {
      const room = this.getRoombyChannelId(channel.id)
      if (room) {
        // get the rooms hapInstance
        return this.getHapInstanceByRoomId(room.id)
      }
    }
  }

  showQR (item) {
    const closeButton = new Button('secondary', this.__('Close'), () => dialog.close())
    const dialog = new Dialog({
      dialogId: 'selectorDialog',
      buttons: [
        closeButton
      ],
      title: 'QR Setup Code',
      dialogClass: 'modal-success',
      scrollable: true,
      size: 'modal-md'
    })

    const qr = qrcode(4, 'L')
    qr.addData(item.setupURI)
    qr.make()
    const content = $('<div>')
    const img = $('<div>').addClass('homeKitCode')
    const pin = item.pincode.replace(/-/g, '')
    const lbl = $('<span>').text(pin.substring(0, 4)).append('<br />').append(document.createTextNode(pin.substring(4, 8)))
    img.append(lbl)
    img.append(qr.createImgTag(6, 0))
    content.append(img)
    dialog.setBody(content)
    dialog.open()
  }

  showInstances () {
    const self = this
    $('#containerTitle').html(self.__('HomeKit Instances'))
    this.activateMenuItem('hapInstances')
    const hapCcontainer = $('#container')
    const containerFooter = $('#container_footer')
    hapCcontainer.empty()

    let showFirewallHint = false
    const grid = new DatabaseGrid('instList', this.bridges, {})

    grid.setTitleLabels([self.__('Instance name'), 'Port', self.__('PinCode'), self.__('Published devices'), self.__('CCU Room'), ''])

    grid.setColumns([
      { sz: { sm: 6, md: 3, lg: 3, xl: 3 }, sort: 0 },
      { sz: { sm: 6, md: 1, lg: 1, xl: 1 } },
      { sz: { sm: 6, md: 2, lg: 2, xl: 2 } },
      { sz: { sm: 6, md: 1, lg: 1, xl: 1 } },
      { sz: { sm: 6, md: 2, lg: 2, xl: 2 }, sort: 4 },
      { sz: { sm: 12, md: 3, lg: 3, xl: 3 } }
    ])

    grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return (a.displayName).localeCompare(b.displayName)
        case 4: {
          const roomA = self.getRoombyId(a.roomId) || { name: '' }
          const roomB = self.getRoombyId(b.roomId) || { name: '' }
          return roomA.name.localeCompare(roomB.name)
        }

        default:
          return true
      }
    }

    grid.columnSort = 4

    grid.setRenderer((row, item) => {
      const isDefault = item.id === 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab'

      const mkBtn = (variant, icon, label, enabled, onClick) => {
        const btn = $('<button>').attr('type', 'button').addClass('btn btn-sm btn-' + variant)
        btn.attr('title', label).attr('aria-label', label)
        btn.append($('<i>').addClass('bi ' + icon))
        if (!enabled) btn.attr('disabled', 'disabled')
        else btn.on('click', onClick)
        return btn
      }

      const btnGroup = $('<div>').addClass('btn-group btn-group-sm')
      btnGroup.append(mkBtn('outline-primary', 'bi-pencil', self.__('Edit'), !isDefault, () => new EditHapInstanceWizzard(self).run(item)))
      btnGroup.append(mkBtn('outline-danger', 'bi-trash', self.__('Delete'), !isDefault, () => new DeleteHapInstanceWizzard(self).run(item)))
      btnGroup.append(mkBtn('outline-warning', 'bi-slash-circle', self.__('Deactivate'), item.hasPublishedDevices, () => new DeactivateInstanceWizzard(self).run(item)))

      // show a hint when ccu will block this port
      const strPortLabel = new Label('strPortLabel' + item.id)
      if (item.ccuFirewall) {
        strPortLabel.setLabel(item.port)
        strPortLabel.label.addClass('text-success')
      } else {
        strPortLabel.setLabel(item.port + ' (!!)')
        strPortLabel.label.addClass('text-danger fw-semibold')
        showFirewallHint = true
      }
      const room = self.getRoombyId(item.roomId)
      const pinLabel = new Label('pinLabel' + item.id)
      pinLabel.setLabel(item.pincode)
      if (item.user === item.user.toUpperCase()) {
        pinLabel.label.addClass('link-primary clickable font-monospace')
      }
      pinLabel.label.on('click', (e) => {
        self.showQR(item)
      })

      return ([item.displayName,
        strPortLabel.render(),
        pinLabel.render(),
        item.hasPublishedDevices ? self.__('Yes') : self.__('No'),
        (room !== undefined) ? room.name : '',
        btnGroup
      ])
    })
    hapCcontainer.append(grid.render())

    const newButton = new Button('primary', self.__('New'), async (e, btn) => {
      new NewHAPInstanceWizzard(this).run()
    })
    newButton.setStyle('float:right')
    containerFooter.empty()
    if (showFirewallHint) {
      const fwHintlabel = new Label('fwHint')
      fwHintlabel.setLabel(this.__('(!!) = Please make sure, that these ports are not blocked by your CCU firewall.'))
      containerFooter.append(fwHintlabel.render())
    }
    containerFooter.append(newButton.render())
  }

  showSpecial () {
    const self = this
    $('#containerTitle').html(self.__('Special devices'))
    this.activateMenuItem('showSpecialDevices')
    const container = $('#container')
    const containerFooter = $('#container_footer')
    container.empty()

    const grid = new DatabaseGrid('specialList', undefined, {})
    grid.getDataset = () => { return self.specialList }

    self.currentGrid = grid
    grid.setTitleLabels([self.__('HomeKit name'), self.__('Service'), self.__('Instance name')])

    grid.setColumns([
      { sz: { sm: 6, md: 3, lg: 3, xl: 3 } },
      { sz: { sm: 6, md: 3, lg: 3, xl: 3 } },
      { sz: { sm: 6, md: 3, lg: 3, xl: 3 } },
      { sz: { sm: 6, md: 2, lg: 2, xl: 2 } },
      { sz: { sm: 6, md: 1, lg: 1, xl: 1 } }
    ])

    grid.setRenderer((row, item) => {
      const editButton = new Button('outline-primary', self.__('Edit'), (e, btn) => {
        const wz = new EditDeviceWizzard(this)
        wz.onExit = () => {

        }
        wz.run(item)
      }, true)

      const deleteButton = new Button('outline-danger', self.__('Delete'), (e, btn) => {
        const wz = new DeleteDeviceWizzard(this)
        wz.onExit = () => {

        }
        wz.run(item)
      }, true)

      return ([item.name,
        item.serviceClass,
        self.bridgeBadge(item),
        editButton.render(),
        deleteButton.render()
      ])
    })

    container.append(grid.render())

    const newButton = new Button('primary', self.__('New'), async (e, btn) => {
      const wzNew = new EditDeviceWizzard(this)

      wzNew.onExit = () => {

      }

      wzNew.run({
        settings: { settings: {} },
        name: 'Name',
        serial: 'new',
        channel: 'special',
        uuid: 'new'
      })
    })
    newButton.setStyle('float:right')
    containerFooter.empty()
    containerFooter.append(newButton.render())
  }

  showVariables () {
    const self = this
    $('#containerTitle').html(self.__('Variables'))
    this.activateMenuItem('showVariables')
    const hapCcontainer = $('#container')
    const containerFooter = $('#container_footer')
    hapCcontainer.empty()

    const grid = new DatabaseGrid('varList', undefined, {})

    grid.setBeforeQuery(() => {
      grid.dataset = self.variableList // will fix #83
    })

    self.currentGrid = grid

    grid.setTitleLabels([self.__('HomeKit name'), self.__('HomeMatic name'), self.__('Instance name')])

    grid.setColumns([
      { sz: { sm: 6, md: 3, lg: 3, xl: 3 }, sort: 0 },
      { sz: { sm: 6, md: 3, lg: 3, xl: 3 }, sort: 1 },
      { sz: { sm: 6, md: 2, lg: 3, xl: 3 }, sort: 2 },
      { sz: { sm: 6, md: 2, lg: 2, xl: 2 } },
      { sz: { sm: 6, md: 2, lg: 1, xl: 1 } }
    ])

    grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return (a.nameInCCU).localeCompare(b.nameInCCU)
        case 1:
          return a.name.localeCompare(b.name)
        case 2: {
          const ba = this.getBridgeWithId(a.instanceID)
          const bb = this.getBridgeWithId(b.instanceID)
          return ((ba && ba.displayName) || '').localeCompare((bb && bb.displayName) || '')
        }
        default:
          return true
      }
    }

    grid.columnSort = 0

    grid.setRenderer((row, item) => {
      const editButton = new Button('outline-primary', self.__('Edit'), (e, btn) => {
        const wz = new EditObjectWizzard(self, self.__('Edit variable'))
        wz.setServices(self.variableServices)
        wz.willSave((wizzard) => {
          wizzard.objectData.method = 'saveVariable'
          wizzard.objectData.settings = JSON.stringify(wizzard.objectData.settings)
        })

        wz.onClose(() => {
          self.refreshVariables()
        })

        wz.run(item)
      }, true)

      const deleteButton = new Button('outline-danger', self.__('Delete'), (e, btn) => {
        new DeleteVariableWizzard(this).run(item)
      }, true)

      return ([item.name, item.nameInCCU, self.bridgeBadge(item), editButton.render(), deleteButton.render()])
    })

    hapCcontainer.append(grid.render())

    const newButton = new Button('primary', self.__('New'), async (e, btn) => {
      const mapVariables = await this.makeApiRequest({ method: 'newVariable' })
      const wz = new NewObjectWizzard(this, this.__('Add new Variable'), this.__('Setup variable'))
      wz.setServices(self.variableServices)

      wz.willSave((wizzard) => {
        wizzard.objectData.method = 'saveVariable'
        wizzard.objectData.settings = JSON.stringify(wizzard.objectData.settings)
      })

      wz.onClose(() => {
        self.refreshVariables()
      })

      wz.checkObjectIsMapped((item) => {
        return self.getVariableBySerial(item.nameInCCU)
      })

      wz.setListTitles([self.__('Variable'), self.__('Description')])

      wz.run(mapVariables.variables)
    })
    newButton.setStyle('float:right')

    const varTrigger = new ButtonInput('varTrigger', this.variableTrigger, this.__('Select'), null, async (e, input) => {
      const obj = await self.makeApiRequest({ method: 'virtualKeys' })
      const channels = []
      obj.virtualKeys.forEach((device) => {
        device.channels.forEach((channel) => {
          channel.ifName = device.ifName
          channels.push({ title: channel.name, value: channel.ifName + '.' + channel.address + '.PRESS_SHORT' })
        })
      })
      const dialog = new SelectTriggerDialog(self)
      dialog.setTrigger(self.variableTrigger)
      dialog.setKeyList(channels)
      dialog.setProceed((newValue) => {
        varTrigger.setValue(newValue)
      })
      dialog.run()
    })

    varTrigger.setStyle('width:100%')
    varTrigger.setGroupLabel('Trigger')

    const autoUpdateControl = new CheckBox('autoUpdate', this.autoUpdateVarTriggerHelper, (e, input) => {
      self.autoUpdateVarTriggerHelper = input.checked
    })

    autoUpdateControl.setLabel(this.__('Create/Update the CCU helper program.'))

    const updateTriggerButton = new Button('primary', self.__('Update Trigger'), async (e, btn) => {
      const triggerDp = varTrigger.getValue()

      if (triggerDp) {
        await self.makeApiRequest({ method: 'saveVariableTrigger', datapoint: triggerDp, autoUpdateVarTriggerHelper: self.autoUpdateVarTriggerHelper })
        self.refreshVariables()
      }
    })
    updateTriggerButton.setStyle('float:right')

    containerFooter.empty()

    const gridFooter = new Grid()
    gridFooter.addRow().addCell({ sm: 12, md: 12, lg: 12, xl: 12 }, newButton.render())

    const triggerRow = gridFooter.addRow('', { rowStyle: 'margin-bottom:15px' })
    triggerRow.addCell({ sm: 12, md: 6, lg: 6, xl: 6 }, varTrigger.render())
    triggerRow.addCell({ sm: 12, md: 6, lg: 3, xl: 3 }, autoUpdateControl.render())
    triggerRow.addCell({ sm: 12, md: 6, lg: 2, xl: 2 }, updateTriggerButton.render())

    gridFooter.addRow().addCell({ sm: 12, md: 12, lg: 12, xl: 12 }, new Label(this.__('This has to be a KEY datapoint. All variables will be updated on an event at this KEY')).render())
    containerFooter.append(gridFooter.render())
  }

  showPrograms () {
    const self = this
    $('#containerTitle').html(self.__('Programs'))
    this.activateMenuItem('showPrograms')
    const hapCcontainer = $('#container')
    const containerFooter = $('#container_footer')
    hapCcontainer.empty()

    const grid = new DatabaseGrid('progList', this.programList, {})

    grid.setTitleLabels([self.__('HomeKit name'), self.__('HomeMatic name'), self.__('Instance name')])

    grid.setColumns([
      { sz: { sm: 6, md: 3, lg: 3, xl: 3 }, sort: 0 },
      { sz: { sm: 6, md: 3, lg: 3, xl: 3 }, sort: 1 },
      { sz: { sm: 6, md: 2, lg: 3, xl: 3 }, sort: 2 },
      { sz: { sm: 6, md: 2, lg: 2, xl: 2 } },
      { sz: { sm: 6, md: 2, lg: 1, xl: 1 } }
    ])

    grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return a.name.localeCompare(b.name)
        case 1:
          return (a.nameInCCU).localeCompare(b.nameInCCU)
        case 2: {
          const ba = this.getBridgeWithId(a.instanceID)
          const bb = this.getBridgeWithId(b.instanceID)
          return ((ba && ba.displayName) || '').localeCompare((bb && bb.displayName) || '')
        }
        default:
          return true
      }
    }
    grid.columnSort = 0

    grid.setRenderer((row, item) => {
      const editButton = new Button('outline-primary', self.__('Edit'), (e, btn) => {
        const wz = new EditObjectWizzard(self, self.__('Edit program'))

        wz.willSave((wizzard) => {
          wizzard.objectData.method = 'saveProgram'
        })

        wz.onClose(() => {
          self.refreshPrograms()
        })

        wz.run(item)
      }, true)

      const deleteButton = new Button('outline-danger', self.__('Delete'), (e, btn) => {
        const wz = new DeleteProgramWizzard(self, self.__('Remove program'))
        wz.run(item)
      }, true)

      return ([item.name, item.nameInCCU, self.bridgeBadge(item), editButton.render(), deleteButton.render()])
    })

    hapCcontainer.append(grid.render())

    const newButton = new Button('primary', self.__('New'), async (e, btn) => {
      const mapPrograms = await this.makeApiRequest({ method: 'newProgram' })
      const wz = new NewObjectWizzard(this, this.__('Add new program'), this.__('Setup program'))

      wz.willSave((wizzard) => {
        wizzard.objectData.method = 'saveProgram'
      })

      wz.onClose(() => {
        self.refreshPrograms()
      })

      wz.checkObjectIsMapped((item) => {
        return self.getProgramBySerial(item.nameInCCU)
      })

      wz.setListTitles([self.__('Program'), self.__('Description')])

      wz.run(mapPrograms.programs)
    })
    newButton.setStyle('float:right')

    containerFooter.empty()
    containerFooter.append(newButton.render())
  }

  async publish (bridgeId) {
    const bridgesToPublishDevices = []
    this.bridges.forEach(bridge => {
      if ((bridge.publish === true) || (bridge.id === bridgeId)) {
        bridgesToPublishDevices.push(bridge.id)
      }
    })
    await this.makeApiRequest({ method: 'publish', bridges: JSON.stringify(bridgesToPublishDevices) })
  }

  async refreshBridges () {
    this.bridges = await this.makeApiRequest({ method: 'bridges' })
    this.buildOverview()
    this.showInstances()
  }

  async refreshVariables () {
    const tmp = await this.makeApiRequest({ method: 'variablelist' })
    if (tmp) {
      this.variableList = tmp.variables
      this.variableTrigger = tmp.trigger
      this.autoUpdateVarTriggerHelper = tmp.autoUpdateVarTriggerHelper
    }
    this.showVariables()
  }

  async refreshPrograms () {
    const tmp = await this.makeApiRequest({ method: 'programlist' })
    if (tmp) {
      this.programList = tmp.programs
    }
    this.showPrograms()
  }

  checkPermissionFromError (e) {
    const self = this
    if ((e.status === 401) && (!this.errorShown)) {
      this.errorShown = true
      const dialog = new InvalidCredentialsDialog(this)
      dialog.onClose = () => {
        self.errorShown = false
      }
      dialog.run()
    }
  }

  restoreBackupWizzaard () {
    const self = this
    const dialog = new BackupRestoreDialog(this)

    dialog.setProceedRestore(async (fileToUpload) => {
      const frm = new FormData()
      frm.append('method', 'restore')
      frm.append('file', fileToUpload, 'backup.tar.gz')
      await self.makeFormRequest('/restore/', frm)
      dialog.close()
    })

    dialog.setProceedBackup(() => {
      dialog.close()
      window.location.href = self.apiBase + '/api/?method=backup&sid=' + self.sid
    })

    dialog.run()
  }

  async refreshAll () {
    try {
      await this.makeApiRequest({ method: 'refresh' })
    } catch (e) {
      this.checkPermissionFromError(e)
    }
  }

  async getAllVariables () {
    const vr = await this.makeApiRequest({ method: 'allVariables' })
    return vr.variables
  }

  activateMenuItem (item) {
    const menuItems = ['showDevices', 'showVariables', 'showPrograms', 'showSpecialDevices', 'hapInstances']
    menuItems.forEach(menuItem => {
      $('#' + menuItem).toggleClass('active', menuItem === item).attr('aria-current', menuItem === item ? 'page' : null)
    })
  }

  async loadGraphList () {
    // history graphs of devices that have one (Eve)
    const self = this
    const chartContainer = $('#chart_container')
    chartContainer.empty()
    const graphList = await self.makeApiRequest({ method: 'listGraph' })
    if (!Array.isArray(graphList) || graphList.length === 0) {
      return
    }
    chartContainer.addClass('mb-4')
    const style = getComputedStyle(document.body)
    const textColor = style.getPropertyValue('--bs-secondary-color').trim()
    const gridColor = style.getPropertyValue('--bs-border-color').trim()
    const lineColor = style.getPropertyValue('--bs-primary').trim() || '#2f6fed'

    for (const graph of graphList) {
      const data = await self.makeApiRequest({ method: 'graphDetail', id: graph.id })
      const wrapper = $('<div>').addClass('position-relative').attr('style', 'height:300px')
      const canvas = $('<canvas>').attr('id', graph.id)
      wrapper.append(canvas)
      chartContainer.append(wrapper)

      const labels = []
      const values = []
      ;(data || []).forEach((dt) => {
        labels.push(new Date(dt.timestamp * 1000).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))
        values.push(parseInt(dt.value))
      })

      // eslint-disable-next-line no-new
      new Chart(canvas[0], {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: graph.name,
            data: values,
            borderColor: lineColor,
            backgroundColor: 'rgba(47, 111, 237, 0.12)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2
          }]
        },
        options: {
          maintainAspectRatio: false,
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { color: textColor } } },
          scales: {
            x: { ticks: { color: textColor, maxTicksLimit: 8 }, grid: { color: gridColor } },
            y: { ticks: { color: textColor }, grid: { color: gridColor } }
          }
        }
      })
    }
  }

  async checkLostAndFound () {
    const lostDevices = await this.makeApiRequest({ method: 'checklost' })
    if ((lostDevices) && (lostDevices.length > 0)) {
      // not on top of the setup assistant
      if ($('#setupAssistant').length > 0) {
        return
      }

      const ldWizzard = new LostDevicesWizzard(this)
      ldWizzard.run(lostDevices)
    }
  }

  hook () {
    const self = this
    // sidebar entries are buttons, not links; on small screens the menu closes after a choice
    $('.sidebar-nav .nav-link').on('click', (e) => {
      e.preventDefault()
      const sidebar = bootstrap.Offcanvas.getInstance(document.getElementById('sidebar'))
      if (sidebar) {
        sidebar.hide()
      }
    })
    $('#showAssistant').on('click', () => {
      new SetupAssistant(this).run()
    })

    $('#showDevices').on('click', (e) => {
      $('#breadcrum_page').html(this.__('Devices'))
      self.buildDeviceList(0, 10)
      self.loadGraphList()
    })

    $('#publishingSettings').on('click', (e) => {
      new PublishDevicesSettingsWizzard(this).run()
    })

    $('#hapInstances').on('click', (e) => {
      self.showInstances()
      $('#breadcrum_page').html(this.__('HomeKit Instances'))
    })

    $('#showVariables').on('click', (e) => {
      self.showVariables()
      $('#breadcrum_page').html(this.__('Variables'))
    })

    $('#showPrograms').on('click', (e) => {
      self.showPrograms()
      $('#breadcrum_page').html(this.__('Programs'))
    })

    $('#showSpecialDevices').on('click', (e) => {
      self.showSpecial()
      $('#breadcrum_page').html(this.__('Special devices'))
    })

    $('#btn_debug').on('click', async (e) => {
      await self.makeApiRequest({ method: 'debug', enable: !self.debugMode })
    })

    $('#btn_support').on('click', () => {
      const dlg = new SupportDialog(this)
      dlg.setProceed((serial) => {
        window.location.href = self.apiBase + '/api/?method=support&address=' + serial
      })
      dlg.run()
    })

    $('#btn_restart').on('click', async () => {
      self.updateDialog = new RebootUpdateDialog(this)
      self.updateDialog.setProceed(async (enableLog) => {
        self.makeApiRequest({ method: 'restart', debug: enableLog })
        setTimeout(() => {
          self.waitForReboot()
        }, 2000)
      })
      self.updateDialog.run(self.__('Restart HomeKit-CCU?'))
    })

    $('#btn_changelog').on('click', async () => {
      const cl = await this.makeApiRequest({ method: 'changelog' }, 'text')
      const dialog = new Dialog({
        dialogId: 'changeLog',
        buttons: [
          new Button('secondary', self.__('Close'), (e, btn) => {
            dialog.close()
          }, true)
        ],
        title: self.__('Changelog'),
        dialogClass: 'modal-info',
        scrollable: true,
        size: 'modal-xl'
      })

      dialog.setBody($('<div>').addClass('markdown-body').html(self.markdown(cl)))
      dialog.open()
    })

    $('#btn_settings').on('click', () => {
      const sad = new SettingsDialog(this)
      sad.setProceed(async (settings) => {
        await this.makeApiRequest({ method: 'saveSettings', settings: JSON.stringify(settings) })
      })
      sad.run()
    })

    $('#btn_dnlog').on('click', () => {
      window.location.href = self.apiBase + '/api/?method=getLog&sid=' + self.sid
    })

    $('#btn_refreshCache').on('click', async () => {
      await this.makeApiRequest({ method: 'refreshCache' })
      self.showToast(self.__('Cache updated ...'))
    })

    $('#btn_backup').on('click', () => {
      this.restoreBackupWizzaard()
    })
  }

  markdown (text) {
    const converter = new showdown.Converter()
    return DOMPurify.sanitize(converter.makeHtml(text || ''))
  }

  showToast (message) {
    $('#toastMessage').text(message)
    bootstrap.Toast.getOrCreateInstance(document.getElementById('toast'), { delay: 3000 }).show()
  }

  // this will drive me nuts .. i can feel it
  __ () {
    return this.localizer.localize.apply(this.localizer, arguments)
  }

  // a new installation (bridges, but nothing in HomeKit yet) starts with the setup assistant
  checkWizzard () {
    if ((this.bridges) && (this.deviceList) && (this.deviceList.length === 0) && (!this.setupAssistantShown)) {
      this.setupAssistantShown = true
      new SetupAssistant(this).run()
    }
  }

  async waitForReboot () {
    const self = this
    this.makeApiRequest({ method: 'bridges' }).then((result) => {
      if (self.updateDialog) {
        self.updateDialog.close()
      }
      self.refreshAll()
    }).catch((e) => {
      if (e.status === 401) {
        self.checkPermissionFromError(e)
      }
      setTimeout(() => {
        self.waitForReboot()
      }, 2000)
    })
  }

  async run () {
    const self = this

    this.localizer = new Localization()
    await this.localizer.init()
    this.localizer.localizePage()

    this.deviceList = []
    this.variableList = []
    this.programList = []
    this.rooms = []
    this.hook()

    this.socket = new HAPWebSockets(this.apiBase, this.sid)
    this.socket.initSocket((socket, data) => {
      if (data) {
        // Process Socket Messages
        switch (data.message) {
          case 'heartbeat':
            self.systemInfo = data.payload
            self.buildOverview()
            break

          case 'unauthorized':
            self.checkPermissionFromError({ status: 401 })
            break

          case 'ackn':
            self.systemInfo = data.payload
            self.buildOverview()
            self.buildDeviceList(0, 10)
            self.loadGraphList()
            self.refreshAll()
            break

          case 'serverdata':
            if (data.payload) {
              self.bridges = data.payload.bridges
              self.deviceList = data.payload.accessories
              self.variableList = data.payload.variables
              self.variableTrigger = data.payload.variableTrigger
              self.variableServices = data.payload.variableServices
              self.autoUpdateVarTriggerHelper = data.payload.autoUpdateVarTriggerHelper
              self.programList = data.payload.programs
              self.roomList = data.payload.rooms
              self.specialList = data.payload.special
              self.ccuDevices = data.payload.ccuDevices
            }

            self.buildOverview()

            if (self.currentGrid) {
              self.currentGrid.requestRefresh()
              // implement a refresh
              self.currentGrid.refresh()
            }

            self.checkWizzard()
            self.checkLostAndFound()
            break
        }
      }
    })
    setTimeout(async () => {
      try {
        await self.makeApiRequest({ method: 'refreshCache' })
      } catch (e) {
        self.checkPermissionFromError(e)
      }
    }, 2000)
  }
}
