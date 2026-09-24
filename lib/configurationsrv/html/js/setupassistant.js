/*
 * File: setupassistant.js
 * Project: homekit-ccu
 * -----
 * The MIT License (MIT)
 * ==========================================================================
 */

/*
 * The setup assistant: bridges and devices from the rooms and functions of the CCU.
 *
 * 1. layout: a bridge per room, per floor or one for everything, small rooms, a security bridge,
 *    the functions to take
 * 2. bridges and rooms: names of new bridges, the bridge of every room (or none), further floors
 * 3. devices: every device and channel can be chosen, named and set up like in "new device"
 * 4. preview, then api method applyAssistant creates everything; new bridges start without devices
 * 5. pairing: the QR code of every new bridge, Apple Home asks for its room; then the devices are
 *    published and land in the room of their bridge
 * The plan itself is assistantmodel.js.
 */

import { Dialog, Button, Label, Spinner } from './ui.js'
import { Wizzard } from './wizzards.js'
import { deviceIcon } from './newdevicewizzard.js'
import { channelNumbers, combinableEntries, combinedName, hasDefaultName, isMapped, isPerKeyChoice, preselectedEntries, REMOTE_SERVICE, serviceLabel } from './newdevicemodel.js'
import {
  NO_ROOM, MAX_ACCESSORIES, addBridge, bridgeDisplayName, bridgeOfDevice, buildApplyPayload, completeChoices,
  devicesByRoom, initialSelection, proposePlan, summarize, withEntries
} from './assistantmodel.js'

const STEPS = ['layout', 'bridges', 'devices', 'preview', 'pair']
const PAIRING_POLL_MS = 3000

export class SetupAssistant extends Wizzard {
  constructor (application) {
    super(application)
    this.layout = 'room'
    this.options = { mergeSmall: false, smallLimit: 2, security: false }
    this.functions = null
    this.showSecondary = false
    this.expanded = new Set()
    // devices whose switch outputs become one accessory
    this.combine = new Set()
    this.search = ''

    this.status = new Label()
    this.spinner = new Spinner()
    this.backButton = new Button('light', this.__('Back'), () => this.goBack(), true)
    this.nextButton = new Button('primary', this.__('Next'), () => this.goNext(), true)
    this.applyButton = new Button('success', this.__('Create bridges and devices'), () => this.apply(), true)
    this.publishButton = new Button('success', this.__('Publish devices'), () => this.publish(), true)
    this.doneButton = new Button('success', this.__('Close'), () => this.dialog.close(), true)

    this.dialog = new Dialog({
      dialogId: 'setupAssistant',
      buttons: [this.status, this.spinner, this.dissmissButton, this.backButton, this.nextButton, this.applyButton, this.publishButton, this.doneButton],
      title: this.__('Setup assistant'),
      dialogClass: 'modal-info',
      scrollable: true,
      size: 'modal-xl'
    })
    this.dialog.beforeClose = () => clearInterval(this.pollTimer)
  }

  async run () {
    this.dialog.setBody($('<div>').addClass('text-center py-5').append($('<div>').addClass('spinner-border')))
    this.showButtons([])
    this.dialog.open()
    const data = await this.application.makeApiRequest({ method: 'newDevice' })
    this.iconBase = data.iconBase || ''
    this.items = withEntries(data.devices)
    this.rooms = this.application.getRooms().map(room => ({ id: room.id, name: room.name }))
    this.allFunctions = [...new Set(this.items.flatMap(item => item.device.functions || []))].sort((a, b) => a.localeCompare(b))
    this.show('layout')
  }

  // ---- navigation ----

  show (step) {
    this.step = step
    this.status.setLabel('')
    const content = $('<div>').addClass('sa')
    content.append(this.renderSteps())
    const renderers = {
      layout: () => this.renderLayout(),
      bridges: () => this.renderBridges(),
      devices: () => this.renderDevices(),
      preview: () => this.renderPreview(),
      pair: () => this.renderPairing()
    }
    content.append(renderers[step]())
    this.dialog.setBody(content)
    const buttons = {
      layout: ['next'],
      bridges: ['back', 'next'],
      devices: ['back', 'next'],
      preview: ['back', 'apply'],
      pair: ['publish']
    }
    this.showButtons(buttons[step])
  }

