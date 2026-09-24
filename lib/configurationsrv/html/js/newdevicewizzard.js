/*
 * File: newdevicewizzard.js
 * Project: homekit-ccu
 * -----
 * The MIT License (MIT)
 * ==========================================================================
 */

/*
 * The "new device" dialog in two steps:
 * 1. choose: the CCU devices with their channels, filtered by text, room and state; ticking a
 *    device ticks its useful channels (newdevicemodel.js preselectedEntries)
 * 2. set up: name, HomeKit service, its choice settings and the bridge per chosen row; all rows
 *    are saved at once (api method saveNewDevices)
 */

import { Dialog, Button, Label, Spinner } from './ui.js'
import { Wizzard } from './wizzards.js'
import {
  CATEGORIES, REMOTE_SERVICE, SYSTEMS, buildEntries, channelNumbers, deviceState, hasDefaultName, isMapped, isPerKeyChoice,
  mappingsFor, preselectedEntries, serviceLabel, suggestNames, visibleEntries
} from './newdevicemodel.js'

const text = (value) => $('<span>').text(String(value === undefined ? '' : value))

// the symbol of a device without a CCU picture, by category (Bootstrap Icons)
const CATEGORY_ICONS = {
  light: 'bi-lightbulb',
  switch: 'bi-toggle-on',
  cover: 'bi-window-split',
  climate: 'bi-thermometer-half',
  security: 'bi-shield-lock',
  sensor: 'bi-broadcast',
  button: 'bi-grid-3x2-gap',
  water: 'bi-droplet',
  other: 'bi-cpu'
}

const CATEGORY_LABELS = {
  light: 'Lights',
  switch: 'Switches and outlets',
  cover: 'Blinds, windows and doors',
  climate: 'Heating and climate',
  security: 'Security and locks',
  sensor: 'Sensors',
  button: 'Buttons and remotes',
  water: 'Water',
  other: 'Other'
}

const EMPTY_FILTER = { text: '', room: '', func: '', category: '', system: '', showMapped: false, showSecondary: false, showVirtualKeys: false }

export class NewDeviceWizzard extends Wizzard {
  constructor (application) {
    super(application)
    this.selected = new Set()
    this.expanded = new Set()
    this.filter = { ...EMPTY_FILTER }
    this.choices = {}

    this.status = new Label()
    this.spinner = new Spinner()
    this.backButton = new Button('light', this.__('Back'), () => this.showSelection(), true)
    this.nextButton = new Button('primary', this.__('Next'), () => this.showSetup(), false)
    this.finishButton = new Button('success', this.__('Add to HomeKit'), () => this.save(), true)

    this.dialog = new Dialog({
      dialogId: 'addNew',
      buttons: [this.status, this.spinner, this.dissmissButton, this.backButton, this.nextButton, this.finishButton],
      title: this.__('Add new device'),
      dialogClass: 'modal-info',
      scrollable: true,
      size: 'modal-xl'
    })
  }

  /** catalog: the devices of api method newDevice, iconBase: the host serving the CCU pictures ('' for this one) */
  run (catalog, iconBase = '') {
    this.devices = (catalog || []).map(device => ({ device, entries: buildEntries(device) }))
    this.iconBase = iconBase
    const values = (key) => [...new Set(this.devices.flatMap(item => item.device[key] || []))].sort((a, b) => a.localeCompare(b))
    this.rooms = values('rooms')
    this.functions = values('functions')
    this.categories = CATEGORIES.filter(category => this.devices.some(item => item.device.category === category))
    this.systems = SYSTEMS.filter(system => this.devices.some(item => item.device.system === system))
    this.hasVirtualKeys = this.devices.some(item => item.device.virtualKeys === true)
    this.showSelection()
    this.dialog.open()
  }

  entryById (id) {
    for (const item of this.devices) {
      const entry = item.entries.find(candidate => candidate.id === id)
      if (entry) return entry
    }
    return undefined
  }

  setStep (step) {
    this.step = step
    this.backButton.render().toggleClass('d-none', step !== 'setup')
    this.finishButton.render().toggleClass('d-none', step !== 'setup')
    this.nextButton.render().toggleClass('d-none', step !== 'select')
    this.status.setLabel('')
  }

  // ---- step 1: choose devices and channels ----

