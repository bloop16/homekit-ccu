/*
 * File: wizzards.js
 * Project: homekit-ccu
 * File Created: Thursday, 19th March 2020 4:40:43 pm
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

import {
  Dialog, Button,
  Grid, DatabaseGrid, SelectInput, ButtonInput,
  Dropdown, Input, CheckBox, Spinner, Label, escapeHtml
} from './ui.js'

export class Wizzard {
  constructor (application) {
    this.application = application
    const self = this
    this.activitySpinner = new Spinner()
    this.dialogWasCanceld = true
    this.dissmissButton = new Button('light', self.__('Dismiss'), (e, btn) => {
      if (self.dialog) {
        self.dialogWasCanceld = true
        if (self.onClose) {
          self.onClose()
        }
        self.dialog.close()
      }
    }, true)
  }

  __ () {
    // this is crazy
    return this.application.__.apply(this.application, arguments)
  }

  setOnClose (onClose) {
    this.onClose = onClose
  }

  run () {
    if (this.dialog) {
      this.dialog.open()
    }
  }

  close () {
    if (this.dialog) {
      this.dialog.close()
    }
  }
}

export class FilterObjectDialog extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    this.dissmissButton.setLabel(self.__('Cancel'))
    this.dialog = new Dialog({
      dialogId: 'selectorDialog',
      buttons: [
        self.dissmissButton
      ],
      title: self.__('Select'),
      dialogClass: 'modal-success',
      scrollable: true,
      size: 'modal-md'
    })
  }

  setListTitles (titles) {
    this.listTitles = titles
  }

  onSelect (fkt) {
    this.onSelect = fkt
  }

  run (id, objectList) {
    const self = this
    const content = $('<div>')

    this.grid = new DatabaseGrid(id + '_objectSelector', objectList, { maxPages: 4 })

    this.grid.addSearchBar(self.__('Search'), self.__('Clear'), (element, filter) => {
      if (element) {
        return ((element.name) && (element.name.toLowerCase().indexOf(filter.toLowerCase()) > -1))
      } else {
        return false
      }
    })

    this.grid.setTitleLabels(this.listTitles)

    this.grid.setColumns([
      { sz: { sm: 6, md: 8, lg: 8 }, sort: 0 },
      { sz: { sm: 6, md: 4, lg: 4 } }
    ])

    this.grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return a.name.localeCompare(b.name)
        case 1:
          return a.dpInfo.localeCompare(b.dpInfo)
        default:
          return true
      }
    }
    this.grid.columnSort = 0

    this.grid.setRenderer((row, item) => {
      const selectButton = new Button('info', self.__('Select'), (e, btn) => {
        if (self.onSelect) {
          self.onSelect(item.name)
        }
      })
      selectButton.setStyle('width:100%')
      return ([item.name, selectButton.render()])
    })

    content.append(this.grid.render())
    this.dialog.setBody(content)
    this.dialog.open()
  }
}

export class RebootUpdateDialog extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    this.debug = false
    this.debugControl = new CheckBox('debug', false, (e, input) => {
      self.debug = input.checked
    })
    this.debugControl.setLabel(this.__('Enable debug at launch'))
    this.proceedButton = new Button('danger', self.__('YOLO'), async (e, btn) => {
      self.activitySpinner.setActive(true)
      self.dissmissButton.setActive(false)
      self.proceedButton.setActive(false)
      if (self.proceed) {
        self.proceed(self.debug)
      }
    }, true)
    this.dissmissButton.setLabel(self.__('Cancel'))
    this.dialog = new Dialog({
      dialogId: 'updateRebootDialog',
      buttons: [
        self.activitySpinner,
        self.dissmissButton,
        self.proceedButton
      ],
      title: self.__('Sure ?'),
      dialogClass: 'modal-danger',
      scrollable: true,
      size: 'modal-md'
    })
  }

  setProceed (callback) {
    this.proceed = callback
  }

  run (message) {
    const content = $('<div>')
    content.append(message)
    content.append('<br /><br />')
    content.append(this.debugControl.render())
    this.dialog.setBody(content)
    this.dialog.open()
  }
}

export class SelectTriggerDialog extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    this.debug = false

    this.keyOptionList = new SelectInput('keys', self.__('Select a key'), (e, sel) => {
      self.selectedKey = sel.value
    })

    this.proceedButton = new Button('info', self.__('Select'), async (e, btn) => {
      self.activitySpinner.setActive(true)
      self.dissmissButton.setActive(false)
      self.proceedButton.setActive(false)
      if (self.proceed) {
        self.proceed(self.selectedKey)
      }
      self.close()
    }, true)
    this.dissmissButton.setLabel(self.__('Cancel'))
    this.dialog = new Dialog({
      dialogId: 'selectTrigger',
      buttons: [
        self.activitySpinner,
        self.dissmissButton,
        self.proceedButton
      ],
      title: self.__('Select a virtual key'),
      dialogClass: 'modal-info',
      scrollable: false,
      size: 'modal-md'
    })
  }

  setProceed (callback) {
    this.proceed = callback
  }

  setTrigger (trigger) {
    if (trigger) {
      this.keyOptionList.setValue(trigger)
      this.selectedKey = trigger
    }
  }

  setKeyList (list) {
    this.keyOptionList.setOptions(list)
  }

  run () {
    const content = $('<div>')
    content.append(this.__('Due to the fact, that your ccu will not sent a message to hap when a variable will change its value, we have to build a helper.'))
    content.append('<br />')
    content.append(this.__('HAP will use a virtual key from your CCU for that helper.'))
    content.append('<br />')
    content.append(this.__('This key will be monitored by HAP. So HAP is able to detect when its time to reload the variables.'))
    content.append('<br /><br />')
    content.append(this.keyOptionList.render())
    content.append('<br />')
    content.append(this.__('The program to manage all this can be build by HAP automatically. Just select the option after you have chosen a key.'))
    this.dialog.setBody(content)
    this.dialog.open()
  }
}

export class BackupRestoreDialog extends Wizzard {
  constructor (application) {
    super(application)
    const self = this

    const grid = new Grid('dialogGrid', {

    })

    this.fileInput = new Input('file', undefined, (e, input) => {
      self.restoreButton.setActive(true)
    })

    this.fileInput.setType('file')
    this.fileInput.setLabel(this.__('Backup file'))

    this.backupButton = new Button('success', self.__('Create Backup'), async (e, btn) => {
      self.activitySpinner.setActive(true)
      self.dissmissButton.setActive(false)
      self.restoreButton.setActive(false)
      self.backupButton.setActive(false)
      if (self.proceedBackup) {
        self.proceedBackup()
      }
    }, true)

    this.restoreButton = new Button('success', self.__('Restore'), async (e, btn) => {
      self.activitySpinner.setActive(true)
      self.dissmissButton.setActive(false)
      self.restoreButton.setActive(false)
      if (self.proceedRestore) {
        self.proceedRestore(self.fileInput.getFiles(0))
      }
    }, true)

    self.restoreButton.setActive(false)

    let row = grid.addRow('backup', {})
    row.addCell({ md: 7, sm: 12, lg: 7, xl: 7 }, '')
    row.addCell({ md: 5, sm: 12, lg: 5, xl: 5 }, this.backupButton.render())

    row = grid.addRow('sep', {})
    row.addCell({ md: 12, sm: 12, lg: 12, xl: 12 }, '<hr />')

    row = grid.addRow('restore', {})
    row.addCell({ md: 7, sm: 12, lg: 7, xl: 7 }, this.fileInput.render())
    row.addCell({ md: 5, sm: 12, lg: 5, xl: 5 }, this.restoreButton.render())

    this.dissmissButton.setLabel(self.__('Cancel'))
    this.dialog = new Dialog({
      dialogId: 'restoreDialog',
      buttons: [
        self.activitySpinner,
        self.dissmissButton
      ],
      title: self.__('Backup/Restore'),
      dialogClass: 'modal-info',
      scrollable: true,
      size: 'modal-md'
    })

    const content = $('<div>')
    content.append(grid.render())
    this.dialog.setBody(content)
  }

  setProceedRestore (callback) {
    this.proceedRestore = callback
  }

  setProceedBackup (callback) {
    this.proceedBackup = callback
  }

  run () {
    this.dialog.open()
  }
}

export class SupportDialog extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    self.serial = ''
    self.inputName = new Input('deviceSerial', self.serial, (e, input) => {
      self.serial = input.value
    })

    self.inputName.setLabel(self.__('Device serial'))

    this.proceedButton = new Button('info', self.__('Download'), async (e, btn) => {
      self.proceedButton.setActive(false)
      if (self.proceed) {
        self.proceed(self.serial)
      }
    }, true)
    this.dissmissButton.setLabel(self.__('Close'))
    this.dialog = new Dialog({
      dialogId: 'supportDialog',
      buttons: [
        self.dissmissButton,
        self.proceedButton
      ],
      title: self.__('Request Support ...'),
      dialogClass: 'modal-info',
      scrollable: true,
      size: 'modal-md'
    })
  }

  setProceed (callback) {
    this.proceed = callback
  }

  run (message) {
    const content = $('<div>')
    content.append(this.__('If you want to add a devices you own, which is currently not supported, u may help the developer here.'))
    content.append('<br />')
    content.append(this.__('Please enter the serial number of your device. HomeKit-CCU will create an anonymous file with all necessary information to add this device.'))
    content.append('<br /><br />')
    content.append(this.__('After that, please navigate to <a target="_blank" href="https://github.com/bloop16/homekit-ccu/issues/new/choose">Github Issues</a>, create an new issue and attach the downloaded file.'))
    content.append('<br /><br />')
    content.append(this.inputName.render())
    content.append('<br /><br />')
    content.append(this.__('For other issues, please open a request at <a target="_blank" href="https://github.com/bloop16/homekit-ccu/issues/new/choose">GitHub Issues</a>. Please make sure, <a href="https://github.com/bloop16/homekit-ccu/issues">your problem was not reported previously</a> '))
    content.append(this.__(' and is not <a target="_blank"  href="https://github.com/bloop16/homekit-ccu/issues?q=is%3Aissue+is%3Aclosed">already fixed</a>.'))
    content.append('<br /><br />')
    this.dialog.setBody(content)
    this.dialog.open()
  }
}

export class SettingsDialog extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    const settings = {}
    settings.useAuth = application.systemInfo.useAuth
    this.authControl = new CheckBox('useAuthentication', settings.useAuth, (e, input) => {
      settings.useAuth = input.checked
    })
    this.authControl.setLabel(self.__('Require a CCU administrator session (recommended)'))

    settings.useTLS = application.systemInfo.useTLS
    if (application.systemInfo.isRemote) {
      this.tlsControl = new CheckBox('useTLS', settings.useTLS, (e, input) => {
        settings.useTLS = input.checked
      })
      this.tlsControl.setLabel(self.__('Use HTTPS'))
    }

    settings.enableMonitoring = application.systemInfo.enableMonitoring
    this.monitControl = new CheckBox('enableMonitoring', settings.enableMonitoring, (e, input) => {
      settings.enableMonitoring = input.checked
    })
    this.monitControl.setLabel(self.__('Enable Monitoring'))

    settings.disableHistory = application.systemInfo.disableHistory
    this.historyControl = new CheckBox('disableHistory', settings.disableHistory, (e, input) => {
      settings.disableHistory = input.checked
    })
    this.historyControl.setLabel(self.__('Apple Home Compatibility'))

    settings.interfaceWatchdog = application.systemInfo.interfaceWatchdog
    this.interfaceWatchdogControl = new Input('interfaceWatchdog', settings.interfaceWatchdog, (e, input) => {
      settings.interfaceWatchdog = input.value
    })
    this.interfaceWatchdogControl.setLabel(self.__('Watchdog Timeout (sec / 0 is off)'))

    const proceedButton = new Button('info', self.__('Save'), async (e, btn) => {
      self.activitySpinner.setActive(true)
      self.dissmissButton.setActive(false)
      proceedButton.setActive(false)
      if (self.proceed) {
        self.proceed(settings)
      }
      self.dialog.close()
    }, true)

    this.dialog = new Dialog({
      dialogId: 'SettingsDialog',
      buttons: [
        self.activitySpinner,
        self.dissmissButton,
        proceedButton
      ],
      title: self.__('Settings'),
      dialogClass: 'modal-danger',
      scrollable: true,
      size: 'modal-md'
    })
  }

  setProceed (callback) {
    this.proceed = callback
  }

  run (message) {
    const content = $('<div>')
    content.append(message)
    content.append('<br />')
    content.append(this.authControl.render())
    content.append(this.__('Without it, everyone in your network can change the HomeKit configuration and read the HomeKit pairing codes.'))
    content.append('<br /><br />')
    if (this.tlsControl) { content.append(this.tlsControl.render()) }
    content.append('<br />')
    content.append(this.monitControl.render())
    content.append('<br /><hr />')
    content.append(this.historyControl.render())
    content.append('<br />')
    content.append(
      this.__('This will disable the eve history. Due to the fact that Apples Home App is not able to show custom devices using this option will not generate custom devices.')
    )
    content.append('<br /><hr />')
    content.append(this.interfaceWatchdogControl.render())
    content.append('<br />')

    this.dialog.setBody(content)
    this.dialog.open()
  }
}

export class InvalidCredentialsDialog extends Wizzard {
  constructor (application) {
    super(application)
    const self = this

    this.dialog = new Dialog({
      dialogId: 'invalidCredentialDialog',
      buttons: [
        self.dissmissButton
      ],
      title: self.__('Invalid credentials'),
      dialogClass: 'modal-danger',
      scrollable: true,
      size: 'modal-md'
    })
  }

  run () {
    const content = $('<div>')
    content.append(this.__('No valid CCU session. Log in to the CCU WebUI as an administrator and open this page with the HomeKit button in the control panel (Additional software).'))
    content.append('<br /><br />')
    this.dialog.setBody(content)
    this.dialog.open()
  }
}

// the api does not answer at all (HomeKit-CCU stopped or not installed completely)
export class ApiUnreachableDialog extends Wizzard {
  constructor (application) {
    super(application)
    this.dialog = new Dialog({
      dialogId: 'apiUnreachableDialog',
      buttons: [
        new Button('primary', this.__('Reload'), () => window.location.reload()),
        this.dissmissButton
      ],
      title: this.__('No connection to HomeKit-CCU'),
      dialogClass: 'modal-danger',
      size: 'modal-md'
    })
  }

  run () {
    this.dialog.setBody($('<p>').text(this.__('The configuration server does not answer. Check under Settings → Control panel → Additional software that HomeKit-CCU is running; this page connects by itself once it does.')))
    this.dialog.open()
  }
}

export class ResetInstanceDialog extends Wizzard {
  constructor (application) {
    super(application)
    const self = this

    const resetButton = new Button('danger', self.__('Yes, reset the instance'), async (e, btn) => {
      self.activitySpinner.setActive(true)
      self.dissmissButton.setActive(false)
      resetButton.setActive(false)
      self.resetInstance()

      setTimeout(() => {
        self.dialog.close()
      }, 2000)
    }, true)

    this.dialog = new Dialog({
      dialogId: self.getDialogId(),
      buttons: [
        self.activitySpinner,
        self.dissmissButton,
        resetButton
      ],
      title: self.getTitle(),
      dialogClass: 'modal-danger',
      scrollable: true,
      size: 'modal-md'
    })
  }

  getDialogId () { return 'id' }
  getTitle () { return 'Reset ?' }

  async resetInstance () {
    await this.application.makeApiRequest({ method: 'resetInstance', uuid: this.hapInstance.id })
    setTimeout(() => {
      this.application.refreshBridges()
      this.dialog.close()
    }, 2000)
  }

  run (hapInstance) {
    this.hapInstance = hapInstance
    this.dialog.setBody(this.__('Are you sure you want to reset %s? HomeKit will not be able to access devices in this instance anymore. You have to reconnect the instance new to HomeKit. All your settings, automations using devices from this instance will be lost. Only perfom this in case you removed a instance allready and now you are note able to add it again to HomeKit.', hapInstance.displayName))
    this.dialog.open()
  }
}

export class DeleteItemWizzard extends Wizzard {
  constructor (application) {
    super(application)
    const self = this

    const deleteButton = new Button('danger', self.__('Yes, kick it baby'), async (e, btn) => {
      self.activitySpinner.setActive(true)
      self.dissmissButton.setActive(false)
      deleteButton.setActive(false)
      self.deleteItem()

      setTimeout(() => {
        self.dialog.close()
      }, 2000)
    }, true)

    this.dialog = new Dialog({
      dialogId: self.getDialogId(),
      buttons: [
        self.activitySpinner,
        self.dissmissButton,
        deleteButton
      ],
      title: self.getTitle(),
      dialogClass: 'modal-danger',
      scrollable: true,
      size: 'modal-md'
    })
  }

  getDialogId () { return 'id' }
  getTitle () { return 'YOU SHOULD PROVIDE A TITLE IN YOUR SUBCLASS' }
  deleteItem () { }
}

/** this is the dialog class for removing an device */
export class DeleteDeviceWizzard extends DeleteItemWizzard {
  async deleteItem () {
    const self = this
    await this.application.makeApiRequest({ method: 'removeDevice', uuid: this.device.UUID })
    setTimeout(() => {
      if (self.onExit) {
        self.onExit()
      } else {
        self.application.refreshAll()
      }
    }, 2000)
  }