  showButtons (visible) {
    const all = { back: this.backButton, next: this.nextButton, apply: this.applyButton, publish: this.publishButton, done: this.doneButton }
    Object.keys(all).forEach(key => all[key].render().toggleClass('d-none', !visible.includes(key)))
    this.dissmissButton.render().toggleClass('d-none', visible.includes('done'))
  }

  goBack () {
    this.show(STEPS[Math.max(0, STEPS.indexOf(this.step) - 1)])
  }

  goNext () {
    if (this.step === 'layout') {
      this.makePlan()
    }
    if (this.step === 'bridges') {
      const unnamed = this.plan.bridges.find(bridge => !bridge.id && (String(bridge.name).trim() === ''))
      if (unnamed) {
        this.error(this.__('Every new bridge needs a name.'))
        return
      }
    }
    if (this.step === 'devices') {
      const missing = this.chosenEntries().find(entry => String((this.choices[entry.id] || {}).name || '').trim() === '')
      if (missing) {
        this.error(this.__('Every device needs a name.'))
        return
      }
    }
    this.show(STEPS[STEPS.indexOf(this.step) + 1])
  }

  error (message) {
    this.status.setLabel($('<span>').addClass('text-danger small').text(message))
  }

  renderSteps () {
    const labels = {
      layout: this.__('Layout'),
      bridges: this.__('Bridges and rooms'),
      devices: this.__('Devices'),
      preview: this.__('Preview'),
      pair: this.__('Pair')
    }
    const list = $('<ol>').addClass('sa-steps list-unstyled d-flex flex-wrap gap-2 mb-3')
    STEPS.forEach((step, index) => {
      const done = index < STEPS.indexOf(this.step)
      const current = step === this.step
      const badge = $('<span>').addClass('badge rounded-pill ' + (current ? 'text-bg-primary' : (done ? 'text-bg-success' : 'text-bg-light border')))
        .text((index + 1) + ' ' + labels[step])
      if (current) badge.attr('aria-current', 'step')
      list.append($('<li>').append(badge))
    })
    return list
  }

  // ---- step 1: layout ----