  showSelection () {
    this.setStep('select')
    const content = $('<div>').addClass('nd')
    content.append($('<p>').addClass('text-body-secondary').text(this.__('Choose the devices and channels you want to use in Apple Home. Ticking a device selects its useful channels.')))
    content.append(this.renderToolbar())
    this.list = $('<div>').addClass('nd-list')
    content.append(this.list)
    this.dialog.setBody(content)
    this.renderList()
  }

  renderToolbar () {
    const toolbar = $('<div>').addClass('nd-toolbar mb-3')
    const search = $('<input>').attr({ type: 'search', id: 'nd_search', placeholder: this.__('Search device, channel, room or serial') })
      .addClass('form-control').val(this.filter.text)
      .on('input', () => {
        this.filter.text = search.val()
        this.renderList()
      })
    toolbar.append($('<div>').addClass('input-group mb-2')
      .append($('<span>').addClass('input-group-text').append($('<i>').addClass('bi bi-search').attr('aria-hidden', 'true')))
      .append(search))

    const choices = $('<div>').addClass('row g-2 mb-2')
    const choice = (id, key, allLabel, options) => {
      const select = $('<select>').attr({ id, 'aria-label': allLabel }).addClass('form-select form-select-sm')
      select.append($('<option>').val('').text(allLabel))
      options.forEach(([value, label]) => select.append($('<option>').val(value).text(label)))
      select.val(this.filter[key]).on('change', () => {
        this.filter[key] = select.val()
        this.renderList()
      })
      choices.append($('<div>').addClass('col-6 col-md-3').append(select))
    }
    choice('nd_room', 'room', this.__('All rooms'), this.rooms.map(name => [name, name]))
    if (this.functions.length > 0) {
      choice('nd_function', 'func', this.__('All functions'), this.functions.map(name => [name, name]))
    }
    choice('nd_category', 'category', this.__('All kinds'), this.categories.map(category => [category, this.__(CATEGORY_LABELS[category])]))
    choice('nd_system', 'system', this.__('All radio systems'), this.systems.map(system => [system, (system === 'other') ? this.__('Other') : system]))
    toolbar.append(choices)

    const switches = $('<div>').addClass('d-flex flex-wrap align-items-center column-gap-3 row-gap-1')
    switches.append(this.renderSwitch('nd_showMapped', this.__('Show devices already in HomeKit'), 'showMapped'))
    switches.append(this.renderSwitch('nd_showSecondary', this.__('Show additional channels'), 'showSecondary'))
    if (this.hasVirtualKeys) {
      switches.append(this.renderSwitch('nd_showVirtualKeys', this.__('Show virtual CCU keys (HM-RCV-50, HmIP-RCV-50)'), 'showVirtualKeys'))
    }
    this.count = $('<span>').addClass('small text-body-secondary')
    const reset = $('<button>').attr('type', 'button').addClass('btn btn-link btn-sm p-0').text(this.__('Reset filter'))
      .on('click', () => {
        this.filter = { ...EMPTY_FILTER }
        this.showSelection()
      })
    switches.append($('<span>').addClass('ms-auto d-inline-flex align-items-center gap-3').append(this.count).append(reset))
    toolbar.append(switches)
    return toolbar
  }

  renderIcon (device) {
    const box = $('<span>').addClass('nd-icon flex-shrink-0').attr('aria-hidden', 'true')
    const symbol = () => $('<i>').addClass('bi ' + (CATEGORY_ICONS[device.category] || CATEGORY_ICONS.other))
    if (device.icon) {
      const picture = $('<img>').attr({ src: this.iconBase + device.icon, alt: '', loading: 'lazy' })
        .on('error', () => box.removeClass('nd-icon-picture').empty().append(symbol()))
      box.addClass('nd-icon-picture').append(picture)
    } else {
      box.append(symbol())
    }
    return box
  }

  renderSwitch (id, label, key) {
    const input = $('<input>').attr({ type: 'checkbox', role: 'switch', id }).addClass('form-check-input')
      .prop('checked', this.filter[key] === true)
      .on('change', () => {
        this.filter[key] = input.prop('checked')
        this.renderList()
      })
    return $('<div>').addClass('form-check form-switch mb-0').append(input)
      .append($('<label>').addClass('form-check-label small').attr('for', id).text(label))
  }