  getDialogId () { return 'deleteDeviceDialog' }
  getTitle () { return this.__('Remove ...') }

  run (device) {
    this.device = device
    this.dialog.setBody(this.__('Are you sure you want to remove %s from HomeKit?', device.name))
    this.dialog.open()
  }
}

/** this is the dialog class for removing an hap instance */
export class DeleteHapInstanceWizzard extends DeleteItemWizzard {
  async deleteItem () {
    const self = this
    if (this.hapInstance.id !== 0) {
      await this.application.makeApiRequest({ method: 'removehapinstance', id: this.hapInstance.id })
      setTimeout(() => {
        self.application.refreshBridges()
        self.dialog.close()
      }, 2000)
    }
  }

  getDialogId () { return 'deleteDeviceDialog' }
  getTitle () { return this.__('Remove ...') }

  run (hapInstance) {
    this.hapInstance = hapInstance
    this.dialog.setBody(this.__('Are you sure you want to remove %s? All your devices will be reassigned to the default Instance.', hapInstance.displayName))
    this.dialog.open()
  }
}

export class DeleteVariableWizzard extends DeleteItemWizzard {
  async deleteItem () {
    const self = this
    if (this.variable.serial !== undefined) {
      await this.application.makeApiRequest({ method: 'removeVariable', serial: this.variable.nameInCCU, uuid: this.variable.UUID })
      setTimeout(() => {
        self.application.refreshVariables()
        self.dialog.close()
      }, 3000)
    }
  }