  renderLayout () {
    const box = $('<div>')
    box.append($('<p>').text(this.__('Apple Home puts a new device into the room of its bridge. With a bridge per room every device lands in its room right away, nothing needs to be moved by hand.')))
    const layouts = [
      ['room', this.__('One bridge per room'), this.__('Recommended. Every device lands in its room.')],
      ['floor', this.__('One bridge per floor'), this.__('Fewer bridges. You assign the rooms to floors; devices land in the room of their floor bridge and are moved by hand.')],
      ['single', this.__('One bridge for everything'), this.__('The simplest setup. All devices land in one room and are moved by hand.')]
    ]
    const group = $('<div>').addClass('row g-2 mb-3').attr('role', 'radiogroup')
    layouts.forEach(([value, title, text]) => {
      const id = 'sa_layout_' + value
      const input = $('<input>').attr({ type: 'radio', name: 'sa_layout', id, value }).addClass('form-check-input')
        .prop('checked', this.layout === value)
        .on('change', () => { this.layout = value; this.show('layout') })
      const card = $('<label>').attr('for', id).addClass('sa-choice card h-100 p-3' + ((this.layout === value) ? ' border-primary' : ''))
      card.append($('<div>').addClass('d-flex gap-2 align-items-start')
        .append(input)
        .append($('<div>').append($('<div>').addClass('fw-semibold').text(title)).append($('<div>').addClass('small text-body-secondary').text(text))))
      group.append($('<div>').addClass('col-12 col-md-4').append(card))
    })
    box.append(group)

    const options = $('<div>').addClass('card p-3 mb-3')
    options.append($('<div>').addClass('fw-semibold mb-2').text(this.__('Options')))
    if (this.layout === 'room') {
      const limit = $('<input>').attr({ type: 'number', min: 1, max: 9, id: 'sa_smallLimit', 'aria-label': this.__('Devices') })
        .addClass('form-control form-control-sm d-inline-block mx-1 sa-number').val(this.options.smallLimit)
        .on('input', () => { this.options.smallLimit = Math.min(9, Math.max(1, parseInt(limit.val()) || 1)) })
      const merge = this.checkbox('sa_mergeSmall', this.options.mergeSmall, (checked) => { this.options.mergeSmall = checked })
      options.append($('<div>').addClass('form-check mb-1').append(merge)
        .append($('<label>').addClass('form-check-label').attr('for', 'sa_mergeSmall')
          .append(document.createTextNode(this.__('Put rooms with at most') + ' ')).append(limit).append(document.createTextNode(' ' + this.__('devices on one shared bridge')))))
      options.append($('<div>').addClass('form-text mb-2').text(this.__('Saves bridges; these devices land in the room of the shared bridge.')))
    }
    const security = this.checkbox('sa_security', this.options.security, (checked) => { this.options.security = checked })
    options.append($('<div>').addClass('form-check mb-1').append(security)
      .append($('<label>').addClass('form-check-label').attr('for', 'sa_security').text(this.__('Locks, alarm and sirens on a bridge of their own'))))
    options.append($('<div>').addClass('form-text').text(this.__('A change to other devices then never restarts them; they land in the room of the security bridge.')))
    box.append(options)

    if (this.allFunctions.length > 0) {
      const functions = $('<div>').addClass('card p-3')
      functions.append($('<div>').addClass('fw-semibold mb-1').text(this.__('Functions')))
      functions.append($('<div>').addClass('small text-body-secondary mb-2').text(this.__('Only devices of the ticked functions are proposed.')))
      const list = $('<div>').addClass('d-flex flex-wrap column-gap-3 row-gap-1')
      const chosen = this.functions || this.allFunctions.concat([''])
      this.allFunctions.concat(['']).forEach((name, index) => {
        const id = 'sa_function_' + index
        const input = this.checkbox(id, chosen.includes(name), (checked) => {
          const current = new Set(this.functions || this.allFunctions.concat(['']))
          if (checked) current.add(name); else current.delete(name)
          this.functions = [...current]
        })
        list.append($('<div>').addClass('form-check mb-0').append(input)
          .append($('<label>').addClass('form-check-label').attr('for', id).text(name === '' ? this.__('Devices without a function') : name)))
      })
      functions.append(list)
      box.append(functions)
    }
    return box
  }

  checkbox (id, checked, onChange) {
    const input = $('<input>').attr({ type: 'checkbox', id }).addClass('form-check-input').prop('checked', checked === true)
    input.on('change', () => onChange(input.prop('checked')))
    return input
  }

  makePlan () {
    this.byRoom = devicesByRoom(this.items, this.rooms, this.functions)
    this.candidates = [...this.byRoom.values()].flat()
    this.plan = proposePlan(this.layout, this.byRoom, this.rooms, this.application.getBridges(), {
      ...this.options,
      names: {
        floors: [this.__('Ground floor'), this.__('Upper floor')],
        otherRooms: this.__('Other rooms'),
        otherDevices: this.__('Other devices'),
        security: this.__('Security')
      }
    })
    this.selected = initialSelection(this.candidates)
    this.choices = completeChoices(this.candidates, this.selected)
  }

  // ---- step 2: bridges and rooms ----