  renderList () {
    this.list.empty()
    let shownDevices = 0
    this.devices.forEach(item => {
      const shown = visibleEntries(item.device, item.entries, this.filter)
      if (shown.length > 0) {
        shownDevices += 1
        this.list.append(this.renderDevice(item, shown))
      }
    })
    if (shownDevices === 0) {
      this.list.append($('<div>').addClass('text-body-secondary text-center py-4').text(this.__('No device matches the filter.')))
    }
    this.count.html(this.__('%s of %s devices', shownDevices, this.devices.length))
    this.updateSelectionState()
  }

  renderDevice (item, shown) {
    const { device, entries } = item
    const state = deviceState(entries)
    const free = entries.filter(entry => !isMapped(entry))
    const chosen = free.filter(entry => this.selected.has(entry.id))
    // a search that matches only some channels opens the device
    const isOpen = this.expanded.has(device.address) || ((this.filter.text !== '') && (shown.length < entries.length))

    const box = $('<div>').addClass('nd-device border rounded mb-2')
    const head = $('<div>').addClass('nd-device-head d-flex align-items-center gap-2 px-2 py-2')

    const check = $('<input>').attr({ type: 'checkbox', 'aria-label': device.name }).addClass('form-check-input m-0 flex-shrink-0')
      .prop('checked', (free.length > 0) && (chosen.length === free.length))
      .prop('indeterminate', (chosen.length > 0) && (chosen.length < free.length))
      .prop('disabled', free.length === 0)
      .on('click', (e) => {
        e.stopPropagation()
        if (chosen.length > 0) {
          free.forEach(entry => this.selected.delete(entry.id))
        } else {
          preselectedEntries(entries).forEach(entry => this.selected.add(entry.id))
          this.expanded.add(device.address)
        }
        this.renderList()
      })
    head.append(check)

    const toggle = $('<button>').attr({ type: 'button', 'aria-expanded': String(isOpen), 'aria-label': this.__('Show channels') })
      .addClass('btn btn-sm nd-toggle flex-shrink-0').append($('<span>').addClass('nd-chevron').text(isOpen ? '▾' : '▸'))
    head.append(toggle)
    head.append(this.renderIcon(device))

    const title = $('<div>').addClass('flex-grow-1 min-w-0')
    title.append($('<div>').addClass('fw-semibold text-truncate').text(device.name))
    const details = [device.type].concat(device.rooms || []).concat(device.functions || []).concat([device.address])
    title.append($('<div>').addClass('small text-body-secondary text-truncate').text(details.join(' · ')))
    head.append(title)

    if (state.mapped > 0) {
      const label = (state.free === 0) ? this.__('in HomeKit') : this.__('%s of %s in HomeKit', state.mapped, state.total)
      head.append($('<span>').addClass('badge rounded-pill text-bg-success flex-shrink-0').html(label))
    }
    if (chosen.length > 0) {
      head.append($('<span>').addClass('badge rounded-pill text-bg-primary flex-shrink-0').html(this.__('%s selected', chosen.length)))
    }

    head.on('click', () => {
      if (this.expanded.has(device.address)) {
        this.expanded.delete(device.address)
      } else {
        this.expanded.add(device.address)
      }
      this.renderList()
    })
    box.append(head)

    if (isOpen) {
      const body = $('<div>').addClass('nd-channels border-top py-1')
      shown.forEach(entry => body.append(this.renderEntry(entry)))
      const hidden = entries.filter(entry => entry.secondary && !isMapped(entry) && !shown.includes(entry)).length
      if ((hidden > 0) && (this.filter.showSecondary !== true)) {
        body.append($('<div>').addClass('nd-hint small text-body-secondary').html(this.__('%s additional channels hidden (second and third virtual channel of an output)', hidden)))
      }
      box.append(body)
    }
    return box
  }