  getDialogId () { return 'deleteDeviceDialog' }
  getTitle () { return this.__('Remove ...') }

  run (variable) {
    this.variable = variable
    this.dialog.setBody(this.__('Are you sure you want to remove %s?', variable.name))
    this.dialog.open()
  }
}

export class DeleteProgramWizzard extends DeleteItemWizzard {
  async deleteItem () {
    const self = this
    if (this.program.serial !== undefined) {
      await this.application.makeApiRequest({ method: 'removeProgram', serial: this.program.nameInCCU, uuid: this.program.UUID })
      setTimeout(() => {
        self.application.refreshPrograms()
        self.dialog.close()
      }, 3000)
    }
  }

  getDialogId () { return 'deleteProgramDialog' }
  getTitle () { return this.__('Remove ...') }

  run (program) {
    this.program = program
    this.dialog.setBody(this.__('Are you sure you want to remove %s?', program.name))
    this.dialog.open()
  }
}

// this is the Abstract Class used by edit and new Device Wizzard
export class AbstractEditSettingsWizzard extends Wizzard {
  addControlRow (rowID, label, control, hint) {
    const row = this.grid.addRow(rowID)
    row.addCell({ sm: 12, md: 2, lg: 2 }, this.__(label || ''))
    row.addCell({ sm: 12, md: (hint !== undefined) ? 7 : 10, lg: (hint !== undefined) ? 5 : 10 }, (control) ? control.render() : '')
    if (hint !== undefined) {
      row.addCell({ sm: 12, md: 3, lg: 5 }, this.__(hint || ''), null, 'hint')
    }
    return row
  }

  /**
   * Lets the user choose a PNG or JPEG and uploads it to the config server, which stores it in
   * the configuration directory; onStored gets its path. The picture setting of the form then
   * names that file.
   */
  uploadPicture (onStored) {
    const self = this
    const chooser = $('<input>').attr({ type: 'file', accept: 'image/png,image/jpeg' })
    chooser.on('change', async () => {
      const file = chooser[0].files[0]
      if (!file) {
        return
      }
      const form = new FormData()
      form.append('file', file, file.name)
      try {
        const answer = await self.application.makeFormRequest('/upload/', form)
        onStored(answer.path)
        if (self.serviceSettings.template && self.serviceSettings.template.imageSource) {
          self.serviceSettings.settings.imageSource = 'File on the CCU'
          await self.buildDeviceSettings()
          self.grid.render()
        }
      } catch (e) {
        const reason = (e && e.responseJSON && e.responseJSON.error) || (e && e.statusText) || ''
        self.application.showToast(self.__('The picture was not stored.') + ' ' + reason)
      }
    })
    chooser.trigger('click')
  }

  buildTextControlField (template, settings, settingsKey, onChange) {
    const self = this
    let control
    if (template.selector) {
      const buttonTitle = (template.selector === 'picture') ? self.__('Upload picture') : self.__('Select')
      control = new ButtonInput(settingsKey, settings || template.default, buttonTitle, async (e, input) => {
        if (onChange) {
          onChange(input.value)
        }
      }, async (e, input) => {
        switch (template.selector) {
          case 'variables': {
            const dlg = new FilterObjectDialog(self.application)
            dlg.onSelect((nVarN) => {
              control.setValue(nVarN)
              dlg.close()
            })
            dlg.setListTitles([self.__('Variable')])
            const vars = await self.application.getAllVariables()
            dlg.run(template.selector, vars)
            break
          }
          case 'datapoint': {
            const dpDlg = new DatepointWizzard(self.application)
            dpDlg.onSelect = (item) => {
              control.setValue(item)
            }
            dpDlg.run(template.options)
            break
          }
          case 'channel': {
            const chDlg = new ChannelWizzard(self.application)
            chDlg.onSelect = (item) => {
              control.setValue(item.address)
            }
            chDlg.run(template.options)
            break
          }
          case 'picture':
            self.uploadPicture((file) => {
              control.setValue(file)
            })
            break
        }
      })
    } else {
      control = new Input(settingsKey, settings || template.default, (e, input) => {
        self.serviceSettings.settings[settingsKey] = input.value
      })
    }

    return control
  }