  renderBridges () {
    const box = $('<div>')
    box.append($('<p>').text(this.__('Check the names of the new bridges and choose the bridge of every room. A room set to "not taken" stays out of HomeKit.')))

    const bridges = $('<div>').addClass('card p-3 mb-3')
    bridges.append($('<div>').addClass('fw-semibold mb-2').text(this.__('Bridges')))
    this.plan.bridges.forEach((bridge, index) => {
      const row = $('<div>').addClass('d-flex align-items-center gap-2 mb-2')
      if (bridge.id) {
        row.append($('<span>').addClass('flex-grow-1').text(bridge.name))
        row.append($('<span>').addClass('badge text-bg-secondary').text(this.__('existing')))
      } else {
        const id = 'sa_bridge_' + index
        const input = $('<input>').attr({ type: 'text', id, 'aria-label': this.__('Bridge name') }).addClass('form-control form-control-sm').val(bridge.name)
          .on('input', () => {
            bridge.name = input.val()
            preview.text(bridgeDisplayName(bridge.name))
          })
        const preview = $('<span>').addClass('small text-body-secondary text-nowrap d-none d-md-inline').text(bridgeDisplayName(bridge.name))
        row.append($('<div>').addClass('flex-grow-1').append(input))
        row.append(preview)
        row.append($('<span>').addClass('badge text-bg-primary').text(this.__('new')))
      }
      bridges.append(row)
    })
    if (this.plan.layout === 'floor') {
      const name = $('<input>').attr({ type: 'text', id: 'sa_newFloor', placeholder: this.__('e.g. Basement') }).addClass('form-control form-control-sm')
      const add = $('<button>').attr('type', 'button').addClass('btn btn-sm btn-outline-primary text-nowrap').text(this.__('Add floor'))
        .on('click', () => {
          if (String(name.val()).trim() !== '') {
            addBridge(this.plan, String(name.val()).trim())
            this.show('bridges')
          }
        })
      bridges.append($('<div>').addClass('d-flex gap-2 mt-1').append(name).append(add))
    }
    box.append(bridges)

    const table = $('<table>').addClass('table table-sm align-middle mb-0')
    table.append($('<thead>').append($('<tr>')
      .append($('<th>').text(this.__('Room')))
      .append($('<th>').addClass('text-end').text(this.__('Devices')))
      .append($('<th>').text(this.__('Bridge')))))
    const body = $('<tbody>')
    const roomRows = this.rooms.filter(room => (this.byRoom.get(room.id) || []).length > 0)
      .concat(((this.byRoom.get(NO_ROOM) || []).length > 0) ? [{ id: NO_ROOM, name: this.__('Devices without a room') }] : [])
    roomRows.forEach(room => {
      const select = $('<select>').attr({ id: 'sa_room_' + room.id, 'aria-label': room.name }).addClass('form-select form-select-sm')
      this.plan.bridges.forEach(bridge => select.append($('<option>').val(bridge.key).text(bridge.id ? bridge.name : bridgeDisplayName(bridge.name))))
      select.append($('<option>').val('').text(this.__('not taken')))
      select.val(this.plan.roomBridge[room.id] || '').on('change', () => { this.plan.roomBridge[room.id] = select.val() })
      body.append($('<tr>')
        .append($('<td>').text(room.name))
        .append($('<td>').addClass('text-end').text((this.byRoom.get(room.id) || []).length))
        .append($('<td>').append(select)))
    })
    table.append(body)
    box.append($('<div>').addClass('card p-3').append(table))
    if (this.plan.securityBridge) {
      box.append($('<div>').addClass('form-text mt-2').text(this.__('Locks, alarm and sirens go to the security bridge whatever their room.')))
    }
    return box
  }

  // ---- step 3: devices ----

  chosenEntries () {
    return this.candidates.flatMap(item => item.entries.filter(entry => this.selected.has(entry.id) && !isMapped(entry)))
  }

  renderDevices () {
    const box = $('<div>')
    box.append($('<p>').text(this.__('Tick the devices and channels you want in Apple Home. Open a device to change names, the type in Apple Home and its channels. Devices already in HomeKit are not shown and stay as they are.')))
    const toolbar = $('<div>').addClass('d-flex flex-wrap align-items-center gap-3 mb-3')
    const search = $('<input>').attr({ type: 'search', id: 'sa_search', placeholder: this.__('Search device, channel, room or serial') })
      .addClass('form-control form-control-sm sa-search').val(this.search)
      .on('input', () => { this.search = search.val(); this.renderDeviceList() })
    toolbar.append(search)
    const secondary = this.checkbox('sa_showSecondary', this.showSecondary, (checked) => { this.showSecondary = checked; this.renderDeviceList() })
    toolbar.append($('<div>').addClass('form-check form-switch mb-0').append(secondary.attr('role', 'switch'))
      .append($('<label>').addClass('form-check-label small').attr('for', 'sa_showSecondary').text(this.__('Show additional channels'))))
    this.counter = $('<span>').addClass('small text-body-secondary ms-auto')
    toolbar.append(this.counter)
    box.append(toolbar)
    this.deviceList = $('<div>')
    box.append(this.deviceList)
    this.renderDeviceList()
    return box
  }