  renderEntry (entry) {
    const mapped = isMapped(entry)
    const id = 'nd_' + entry.id.replace(/[^A-Za-z0-9]/g, '_')
    const row = $('<div>').addClass('nd-channel d-flex align-items-center gap-2 px-2 py-1')
    const check = $('<input>').attr({ type: 'checkbox', id }).addClass('form-check-input m-0 flex-shrink-0')
      .prop('checked', mapped || this.selected.has(entry.id))
      .prop('disabled', mapped)
      .on('change', () => {
        if (check.prop('checked')) {
          this.selected.add(entry.id)
        } else {
          this.selected.delete(entry.id)
        }
        this.renderList()
      })
    row.append(check)

    const label = $('<label>').attr('for', id).addClass('d-flex align-items-center gap-2 flex-grow-1 min-w-0 mb-0')
    label.append($('<span>').addClass('nd-chnum badge text-bg-secondary flex-shrink-0').text(channelNumbers(entry)))
    const name = $('<span>').addClass('text-truncate')
    const single = entry.channels.length === 1
    if (entry.kind === 'keys') {
      name.text(single ? this.__('Key') : this.__('Keys') + ' (' + entry.channels.length + ')')
    } else if (hasDefaultName(entry.device, entry.channels[0])) {
      // the CCU default name only repeats type and serial
      name.addClass('text-body-secondary').text(this.__('Channel') + ' ' + channelNumbers(entry))
    } else {
      name.text(entry.channels[0].name)
    }
    label.append(name)
    const remote = single ? this.__('Remote with one button') : this.__('Remote with %s buttons', entry.channels.length)
    const kind = (entry.kind === 'keys') ? remote : serviceLabel(entry.services[0].serviceClazz)
    label.append($('<span>').addClass('small text-body-secondary text-truncate d-none d-sm-inline').html('→ ' + kind))
    row.append(label)

    if (entry.secondary) {
      row.append($('<span>').addClass('badge text-bg-light border flex-shrink-0').text(this.__('additional channel')))
    }
    if (entry.mapping) {
      row.append($('<span>').addClass('badge rounded-pill text-bg-success flex-shrink-0 text-truncate nd-mapped').attr('title', entry.mapping.name).append(text(entry.mapping.name)))
    } else if (entry.coveredBy) {
      row.append($('<span>').addClass('badge rounded-pill text-bg-success flex-shrink-0').text(this.__('button of the remote')))
    }
    return row
  }

  updateSelectionState () {
    const count = this.selected.size
    this.nextButton.setActive(count > 0)
    this.status.setLabel((count > 0) ? $('<span>').addClass('small').html(this.__('%s selected', count)) : '')
  }

  // ---- step 2: set up the chosen rows ----

  chosenByDevice () {
    return this.devices
      .map(item => ({ device: item.device, entries: item.entries.filter(entry => this.selected.has(entry.id)) }))
      .filter(item => item.entries.length > 0)
  }

  defaultBridge (entry) {
    const bridges = this.application.getBridges()
    const predicted = this.application.getPredictedHapInstanceForChannel(entry.channels[0])
    return predicted ? predicted.id : (bridges[0] ? bridges[0].id : undefined)
  }

  choiceFor (entry, suggestedName) {
    if (!this.choices[entry.id]) {
      const service = entry.services[0]
      this.choices[entry.id] = { name: suggestedName, service: service.serviceClazz, settings: this.defaultSettings(service), bridge: this.defaultBridge(entry) }
    }
    return this.choices[entry.id]
  }

  defaultSettings (service) {
    const settings = {}
    ;(service.options || []).forEach(option => { settings[option.key] = option.default })
    return settings
  }

  showSetup () {
    this.setStep('setup')
    const content = $('<div>').addClass('nd')
    content.append($('<p>').addClass('text-body-secondary').text(this.__('Check the names and how the devices appear in Apple Home. Further settings are in the device list under Edit.')))
    const bridges = this.application.getBridges()
    this.chosenByDevice().forEach(({ device, entries }) => {
      const names = suggestNames(device, entries)
      const box = $('<div>').addClass('nd-device border rounded mb-2')
      const head = $('<div>').addClass('px-3 py-2 border-bottom')
      head.append($('<div>').addClass('fw-semibold').text(device.name))
      head.append($('<div>').addClass('small text-body-secondary').text([device.type].concat(device.rooms || []).join(' · ')))
      box.append(head)
      entries.forEach(entry => box.append(this.renderSetupRow(entry, this.choiceFor(entry, names[entry.id]), bridges)))
      content.append(box)
    })
    this.dialog.setBody(content)
  }