  async buildDeviceSettings () {
    const self = this
    let row
    self.grid.resetRows()

    const inputName = new Input('devicename', self.serviceSettings.name, (e, input) => {
      self.serviceSettings.name = input.value
    })

    const serviceDescription = new Label()

    const serviceList = await self.application.makeApiRequest({ method: 'service', channelAddress: this.serviceSettings.address })

    const oServiceList = new Dropdown('newDeviceService', self.serviceSettings.serviceClass || '')
    serviceList.service.forEach(service => {
      // set the current template
      if (service.serviceClazz === self.serviceSettings.serviceClass) {
        self.serviceSettings.template = service.settings
        serviceDescription.setLabel(self.__(service.description))
      }
      oServiceList.addItem({
        title: service.serviceClazz,
        value: service.serviceClazz,
        onClick: async (e, btn) => {
          self.serviceSettings.serviceClass = btn
          self.serviceSettings.template = service.settings
          // settings of the former service would only confuse the new form
          Object.keys(self.serviceSettings.settings || {})
            .filter(key => (service.settings || {})[key] === undefined)
            .forEach(key => delete self.serviceSettings.settings[key])
          serviceDescription.setLabel(self.__(service.description))
          await self.buildDeviceSettings()
          self.grid.render()
        }
      })
    })
    // create a empty settings mapp
    if (self.serviceSettings.settings === undefined) {
      self.serviceSettings.settings = {}
    }
    // select the first service if there is none
    if ((self.serviceSettings.serviceClass === undefined) && (serviceList.service.length > 0)) {
      self.serviceSettings.serviceClass = serviceList.service[0].serviceClazz
      self.serviceSettings.template = serviceList.service[0].settings
      serviceDescription.setLabel(self.__(serviceList.service[0].description))
      oServiceList.setTitle(self.serviceSettings.serviceClass)
    }

    self.addControlRow('deviceName', 'Homekit Device name', inputName, 'You may change the devicename as u like.')
    if (self.fixedServiceLabel) {
      // the kind of a special device is chosen before, the form only shows its settings
      const kind = $('<div>').append($('<div>').addClass('fw-semibold').text(self.fixedServiceLabel)).append(serviceDescription.render())
      self.addControlRow('description', 'Type', { render: () => kind })
    } else {
      self.addControlRow('service', 'Service', oServiceList, 'Select the service you want to use for this channel')
      self.addControlRow('description', 'Description', serviceDescription)
    }

    if (this.serviceSettings.template) {
      Object.keys(this.serviceSettings.template).forEach(settingsKey => {
        const template = self.serviceSettings.template[settingsKey]
        let settings = self.serviceSettings.settings[settingsKey]
        let control
        switch (template.type) {
          case 'option':
            // the stored value stays the (English) option, the list shows its translation
            control = new Dropdown(settingsKey, self.__(settings || template.default))
            template.array.forEach(item => {
              control.addItem({
                title: self.__(item),
                value: item,
                onClick: (e, btn) => {
                  self.serviceSettings.settings[settingsKey] = btn
                }
              })
            })
            break

          case 'number':
            control = new Input(settingsKey, parseInt(settings) || parseInt(template.default), (e, input) => {
              self.serviceSettings.settings[settingsKey] = parseInt(input.value)
            })
            break

          case 'text_control_array':
            if (!settings) {
              settings = { 0: '' }
            }
            Object.keys(settings).forEach((osk) => {
              const oneSetting = settings[osk]
              control = self.buildTextControlField(template, oneSetting, settingsKey, (newValue) => {
                settings[osk] = newValue
                self.serviceSettings.settings[settingsKey] = settings
                // fetch the channel name
                const selChannel = self.application.getChannelByAddress(newValue)
                let tHint = template.hint
                if (selChannel) {
                  tHint = tHint + ' (' + escapeHtml(selChannel.name) + ')'
                }
                $('#editDeviceGrid_st_key_' + osk + '_hint').html(tHint)
              })

              const removeButton = new Button('danger', self.__('Remove'), async (e) => {
                delete settings[osk]
                self.serviceSettings.settings[settingsKey] = settings
                await self.buildDeviceSettings()
                self.grid.render()
              })

              control.addButton(removeButton)
              const selChannel = self.application.getChannelByAddress(oneSetting)
              let tHint = template.hint
              if (selChannel) {
                tHint = tHint + ' (' + escapeHtml(selChannel.name) + ')'
              }
              row = self.addControlRow('st_' + settingsKey + '_' + osk, template.label, control, tHint)
            })

            self.addControlRow('st_newChannel' + settingsKey, '', new Button('info', self.__('Add new channel'), async (e) => {
              const ids = Object.keys(settings)
              const lastID = parseInt(ids[ids.length - 1])
              settings[lastID + 1] = ''
              await self.buildDeviceSettings()
              self.grid.render()
            }))

            control = undefined // prevent from adding the last one again
            break
          case 'text':

            control = self.buildTextControlField(template, settings, settingsKey, (newValue) => {
              self.serviceSettings.settings[settingsKey] = newValue
            })

            break

          case 'checkbox':
            control = new CheckBox(settingsKey, true, (e, input) => {
              self.serviceSettings.settings[settingsKey] = input.checked
            })
            // a stored false stays false, the default only applies when nothing is stored
            control.setValue((settings !== undefined) ? settings : template.default)
            break

          default:
            break
        }
        if ((self.serviceSettings.settings[settingsKey] === undefined) && (template.default !== undefined)) {
          self.serviceSettings.settings[settingsKey] = template.default
        }
        if (control) {
          const settingRow = self.addControlRow('st_' + settingsKey, template.label, control, template.hint)
          // rarely needed settings stay folded until asked for
          if ((template.advanced === true) && (self.showAdvanced !== true)) {
            settingRow.setClasses('d-none')
          }
        }
      })
      const hasAdvanced = Object.keys(this.serviceSettings.template).some(key => this.serviceSettings.template[key].advanced === true)
      if (hasAdvanced) {
        const toggle = new Button('link', self.showAdvanced ? self.__('Hide advanced settings') : self.__('Show advanced settings'), async () => {
          self.showAdvanced = !self.showAdvanced
          await self.buildDeviceSettings()
          self.grid.render()
        }, true)
        const toggleRow = self.grid.addRow('advancedToggle')
        toggleRow.addCell({ sm: 12, md: 2, lg: 2 }, '')
        toggleRow.addCell({ sm: 12, md: 10, lg: 10 }, toggle.render())
      }
    }
    let instances = 0
    Object.keys(self.serviceSettings.instanceIDs).forEach((instanceIDKey) => {
      const instanceID = self.serviceSettings.instanceIDs[instanceIDKey]
      instances += 1
      const hapList = new Dropdown('newDeviceHapList', self.__('Select a instance'))
      // a new device goes to the first bridge unless the user picks another one
      if ((instanceID === undefined) && (self.application.getBridges().length > 0)) {
        self.serviceSettings.instanceIDs[instanceIDKey] = self.application.getBridges()[0].id
      }
      const chosenID = self.serviceSettings.instanceIDs[instanceIDKey]
      self.application.getBridges().forEach(bridge => {
        if (bridge.id === chosenID) {
          hapList.setTitle(bridge.displayName)
        }
        hapList.addItem({
          title: bridge.displayName,
          value: bridge.id,
          onClick: (e, btn) => {
            self.serviceSettings.instanceIDs[instanceIDKey] = btn
          }
        })
      })

      row = self.grid.addRow('hapInstance')

      let desc = self.__('Select the HAP Instance to which you want to add this channel')

      if (instances > 1) {
        const removeButton = new Button('light', self.__('Remove'), async (e, btn) => {
          delete self.serviceSettings.instanceIDs[instanceIDKey]
          await self.buildDeviceSettings()
          self.grid.render()
        }, true)
        desc = removeButton.render()
      }

      row.addCell({ sm: 12, md: 2, lg: 2 }, self.__('HAP Instance'))
      row.addCell({ sm: 12, md: 5, lg: 5 }, hapList.render())
      row.addCell({ sm: 12, md: 5, lg: 5 }, desc)
    })
    const addNewInstanceButton = new Button('light', self.__('Add to another instance'), async (e, btn) => {
      self.serviceSettings.instanceIDs[(instances + 1)] = 0
      await self.buildDeviceSettings()
      self.grid.render()
    }, true)
    row = self.grid.addRow('newHapInstance')
    row.addCell({ sm: 12, md: 2, lg: 2 }, '')
    row.addCell({ sm: 12, md: 5, lg: 5 }, addNewInstanceButton.render())
    row.addCell({ sm: 12, md: 5, lg: 5 }, '')
  }
}