  bridgeTitle (key) {
    const bridge = this.plan.bridges.find(candidate => candidate.key === key)
    return bridge ? (bridge.id ? bridge.name : bridgeDisplayName(bridge.name)) : this.__('not taken')
  }

  renderDeviceList () {
    this.deviceList.empty()
    const text = this.search.trim().toLowerCase()
    const has = (value) => String(value || '').toLowerCase().includes(text)
    const groups = new Map()
    this.candidates.forEach(item => {
      const key = bridgeOfDevice(this.plan, item, this.rooms)
      if (!key) return
      const device = item.device
      if ((text !== '') && !(has(device.name) || has(device.type) || has(device.address) || (device.rooms || []).some(has) ||
        item.entries.some(entry => entry.channels.some(channel => has(channel.name))))) return
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    })
    this.plan.bridges.filter(bridge => groups.has(bridge.key)).forEach(bridge => {
      const section = $('<section>').addClass('mb-3')
      section.append($('<h3>').addClass('h6 sa-bridge-title').append($('<i>').addClass('bi bi-house-door me-1').attr('aria-hidden', 'true')).append(document.createTextNode(this.bridgeTitle(bridge.key))))
      groups.get(bridge.key).forEach(item => section.append(this.renderDeviceItem(item)))
      this.deviceList.append(section)
    })
    if (groups.size === 0) {
      this.deviceList.append($('<div>').addClass('text-body-secondary text-center py-4').text(this.__('No device matches the filter.')))
    }
    const chosen = this.chosenEntries().length
    this.counter.html(this.__('%s selected', chosen))
    this.nextButton.setActive(chosen > 0)
  }

  renderDeviceItem (item) {
    const { device, entries } = item
    const free = entries.filter(entry => !isMapped(entry))
    const chosen = free.filter(entry => this.selected.has(entry.id))
    const isOpen = this.expanded.has(device.address)
    const box = $('<div>').addClass('nd-device border rounded mb-2')
    const head = $('<div>').addClass('nd-device-head d-flex align-items-center gap-2 px-2 py-2')
    const check = $('<input>').attr({ type: 'checkbox', 'aria-label': device.name }).addClass('form-check-input m-0 flex-shrink-0')
      .prop('checked', (free.length > 0) && (chosen.length === free.length))
      .prop('indeterminate', (chosen.length > 0) && (chosen.length < free.length))
      .on('click', (e) => {
        e.stopPropagation()
        if (chosen.length > 0) {
          free.forEach(entry => this.selected.delete(entry.id))
        } else {
          preselectedEntries(entries).forEach(entry => this.selected.add(entry.id))
        }
        this.choices = completeChoices(this.candidates, this.selected, this.choices)
        this.renderDeviceList()
      })
    head.append(check)
    head.append($('<span>').addClass('nd-chevron text-body-secondary').text(isOpen ? '▾' : '▸'))
    head.append(deviceIcon(device, this.iconBase))
    const title = $('<div>').addClass('flex-grow-1 min-w-0')
    title.append($('<div>').addClass('fw-semibold text-truncate').text(device.name))
    title.append($('<div>').addClass('small text-body-secondary text-truncate').text([device.type].concat(device.rooms || []).concat(device.functions || []).join(' · ')))
    head.append(title)
    if (chosen.length > 0) {
      head.append($('<span>').addClass('badge rounded-pill text-bg-primary flex-shrink-0').html(this.__('%s selected', chosen.length)))
    }
    head.on('click', () => {
      if (isOpen) this.expanded.delete(device.address); else this.expanded.add(device.address)
      this.renderDeviceList()
    })
    box.append(head)
    if (isOpen) {
      const body = $('<div>').addClass('nd-channels border-top py-1')
      const combinable = combinableEntries(chosen, this.choices)
      if (combinable.length > 1) {
        const id = 'sa_combine_' + device.address.replace(/[^A-Za-z0-9]/g, '_')
        const input = this.checkbox(id, this.combine.has(device.address), (checked) => {
          if (checked) {
            this.combine.add(device.address)
            this.choices[combinable[0].id].name = combinedName(device, this.choices[combinable[0].id].name)
          } else {
            this.combine.delete(device.address)
          }
          this.renderDeviceList()
        }).attr('role', 'switch')
        body.append($('<div>').addClass('px-2 pb-1')
          .append($('<div>').addClass('form-check form-switch mb-0').append(input)
            .append($('<label>').addClass('form-check-label').attr('for', id).html(this.__('One device in Apple Home with %s switches', combinable.length))))
          .append($('<div>').addClass('form-text mt-0').text(this.__('All switches share one room; Apple Home can still show them as separate tiles. Separate devices can each have their own room.'))))
      }
      const combined = this.combine.has(device.address) && (combinable.length > 1) ? combinable : []
      free.filter(entry => this.showSecondary || !entry.secondary || this.selected.has(entry.id))
        .forEach(entry => body.append(this.renderEntry(item, entry, combined)))
      box.append(body)
    }
    return box
  }