  renderSetupRow (entry, choice, bridges) {
    const row = $('<div>').addClass('nd-setup row g-2 align-items-end px-3 py-2')
    const uid = entry.id.replace(/[^A-Za-z0-9]/g, '_')
    const single = entry.channels.length === 1
    const channelLabel = ((entry.kind === 'keys') ? (single ? this.__('Key') : this.__('Keys')) : this.__('Channel')) + ' ' + channelNumbers(entry)

    const nameInput = $('<input>').attr({ type: 'text', id: 'nd_name_' + uid }).addClass('form-control').val(choice.name)
      .on('input', () => { choice.name = nameInput.val() })
    row.append(this.field('col-12 col-md-4', 'nd_name_' + uid, channelLabel, nameInput))

    const service = $('<select>').attr({ id: 'nd_service_' + uid }).addClass('form-select')
    entry.services.forEach(item => {
      let label = serviceLabel(item.serviceClazz)
      if (entry.kind === 'keys') {
        if (item.serviceClazz === REMOTE_SERVICE) {
          label = single ? this.__('Remote with one button') : this.__('Remote: one device with %s buttons', entry.channels.length)
        } else if (!single) {
          label = this.__('%s: one device per key', label)
        }
      }
      service.append($('<option>').val(item.serviceClazz).text(label).attr('title', this.__(item.description)))
    })
    service.val(choice.service).on('change', () => {
      choice.service = service.val()
      choice.settings = this.defaultSettings(entry.services.find(item => item.serviceClazz === choice.service))
      row.replaceWith(this.renderSetupRow(entry, choice, bridges))
    })
    row.append(this.field('col-12 col-md-3', 'nd_service_' + uid, this.__('Appears in Apple Home as'), service))

    const current = entry.services.find(item => item.serviceClazz === choice.service) || entry.services[0]
    ;(current.options || []).forEach(option => {
      const select = $('<select>').attr({ id: 'nd_opt_' + uid + '_' + option.key }).addClass('form-select')
      option.values.forEach(value => select.append($('<option>').val(value).text(value)))
      select.val(choice.settings[option.key]).on('change', () => { choice.settings[option.key] = select.val() })
      row.append(this.field('col-6 col-md-2', 'nd_opt_' + uid + '_' + option.key, this.__(option.label || option.key), select))
    })

    if (bridges.length > 1) {
      const bridge = $('<select>').attr({ id: 'nd_bridge_' + uid }).addClass('form-select')
      bridges.forEach(item => bridge.append($('<option>').val(item.id).text(item.displayName)))
      bridge.val(choice.bridge).on('change', () => { choice.bridge = bridge.val() })
      row.append(this.field('col-6 col-md-3', 'nd_bridge_' + uid, this.__('HAP Instance'), bridge))
    }

    const description = $('<div>').addClass('col-12 small text-body-secondary nd-description').html(this.__(current.description))
    if (isPerKeyChoice(entry, choice.service) && (entry.channels.length > 1)) {
      description.append(' ').append($('<span>').html(this.__('Creates %s devices in Apple Home.', entry.channels.length)))
    }
    row.append(description)
    return row
  }

  field (colClass, id, label, control) {
    return $('<div>').addClass(colClass)
      .append($('<label>').addClass('form-label small mb-1').attr('for', id).text(label))
      .append(control)
  }

  async save () {
    const mappings = []
    let missing
    this.chosenByDevice().forEach(({ entries }) => entries.forEach(entry => {
      const choice = this.choices[entry.id]
      if ((!choice) || (String(choice.name).trim() === '') || (!choice.bridge)) {
        missing = missing || entry
        return
      }
      mappingsFor(entry, { ...choice, name: String(choice.name).trim() }).forEach(mapping => mappings.push(mapping))
    }))
    if (missing) {
      this.status.setLabel($('<span>').addClass('text-danger small').text(this.__('Every device needs a name and a HAP instance.')))
      return
    }
    this.finishButton.setActive(false)
    this.backButton.setActive(false)
    this.spinner.setActive(true)
    this.status.setLabel($('<span>').addClass('small').text(this.__('Creating device ...')))
    try {
      const result = await this.application.makeApiRequest({ method: 'saveNewDevices', devices: JSON.stringify(mappings) })
      if (!result || result.result !== 'saved') {
        throw new Error((result && result.reason) || 'error saving')
      }
      await this.application.publish()
      setTimeout(() => {
        this.application.refreshAll()
        this.dialog.close()
      }, 2000)
    } catch (e) {
      this.spinner.setActive(false)
      this.finishButton.setActive(true)
      this.backButton.setActive(true)
      this.status.setLabel($('<span>').addClass('text-danger small').html(this.__('Saving failed: %s', (e && (e.statusText || e.message)) || e)))
    }
  }
}