export class EditDeviceWizzard extends AbstractEditSettingsWizzard {
  constructor (application) {
    super(application)
    const self = this
    this.statusLabel = new Label()
    const publishButton = this.publishButton = new Button('success', self.__('Finish'), async (e, btn) => {
      self.activitySpinner.setActive(true)
      self.dissmissButton.setActive(false)
      publishButton.setActive(false)
      let saveResult = false
      try {
        saveResult = await self.saveDevice()
      } catch (e) {
        self.statusLabel.setLabel(self.__('Saving failed: %s', (e && (e.statusText || e.message)) || e))
      }
      if (saveResult === true) {
        setTimeout(() => {
          if (self.onExit) {
            self.onExit()
          } else {
            self.application.refreshAll()
          }
          self.dialogWasCanceld = false
          self.dialog.close()
        }, 2000)
      } else {
        self.activitySpinner.setActive(false)
        self.dissmissButton.setActive(true)
        publishButton.setActive(true)
      }
    }, true)

    self.dialog = new Dialog({
      dialogId: 'editDevice',
      buttons: [
        self.statusLabel,
        self.activitySpinner,
        self.dissmissButton,
        publishButton
      ],
      title: self.__('Edit device'),
      dialogClass: 'modal-info',
      scrollable: false,
      size: 'modal-xl'
    })

    this.sanityCheckFunction = (template, settings) => {
      let result = true
      Object.keys(template).forEach(key => {
        const st = template[key]
        if ((st.mandatory !== undefined) && (st.mandatory === true) && (settings[key] === undefined)) {
          result = false
        }
      })
      return result
    }
  }

  // resolves false when mandatory fields are missing; a failed request rejects
  async saveDevice () {
    const settings = this.serviceSettings.settings
    settings.instanceIDs = this.serviceSettings.instanceIDs
    if (this.sanityCheckFunction(this.serviceSettings.template, settings) === false) {
      this.statusLabel.setLabel(this.__('Some mandatory fields are missing'))
      return false
    }
    // the template and channel are only needed by the dialog, the form stays usable after an error
    const { template, channel, ...request } = this.serviceSettings
    request.settings = JSON.stringify(settings)
    this.statusLabel.setLabel(this.__('Proceeding ...'))
    const result = await this.application.makeApiRequest(request)
    if ((result) && (result.result !== undefined) && (result.result !== 'saved')) {
      // e.g. a special device whose name is taken
      this.statusLabel.setLabel(result.reason ? $('<span>').text(this.__(result.reason)) : this.__('Saving failed: %s', result.result))
      return false
    }
    // keep the saved data locally
    this.device.settings = JSON.parse(JSON.stringify(this.workingCopy))
    await this.application.publish()
    return true
  }

  async run (device) {
    const self = this
    const instanceIDs = {}
    let instanceIDKey = 0
    this.device = device
    try {
      this.workingCopy = JSON.parse(JSON.stringify(device)) // this is ridicoulus
    } catch (e) {
      console.log('unable to create working copy for device')
    }

    if ((this.workingCopy.settings.instance) && (typeof this.workingCopy.settings.instance !== 'string')) {
      this.workingCopy.settings.instance.forEach((instance) => {
        instanceIDs[instanceIDKey] = instance
        instanceIDKey += 1
      })
    } else {
      instanceIDs[0] = this.workingCopy.instanceID
    }
    this.serviceSettings = {
      method: 'saveDevice',
      name: this.workingCopy.name,
      address: this.workingCopy.serial + ':' + this.workingCopy.channel,
      instanceIDs,
      serviceClass: this.workingCopy.serviceClass,
      settings: this.workingCopy.settings.settings, // this will blow my mind
      uuid: this.workingCopy.UUID
    }
    const content = $('<div>').append(self.__('Edit your device %s here', this.workingCopy.name))
    content.append('<br /><br />')
    this.grid = new Grid('editDeviceGrid', { rowStyle: 'margin-bottom:15px' })
    await self.buildDeviceSettings()
    content.append(this.grid.render())
    self.dialog.setBody(content)
    self.dialog.open()
  }
}

export class PublishDevicesSettingsWizzard extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    const bridges = self.application.getBridges()
    const pending = bridges.filter(bridge => bridge.hasPublishedDevices !== true)
    const content = $('<div>')

    if (pending.length === 0) {
      // every bridge already publishes its devices: nothing to choose any more
      content.append($('<p>').text(self.__('All bridges already publish their devices. There is nothing left to do here.')))
    } else {
      content.append($('<p>').append(self.__('For the first setup you want to expose the bridge(s) without devices to HomeKit. So you are easily able to assign rooms to that bridge(s). If you do another publish with devices in the second step, they will be automaticaly added to the room where the particular bridge is located.')))
      content.append($('<p>').append(self.__('Publish bridge instances with devices:')))
    }

    bridges.forEach(bridge => {
      const checkBox = new CheckBox('publish_' + bridge.id, (bridge.hasPublishedDevices === true), (e, input) => {
        bridge.publish = input.checked
      })
      // a bridge that already publishes its devices cannot be switched back
      if (bridge.hasPublishedDevices === true) {
        checkBox.setEnabled(false)
      }
      checkBox.setLabel(self.__('Publish devices for %s', bridge.displayName))
      content.append(checkBox.render())
    })

    const publishButton = new Button('success', self.__('Finish'), (e, btn) => {
      self.activitySpinner.setActive(true)
      self.dissmissButton.setActive(false)
      publishButton.setActive(false)
      self.application.publish()
      setTimeout(() => {
        self.application.refreshAll()
        self.dialog.close()
      }, 2000)
    }, true)

    if (pending.length === 0) {
      self.dissmissButton.setLabel(self.__('Close'))
    }

    self.dialog = new Dialog({
      dialogId: 'publish',
      buttons: (pending.length === 0) ? [self.dissmissButton] : [self.activitySpinner, self.dissmissButton, publishButton],
      title: self.__('Publish devices'),
      dialogClass: 'modal-info'
    })
    self.dialog.setBody(content)
  }
}
/** this wizzard will create a new HAP Instance */
export class NewHAPInstanceWizzard extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    this.status = new Label()
    const content = $('<div>').append(self.__('Here you can setup a new HomeKit instance. Please give your instance a nice name (eg. Roomname)'))
    content.append('<br /><br />')
    this.grid = new Grid('newHAP', { rowStyle: 'margin-bottom:15px' })

    const newInstance = { method: 'createinstance', publish: true }
    let row = this.grid.addRow('instRow')

    const inputName = new Input('instancename', '', (e, input) => {
      newInstance.name = input.value
    })
    inputName.setGroupLabel('HomeMatic ')

    row.addCell({ sm: 12, md: 3, lg: 3 }, this.__('Homekit instance name:'))
    row.addCell({ sm: 12, md: 9, lg: 9 }, inputName.render())

    row = this.grid.addRow('roomRow')
    const ccuRoomList = this.application.getRooms()
    const oRoomList = new Dropdown('newInstanceRoom', this.__('Select a room'))
    ccuRoomList.forEach(room => {
      // set the current template
      oRoomList.addItem({
        title: room.name,
        value: room.id,
        onClick: async (e, btn) => {
          newInstance.roomId = btn
        }
      })
    })

    row.addCell({ sm: 12, md: 3, lg: 3 }, this.__('HomeMatic assigned room:'))
    row.addCell({ sm: 12, md: 9, lg: 9 }, oRoomList.render())

    content.append(this.grid.render())
    const finishButton = new Button('success', self.__('Finish'), async (e, btn) => {
      if (newInstance.name) {
        self.status.setLabel(self.__('Creating instance ...'))
        self.activitySpinner.setActive(true)
        self.dissmissButton.setActive(false)
        finishButton.setActive(false)
        await self.application.makeApiRequest(newInstance)
        setTimeout(() => {
          self.application.refreshBridges()
          self.dialog.close()
        }, 2000)
      } else {
        // message for missing name
        self.status.setLabel(self.__('Please fill the name'))
      }
    }, true)

    self.dialog = new Dialog({
      dialogId: 'newhapinstance',
      buttons: [
        self.status,
        self.activitySpinner,
        self.dissmissButton,
        finishButton
      ],
      title: self.__('Create new HomeKit instance'),
      dialogClass: 'modal-info'
    })
    self.dialog.setBody(content)
  }
}