  renderEntry (item, entry, combined = []) {
    const uid = entry.id.replace(/[^A-Za-z0-9]/g, '_')
    const selected = this.selected.has(entry.id)
    const wrap = $('<div>').addClass('sa-entry px-2 py-1')
    const row = $('<div>').addClass('d-flex align-items-center gap-2')
    const check = $('<input>').attr({ type: 'checkbox', id: 'sa_e_' + uid }).addClass('form-check-input m-0 flex-shrink-0').prop('checked', selected)
      .on('change', () => {
        if (check.prop('checked')) this.selected.add(entry.id); else this.selected.delete(entry.id)
        this.choices = completeChoices(this.candidates, this.selected, this.choices)
        this.renderDeviceList()
      })
    row.append(check)
    const label = $('<label>').attr('for', 'sa_e_' + uid).addClass('d-flex align-items-center gap-2 flex-grow-1 min-w-0 mb-0')
    label.append($('<span>').addClass('nd-chnum badge text-bg-secondary flex-shrink-0').text(channelNumbers(entry)))
    let name
    if (entry.kind === 'keys') {
      name = (entry.channels.length === 1) ? this.__('Key') : this.__('Keys') + ' (' + entry.channels.length + ')'
    } else {
      name = hasDefaultName(item.device, entry.channels[0]) ? this.__('Channel') + ' ' + channelNumbers(entry) : entry.channels[0].name
    }
    label.append($('<span>').addClass('text-truncate').text(name))
    if (entry.secondary) {
      label.append($('<span>').addClass('badge text-bg-light border').text(this.__('additional channel')))
    }
    row.append(label)
    wrap.append(row)
    if (selected && combined.includes(entry) && (entry !== combined[0])) {
      wrap.append($('<div>').addClass('small text-body-secondary sa-choice-row').html(this.__('%s is a switch of %s', name, this.choices[combined[0].id].name)))
    } else if (selected) {
      wrap.append(this.renderChoice(entry, uid))
    }
    return wrap
  }