export class EditHapInstanceWizzard extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    this.status = new Label()

    self.finishButton = new Button('success', self.__('Finish'), async (e, btn) => {
      if ((self.hapInstanceData.displayName !== undefined) && (self.hapInstanceData.displayName.length > 0)) {
        self.status.setLabel(self.__('Updating instance ...'))
        self.finishButton.setActive(false)
        self.activitySpinner.setActive(true)
        self.dissmissButton.setActive(false)
        await self.application.makeApiRequest(self.hapInstanceData)
        setTimeout(() => {
          self.application.refreshBridges()
          self.dialog.close()
        }, 2000)
      } else {
        self.status.setLabel(self.__('Please fill the name'))
      }
    }, true)

    self.resetButton = new Button('danger', self.__('Reset Instance'), async (b, btn) => {
      const rd = new ResetInstanceDialog(self.application)
      rd.run(self.hapInstance)
      self.dialog.close()
    })

    self.dialog = new Dialog({
      dialogId: 'editHAP',
      buttons: [
        self.resetButton,
        self.status,
        self.activitySpinner,
        self.dissmissButton,
        self.finishButton
      ],
      title: self.__('Edit Homekit instance'),
      dialogClass: 'modal-info',
      scrollable: false,
      size: 'modal-xl'
    })
  }

  run (hapInstance) {
    const self = this
    this.hapInstance = hapInstance

    const content = $('<div>').append(self.__('Edit HAP Instance'))
    content.append('<br /><br />')
    const grid = new Grid('editHAP', { rowStyle: 'margin-bottom:15px' })

    let name = hapInstance.displayName
    if (name.indexOf('HomeMatic ') === 0) {
      name = name.replace('HomeMatic ', '')
    }
    this.hapInstanceData = { method: 'editinstance', publish: true, uuid: hapInstance.id, displayName: name, roomId: hapInstance.roomId }

    const inputName = new Input('instancedisplayName', this.hapInstanceData.displayName, (e, input) => {
      self.hapInstanceData.displayName = input.value
      if (input.value.length > 0) {
        self.finishButton.setActive(true)
      } else {
        self.finishButton.setActive(false)
      }
    })
    inputName.setGroupLabel('HomeMatic  ')
    let row = grid.addRow('instRow')
    row.addCell({ sm: 12, md: 3, lg: 3 }, this.__('Homekit instance name:'))
    row.addCell({ sm: 12, md: 9, lg: 9 }, inputName.render())

    row = grid.addRow('roomRow')
    const ccuRoomList = this.application.getRooms()
    const oRoomList = new Dropdown('newInstanceRoom', this.__('Select a room'))
    ccuRoomList.forEach(room => {
      if (room.id === self.hapInstanceData.roomId) {
        oRoomList.setTitle(room.name)
      }

      oRoomList.addItem({
        title: room.name,
        value: room.id,
        onClick: async (e, btn) => {
          self.hapInstanceData.roomId = parseInt(btn)
        }
      })
    })

    row.addCell({ sm: 12, md: 3, lg: 3 }, this.__('HomeMatic assigned room:'))
    row.addCell({ sm: 12, md: 9, lg: 9 }, oRoomList.render())

    content.append(grid.render())
    this.dialog.setBody(content)
    this.dialog.open()
  }
}

export class DeactivateInstanceWizzard extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    this.status = new Label()

    self.finishButton = new Button('success', self.__('Deactivate'), async (e, btn) => {
      self.status.setLabel(self.__('Deactivating instance ...'))
      self.finishButton.setActive(false)
      self.activitySpinner.setActive(true)
      self.dissmissButton.setActive(false)
      await self.application.makeApiRequest(self.hapInstanceData)
      setTimeout(() => {
        self.application.refreshBridges()
        self.dialog.close()
      }, 2000)
    }, true)

    self.dialog = new Dialog({
      dialogId: 'deactivateHAP',
      buttons: [
        self.status,
        self.activitySpinner,
        self.dissmissButton,
        self.finishButton
      ],
      title: self.__('Deactivate Homekit instance'),
      dialogClass: 'modal-info',
      scrollable: false
    })
  }

  run (hapInstance) {
    const self = this

    const content = $('<div>').append(self.__('Deactivate Homekit instance'))
    content.append('<br /><br />')

    const name = hapInstance.displayName
    this.hapInstanceData = { method: 'deactivateInstance', uuid: hapInstance.id }
    content.append(self.__('If you deactivate a instance all devices in this instance will be removed from Homekit.'))
    content.append('<br />')
    content.append(self.__('The devices will stay in your configuration so they will appear again in Homekit when you activate the instance again.'))
    content.append(self.__('Use this feature to move a instance to another home without the need to assing all devices to a new room.'))
    content.append(self.__('To do this deactivate the instance, remove it from homekit, add it to a new Home, assign a room and activate the instance again.'))
    content.append('<br />')
    content.append(self.__('To activate the instance again just set the checkmark in Publishing settings.'))
    content.append('<br /><br />')
    content.append(self.__('To you want to deactivate %s', name))

    this.dialog.setBody(content)
    this.dialog.open()
  }
}

export class AbstractEditObjectWizzard extends Wizzard {
  async buildObjectSettingsUI () {
    this.grid.resetRows()
    let row = this.grid.addRow('objName')
    const self = this
    const inputName = new Input('objNameInHomeKit', this.objectData.name, (e, input) => {
      self.objectData.name = input.value
      if (input.value.length > 0) {
        self.finishButton.setActive(true)
      } else {
        self.finishButton.setActive(false)
      }
    })
    inputName.setGroupLabel(self.__('HomeKit name:'))
    row.addCell({ sm: 12, md: 3, lg: 3 }, this.__('HomeKit name:'))
    row.addCell({ sm: 12, md: 9, lg: 9 }, inputName.render())

    if (self.objectData.settings === undefined) {
      self.objectData.settings = {}
    }

    if (this.services) {
      const serviceList = new Dropdown('newObjectServiceList', self.__('Select a service'))
      self.services.forEach(service => {
        if (service.serviceClazz === self.objectData.serviceClass) {
          serviceList.setTitle(service.serviceClazz)
          self.objectData.template = service.settings
        }
        serviceList.addItem({
          title: service.serviceClazz,
          value: service.serviceClazz,
          onClick: async (e, btn) => {
            self.objectData.serviceClass = btn
            self.objectData.template = service.settings
            await self.buildObjectSettingsUI()
            self.grid.render()
          }
        })
      })

      row = this.grid.addRow('objService')
      row.addCell({ sm: 12, md: 3 }, this.__('Service'))
      row.addCell({ sm: 12, md: 9 }, serviceList.render())
    }

    const hapList = new Dropdown('newObjectHapList', self.__('Select a instance'))
    self.application.getBridges().forEach(bridge => {
      if (bridge.id === self.objectData.instanceID) {
        hapList.setTitle(bridge.displayName)
      }
      hapList.addItem({
        title: bridge.displayName,
        value: bridge.id,
        onClick: (e, btn) => {
          self.objectData.instanceID = btn
        }
      })
    })

    row = this.grid.addRow('objInstance')
    row.addCell({ sm: 12, md: 3 }, this.__('Instance'))
    row.addCell({ sm: 12, md: 9 }, hapList.render())

    if (this.objectData.template) {
      Object.keys(this.objectData.template).forEach(settingsKey => {
        const template = self.objectData.template[settingsKey]
        const settings = self.objectData.settings[settingsKey]
        let control
        switch (template.type) {
          case 'option':
            // the stored value stays the (English) option, the list shows its translation
            control = new Dropdown(settingsKey, self.__(settings || template.default))
            template.array.forEach(item => {
              control.addItem({
                title: self.__(item),
                value: item,
                onClick: (e, btn) => {
                  self.objectData.settings[settingsKey] = btn
                }
              })
            })
            break

          case 'number':
            control = new Input(settingsKey, parseInt(settings) || parseInt(template.default), (e, input) => {
              self.objectData.settings[settingsKey] = parseInt(input.value)
            })
            break

          case 'text':
            control = new Input(settingsKey, settings || template.default, (e, input) => {
              self.objectData.settings[settingsKey] = input.value
            })
            break

          case 'checkbox':
            control = new CheckBox(settingsKey, true, (e, input) => {
              self.objectData.settings[settingsKey] = input.checked
            })
            // a stored false stays false, the default only applies when nothing is stored
            control.setValue((settings !== undefined) ? settings : template.default)
            break

          default:
            break
        }
        if ((!self.objectData.settings[settingsKey]) && (template.default)) {
          self.objectData.settings[settingsKey] = template.default
        }
        row = self.grid.addRow('st_' + settingsKey)
        row.addCell({ sm: 12, md: 3, lg: 3 }, self.__(template.label || ''))
        row.addCell({ sm: 12, md: 4, lg: 4 }, (control) ? control.render() : '')
        row.addCell({ sm: 12, md: 5, lg: 5 }, self.__(template.hint || ''))
      })
    }
  }
}

export class EditObjectWizzard extends AbstractEditObjectWizzard {
  constructor (application, dialogTitle) {
    super(application)
    const self = this
    this.status = new Label()
    this.dialogTitle = dialogTitle

    self.finishButton = new Button('success', self.__('Finish'), async (e, btn) => {
      if ((self.objectData.name !== undefined) && (self.objectData.name.length > 0)) {
        self.status.setLabel(self.__('Updating object ...'))
        self.finishButton.setActive(false)
        self.activitySpinner.setActive(true)
        self.dissmissButton.setActive(false)
        if (self.willSave) {
          self.willSave(self)
        }
        await self.application.makeApiRequest(self.objectData)
        setTimeout(() => {
          if (self.onClose) {
            self.onClose(self)
          }
          self.dialog.close()
        }, 2000)
      } else {
        self.status.setLabel(self.__('Please fill the name'))
      }
    }, true)

    self.dialog = new Dialog({
      dialogId: 'editObject',
      buttons: [
        self.status,
        self.activitySpinner,
        self.dissmissButton,
        self.finishButton
      ],
      title: self.dialogTitle,
      dialogClass: 'modal-info',
      scrollable: false
    })
  }

  onClose (callback) {
    this.onClose = callback
  }

  willSave (callback) {
    this.willSave = callback
  }

  setServices (services) {
    this.services = services
  }

  run (object) {
    const self = this

    const content = $('<div>').append(self.dialogTitle)
    content.append('<br /><br />')

    this.grid = new Grid('editObjectGrid', { rowStyle: 'margin-bottom:15px' })
    this.objectData = {
      serial: object.nameInCCU,
      name: object.name,
      serviceClass: object.serviceClass,
      instanceID: object.instanceID,
      settings: object.settings.settings // this will blow my mind
    }
    super.buildObjectSettingsUI()
    content.append(this.grid.render())
    this.dialog.setBody(content)
    this.dialog.open()
  }
}

export class NewObjectWizzard extends AbstractEditObjectWizzard {
  constructor (application, dialogTitle, propertyTitle) {
    super(application)
    const self = this
    this.objectData = {}
    this.status = new Label()
    this.dialogTitle = dialogTitle
    this.propertyTitle = propertyTitle

    self.finishButton = new Button('success', self.__('Finish'), async (e, btn) => {
      if (self.objectData.instanceID === undefined) {
        self.status.setLabel(self.__('Please choose a HAP instance'))
      } else {
        self.finishButton.setActive(false)
        self.activitySpinner.setActive(true)
        self.dissmissButton.setActive(false)

        if (self.willSave) {
          self.willSave(self)
        }

        await self.application.makeApiRequest(self.objectData)
        setTimeout(() => {
          if (self.onClose) {
            self.onClose(self)
          }
          self.dialog.close()
        }, 2000)
      }
    }, false)

    self.dialog = new Dialog({
      dialogId: 'addNewObject',
      buttons: [
        self.status,
        self.activitySpinner,
        self.dissmissButton,
        self.finishButton
      ],
      title: self.dialogTitle,
      dialogClass: 'modal-info',
      scrollable: false,
      size: 'modal-xl'
    })
  }

  onClose (callback) {
    this.onClose = callback
  }

  willSave (callback) {
    this.willSave = callback
  }

  checkObjectIsMapped (callback) {
    this.objectIsMappedCheck = callback
  }

  setListTitles (titles) {
    this.listTitles = titles
  }

  setServices (services) {
    this.services = services
  }

  showObjectSettings (object, title) {
    const content = $('<div>').append(title)
    content.append('<br /><br />')

    this.grid = new Grid('editVariableGrid', { rowStyle: 'margin-bottom:15px' })

    this.objectData = {
      method: 'saveVariable',
      serial: object.name,
      name: object.name,
      instanceID: object.instanceID,
      serviceClass: object.serviceClass
    }
    super.buildObjectSettingsUI()
    content.append(this.grid.render())
    this.finishButton.setActive(true)
    this.dialog.setBody(content)
  }

  run (objectList) {
    const self = this
    const content = $('<div>').append(self.dialogTitle)
    content.append('<br /><br />')
    const grid = new DatabaseGrid('newObjectSelector', objectList, { maxPages: 4 })

    grid.addSearchBar(self.__('Search'), self.__('Clear'), (element, filter) => {
      if (element) {
        return (((element.name) && (element.name.toLowerCase().indexOf(filter.toLowerCase()) > -1)) ||
          ((element.dpInfo) && (element.dpInfo.toLowerCase().indexOf(filter.toLowerCase()) > -1)))
      } else {
        return false
      }
    })

    grid.setTitleLabels(this.listTitles)

    grid.setColumns([
      { sz: { sm: 6, md: 5, lg: 5 }, sort: 0 },
      { sz: { sm: 6, md: 5, lg: 5 }, sort: 1 },
      { sz: { sm: 6, md: 2, lg: 2 } }
    ])

    grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return a.name.localeCompare(b.name)
        case 1:
          return a.dpInfo.localeCompare(b.dpInfo)
        default:
          return true
      }
    }
    grid.columnSort = 0

    grid.setRenderer((row, item) => {
      let selectButton
      if (self.objectIsMappedCheck(item)) {
        selectButton = new Button('secondary', self.__('allready here'), (e, btn) => { })
      } else {
        selectButton = new Button('info', self.__('Select'), (e, btn) => {
          self.showObjectSettings(item)
        })
      }
      selectButton.setStyle('width:100%')
      return ([item.name, item.dpInfo, selectButton.render()])
    })

    content.append(grid.render())
    this.dialog.setBody(content)
    this.dialog.open()
  }
}