  renderChoice (entry, uid) {
    const choice = this.choices[entry.id]
    const single = entry.channels.length === 1
    const row = $('<div>').addClass('row g-2 mt-0 mb-1 sa-choice-row')
    const name = $('<input>').attr({ type: 'text', id: 'sa_n_' + uid, 'aria-label': this.__('Homekit Device name') }).addClass('form-control form-control-sm').val(choice.name)
      .on('input', () => { choice.name = name.val() })
    row.append($('<div>').addClass('col-12 col-md-5').append(name))
    const service = $('<select>').attr({ id: 'sa_s_' + uid, 'aria-label': this.__('Appears in Apple Home as') }).addClass('form-select form-select-sm')
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
      const current = entry.services.find(item => item.serviceClazz === choice.service)
      choice.settings = {}
      ;(current.options || []).forEach(option => { choice.settings[option.key] = option.default })
      this.renderDeviceList()
    })
    row.append($('<div>').addClass('col-12 col-md-4').append(service))
    const current = entry.services.find(item => item.serviceClazz === choice.service) || entry.services[0]
    ;(current.options || []).forEach(option => {
      const select = $('<select>').attr({ id: 'sa_o_' + uid + '_' + option.key, 'aria-label': this.__(option.label || option.key) }).addClass('form-select form-select-sm')
      option.values.forEach(value => select.append($('<option>').val(value).text(value)))
      select.val(choice.settings[option.key]).on('change', () => { choice.settings[option.key] = select.val() })
      row.append($('<div>').addClass('col-6 col-md-3').append(select))
    })
    if (isPerKeyChoice(entry, choice.service) && !single) {
      row.append($('<div>').addClass('col-12 small text-body-secondary').html(this.__('Creates %s devices in Apple Home.', entry.channels.length)))
    }
    return row
  }

  // ---- step 4: preview ----

  renderPreview () {
    const summary = summarize(this.plan, this.candidates, this.rooms, this.selected, this.choices, this.combine)
    const box = $('<div>')
    box.append($('<p>').html(this.__('%s devices on %s bridges, %s of them new.', summary.devices, summary.bridges.filter(item => item.devices > 0).length, summary.newBridges)))
    const table = $('<table>').addClass('table table-sm align-middle')
    table.append($('<thead>').append($('<tr>')
      .append($('<th>').text(this.__('Bridge')))
      .append($('<th>').text(this.__('Rooms')))
      .append($('<th>').addClass('text-end').text(this.__('Devices')))
      .append($('<th>').addClass('text-end').text(this.__('Accessories')))))
    const body = $('<tbody>')
    summary.bridges.filter(item => item.devices > 0).forEach(item => {
      const name = $('<td>').text(item.name + ' ')
      name.append($('<span>').addClass('badge ' + (item.isNew ? 'text-bg-primary' : 'text-bg-secondary')).text(item.isNew ? this.__('new') : this.__('existing')))
      body.append($('<tr>')
        .append(name)
        .append($('<td>').text(item.rooms.join(', ')))
        .append($('<td>').addClass('text-end').text(item.devices))
        .append($('<td>').addClass('text-end' + ((item.accessories > MAX_ACCESSORIES) ? ' text-danger fw-semibold' : '')).text(item.accessories)))
    })
    table.append(body)
    box.append(table)
    if (summary.tooMany.length > 0) {
      box.append($('<div>').addClass('alert alert-danger').text(this.__('Apple Home takes at most %s accessories per bridge. Split these bridges: %s', MAX_ACCESSORIES, summary.tooMany.join(', '))))
      this.applyButton.setActive(false)
    } else {
      this.applyButton.setActive(summary.devices > 0)
    }
    box.append($('<div>').addClass('alert alert-info').text(this.__('Devices already in HomeKit stay on their bridge. New bridges start without devices: pair them first, then the devices follow.')))
    return box
  }

  async apply () {
    const payload = buildApplyPayload(this.plan, this.candidates, this.rooms, this.selected, this.choices, this.combine)
    this.applyButton.setActive(false)
    this.backButton.setActive(false)
    this.spinner.setActive(true)
    this.status.setLabel($('<span>').addClass('small').text(this.__('Creating bridges and devices ...')))
    try {
      const result = await this.application.makeApiRequest({ method: 'applyAssistant', plan: JSON.stringify(payload) })
      if (!result || (result.result !== 'saved')) {
        throw new Error((result && result.reason) || 'error saving')
      }
      this.result = result
      this.usedBridgeIds = Object.values(result.bridges)
      this.newBridgeIds = result.created || []
      this.spinner.setActive(false)
      this.backButton.setActive(true)
      this.show('pair')
      this.pollBridges()
    } catch (e) {
      this.spinner.setActive(false)
      this.applyButton.setActive(true)
      this.backButton.setActive(true)
      this.status.setLabel($('<span>').addClass('text-danger small').html(this.__('Saving failed: %s', (e && (e.statusText || e.message)) || e)))
    }
  }

  // ---- step 5: pairing ----

  renderPairing () {
    const box = $('<div>')
    if (this.newBridgeIds.length === 0) {
      box.append($('<p>').text(this.__('No new bridge to pair. Publish the devices now.')))
      return box
    }
    box.append($('<p>').text(this.__('Add every new bridge in Apple Home: tap +, "Add Accessory", scan the code. Apple Home asks for the room of the bridge, choose the room shown here. Then publish the devices.')))
    this.pairingList = $('<div>').addClass('row g-3')
    box.append(this.pairingList)
    this.renderPairingCards()
    return box
  }

  renderPairingCards () {
    if (!this.pairingList) return
    this.pairingList.empty()
    const known = this.application.getBridges()
    this.newBridgeIds.forEach(id => {
      const bridge = known.find(candidate => candidate.id === id)
      const planned = this.plan.bridges.find(candidate => this.result.bridges[candidate.key] === id)
      const rooms = Object.keys(this.plan.roomBridge).filter(roomId => this.plan.roomBridge[roomId] === (planned && planned.key))
        .map(roomId => (this.rooms.find(room => String(room.id) === String(roomId)) || {}).name).filter(Boolean)
      const card = $('<div>').addClass('card h-100 p-3 text-center')
      card.append($('<div>').addClass('fw-semibold').text(bridge ? bridge.displayName : bridgeDisplayName(planned ? planned.name : '')))
      if (rooms.length === 1) {
        card.append($('<div>').addClass('small mb-2').html(this.__('Room in Apple Home: %s', rooms[0])))
      } else if (rooms.length > 1) {
        card.append($('<div>').addClass('small mb-2').html(this.__('Holds %s; choose one room for the bridge in Apple Home.', rooms.join(', '))))
      }
      if (!bridge || !bridge.setupURI) {
        card.append($('<div>').addClass('py-4').append($('<div>').addClass('spinner-border spinner-border-sm me-2')).append(document.createTextNode(this.__('Bridge is starting ...'))))
      } else {
        const qr = qrcode(4, 'L')
        qr.addData(bridge.setupURI)
        qr.make()
        card.append($('<div>').addClass('sa-qr mx-auto').html(qr.createSvgTag(4, 0)))
        card.append($('<div>').addClass('font-monospace fs-5 mt-2').text(bridge.pincode))
        const paired = bridge.paired === true
        card.append($('<div>').addClass('mt-2').append($('<span>').addClass('badge ' + (paired ? 'text-bg-success' : 'text-bg-warning'))
          .text(paired ? this.__('paired') : this.__('waiting for pairing'))))
      }
      this.pairingList.append($('<div>').addClass('col-12 col-sm-6 col-lg-4').append(card))
    })
  }

  pollBridges () {
    clearInterval(this.pollTimer)
    const refresh = async () => {
      try {
        const bridges = await this.application.makeApiRequest({ method: 'bridges' })
        if (Array.isArray(bridges)) {
          this.application.bridges = bridges
          this.renderPairingCards()
        }
      } catch (e) {
        // the server restarts its bridges, the next poll gets them
      }
    }
    refresh()
    this.pollTimer = setInterval(refresh, PAIRING_POLL_MS)
  }

  async publish () {
    const known = this.application.getBridges()
    const unpaired = this.newBridgeIds.filter(id => !(known.find(bridge => bridge.id === id) || {}).paired)
    if ((unpaired.length > 0) && (this.confirmUnpaired !== true)) {
      this.confirmUnpaired = true
      this.error(this.__('%s bridges are not paired yet. Their devices would land in the default room. Click again to publish anyway.', unpaired.length))
      return
    }
    clearInterval(this.pollTimer)
    this.publishButton.setActive(false)
    this.spinner.setActive(true)
    try {
      await this.application.makeApiRequest({ method: 'publish', bridges: JSON.stringify(this.usedBridgeIds) })
      this.spinner.setActive(false)
      this.status.setLabel('')
      this.dialog.setBody($('<div>').addClass('sa text-center py-4')
        .append($('<i>').addClass('bi bi-check-circle text-success sa-done').attr('aria-hidden', 'true'))
        .append($('<p>').addClass('mt-3').text(this.__('Done. The devices appear in Apple Home within a minute, in the room of their bridge.'))))
      this.showButtons(['done'])
      setTimeout(() => this.application.refreshAll(), 2000)
    } catch (e) {
      this.spinner.setActive(false)
      this.publishButton.setActive(true)
      this.status.setLabel($('<span>').addClass('text-danger small').html(this.__('Saving failed: %s', (e && (e.statusText || e.message)) || e)))
    }
  }
}