export class ChannelWizzard extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    this.mode = 1
    this.status = new Label()

    this.backButton = new Button('light', self.__('Back'), (e, btn) => {
      if (self.mode === 2) {
        self.showDeviceList()
      }
      if (self.mode === 3) {
        self.showChannelList()
      }
    }, true)

    this.content = $('<div>')

    this.grid = new DatabaseGrid('_objectSelector', undefined, { maxPages: 4 })

    this.grid.addSearchBar(self.__('Search'), self.__('Clear'), (element, filter) => {
      if (element) {
        return ((element.name) && (element.name.toLowerCase().indexOf(filter.toLowerCase()) > -1))
      } else {
        return false
      }
    })

    this.dialog = new Dialog({
      dialogId: 'dpsearch',
      buttons: [
        self.status,
        self.backButton,
        self.dissmissButton
      ],
      title: self.__('Select a datapoint'),
      dialogClass: 'modal-success'
    })
  }

  async showDeviceList () {
    const self = this
    this.grid.setTitleLabels(['Device', ''])
    // Filter DeviceList
    self.mode = 1
    const fDs = this.application.ccuDevices.filter((element) => {
      let result = false
      element.channels.forEach((channel) => {
        if (self.options.filterChannels.indexOf(channel.type) > -1) {
          result = true
        }
      })
      return result
    })

    this.grid.setDataset(fDs)

    this.grid.setColumns([
      { sz: { sm: 6, md: 8, lg: 8 }, sort: 0 },
      { sz: { sm: 6, md: 4, lg: 4 } }
    ])

    this.grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return a.name.localeCompare(b.name)
        case 1:
          return a.dpInfo.localeCompare(b.dpInfo)
        default:
          return true
      }
    }
    this.grid.columnSort = 0

    this.grid.setRenderer((row, item) => {
      const selectButton = new Button('info', self.__('Select'), (e, btn) => {
        self.selectedDevice = item
        self.mode = 2
        setTimeout(() => {
          self.showChannelList()
        }, 200)
      })
      selectButton.setStyle('width:100%')
      return ([item.name, selectButton.render()])
    })
    this.grid.refresh()
  }

  async showChannelList () {
    const self = this
    this.grid.resetSearch()
    this.grid.setTitleLabels(['Channel', ''])
    // Filter
    const fDC = this.selectedDevice.channels.filter((element) => {
      return (self.options.filterChannels.indexOf(element.type) > -1)
    })
    self.mode = 2

    this.grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return a.name.localeCompare(b.name)
        case 1:
          return a.dpInfo.localeCompare(b.dpInfo)
        default:
          return true
      }
    }
    this.grid.columnSort = 0
    this.grid.setDataset(fDC)
    this.grid.setColumns([
      { sz: { sm: 6, md: 8, lg: 8 }, sort: 0 },
      { sz: { sm: 6, md: 4, lg: 4 } }
    ])
    this.grid.setRenderer((row, item) => {
      const selectButton = new Button('info', self.__('Select'), async (e, btn) => {
        self.selectedChannel = item
        self.channelSelectionCompleted()
      })
      selectButton.setStyle('width:100%')
      return ([item.name, selectButton.render()])
    })
    this.grid.refresh()
  }

  channelSelectionCompleted () {
    if (this.onSelect) {
      this.onSelect(this.selectedChannel)
      this.close()
    }
  }

  showDatapointList (dpList) {
    const self = this
    this.grid.resetSearch()
    this.grid.setTitleLabels(['DataPoint', ''])

    this.grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return a.localeCompare(b)
        default:
          return true
      }
    }

    this.grid.columnSort = 0

    this.grid.setDataset(dpList)
    this.grid.setColumns([
      { sz: { sm: 6, md: 8, lg: 8 }, sort: 0 },
      { sz: { sm: 6, md: 4, lg: 4 } }
    ])

    this.grid.setRenderer((row, item) => {
      const selectButton = new Button('info', self.__('Select'), async (e, btn) => {
        if (self.onSelect) {
          self.onSelect(item)
          self.close()
        }
      })
      selectButton.setStyle('width:100%')
      return ([item, selectButton.render()])
    })
    this.grid.refresh()
  }

  run (options) {
    this.options = options
    this.content.empty()
    this.content.append(this.grid.render())
    this.showDeviceList()
    this.dialog.setBody(this.content)
    this.dialog.open()
  }
}

export class DatepointWizzard extends ChannelWizzard {
  constructor (application) {
    super(application)
    const self = this
    this.mode = 1
    this.status = new Label()

    this.backButton = new Button('light', self.__('Back'), (e, btn) => {
      if (self.mode === 2) {
        self.showDeviceList()
      }
      if (self.mode === 3) {
        self.showChannelList()
      }
    }, true)

    this.content = $('<div>')

    this.grid = new DatabaseGrid('_objectSelector', undefined, { maxPages: 4 })

    this.grid.addSearchBar(self.__('Search'), self.__('Clear'), (element, filter) => {
      if (element) {
        return ((element.name) && (element.name.toLowerCase().indexOf(filter.toLowerCase()) > -1))
      } else {
        return false
      }
    })

    this.dialog = new Dialog({
      dialogId: 'dpsearch',
      buttons: [
        self.status,
        self.backButton,
        self.dissmissButton
      ],
      title: self.__('Select a datapoint'),
      dialogClass: 'modal-success'
    })
  }

  async channelSelectionCompleted () {
    this.mode = 3
    const item = this.selectedChannel
    const dps = await this.application.makeApiRequest({ method: 'ccuGetDatapoints', cid: item.id })
    if (dps.datapoints) {
      const result = []
      dps.datapoints.forEach((dp) => {
        result.push({ name: dp })
      })
      this.showDatapointList(result)
    }
  }

  showDatapointList (dpList) {
    const self = this
    this.grid.resetSearch()
    this.grid.setTitleLabels(['DataPoint', ''])

    this.grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return a.name.localeCompare(b.name)
        default:
          return true
      }
    }

    this.grid.columnSort = 0

    this.grid.setDataset(dpList)
    this.grid.setColumns([
      { sz: { sm: 6, md: 8, lg: 8 }, sort: 0 },
      { sz: { sm: 6, md: 4, lg: 4 } }
    ])

    this.grid.setRenderer((row, item) => {
      const selectButton = new Button('info', self.__('Select'), async (e, btn) => {
        if (self.onSelect) {
          self.onSelect(item.name)
          self.close()
        }
      })
      selectButton.setStyle('width:100%')
      return ([item.name, selectButton.render()])
    })
    this.grid.refresh()
  }
}

export class LostDevicesWizzard extends Wizzard {
  constructor (application) {
    super(application)
    const self = this
    this.mode = 1
    this.status = new Label()

    this.content = $('<div>')

    this.grid = new DatabaseGrid('_lostDevicesSelector', undefined, { maxPages: 4 })

    this.dialog = new Dialog({
      dialogId: 'lostDevicesDialog',
      buttons: [
        self.status,
        self.dissmissButton
      ],
      title: self.__('Deleted devices'),
      dialogClass: 'modal-success'
    })
  }

  showList (lostList) {
    const self = this
    this.grid.setTitleLabels(['Name', ''])

    this.grid.sortCallback = (column, a, b) => {
      switch (column) {
        case 0:
          return a.name.localeCompare(b.name)
        default:
          return true
      }
    }

    this.grid.columnSort = 0

    this.grid.setDataset(lostList)
    this.grid.setColumns([
      { sz: { sm: 6, md: 8, lg: 8 }, sort: 0 },
      { sz: { sm: 6, md: 4, lg: 4 } }
    ])

    this.grid.setRenderer((row, item) => {
      const selectButton = new Button('danger', self.__('Delete'), async (e, btn) => {
        await self.application.makeApiRequest({ method: 'removeDeletedDevice', address: item.address })
        self.dialog.close()
        self.application.checkLostAndFound()
      })
      selectButton.setStyle('width:100%')
      return ([item.name, selectButton.render()])
    })
    this.grid.refresh()
  }

  run (lostList) {
    this.content.empty()
    const lbl = new Label(this.__('Looks like you have deleted some devices from your ccu recently. Do you want to remove these also from Homekit ?'))
    this.content.append(lbl.render())
    this.content.append(this.grid.render())
    this.showList(lostList)
    this.dialog.setBody(this.content)
    this.dialog.open()
  }
}
