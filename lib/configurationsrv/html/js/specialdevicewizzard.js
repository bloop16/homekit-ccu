/*
 * File: specialdevicewizzard.js
 * Project: homekit-ccu
 * -----
 * The MIT License (MIT)
 * ==========================================================================
 */

/*
 * A new special device in two steps: first its kind (video doorbell, garage door, ...), then a
 * form with the settings of exactly that kind; rarely needed settings stay folded. Editing a
 * special device shows the same form for its kind (EditDeviceWizzard with fixedServiceLabel).
 */

import { Grid } from './ui.js'
import { EditDeviceWizzard } from './wizzards.js'

// the kinds in the order the dialog offers them: label and symbol (Bootstrap Icons)
export const SPECIAL_KINDS = {
  HomeMaticSPVideoDoorBellAccessory: { label: 'Video doorbell', icon: 'bi-camera-video' },
  HomeMaticSPGarageDoorAccessory: { label: 'Garage door from sensors and actors', icon: 'bi-door-closed' },
  HomeMaticSPTwoSensorWindowAccessory: { label: 'Window with rotary handle and contact', icon: 'bi-window' },
  HomeMaticSPMultiChannelKeyAccessory: { label: 'Several keys as one device', icon: 'bi-grid-3x2-gap' },
  HomeMaticSPMultiChannelPushButtonAccessory: { label: 'Several keys as one push button device', icon: 'bi-hand-index' },
  HomeMaticSPCCUTempAccessory: { label: 'CCU temperature', icon: 'bi-thermometer-half' },
  HomeMaticSPCCUDutyCycleAccessory: { label: 'CCU duty cycle', icon: 'bi-activity' }
}

/** the readable name of a special device class */
export function specialKindLabel (application, serviceClazz) {
  const kind = SPECIAL_KINDS[serviceClazz]
  return kind ? application.__(kind.label) : serviceClazz
}

export class SpecialDeviceWizzard extends EditDeviceWizzard {
  /** the kinds of special devices, then the form of the chosen one */
  async run () {
    this.device = { settings: {} }
    this.workingCopy = { settings: {} }
    const list = await this.application.makeApiRequest({ method: 'service', channelAddress: 'new:special' })
    const services = (list.service || []).slice()
      .sort((a, b) => Object.keys(SPECIAL_KINDS).indexOf(a.serviceClazz) - Object.keys(SPECIAL_KINDS).indexOf(b.serviceClazz))
    this.dialog.setTitle(this.__('New special device'))
    this.showKinds(services)
    this.dialog.open()
  }

  showKinds (services) {
    this.publishButton.render().addClass('d-none')
    this.statusLabel.setLabel('')
    const content = $('<div>')
    content.append($('<p>').text(this.__('Which kind of device do you want to create?')))
    const grid = $('<div>').addClass('row g-2')
    services.forEach(service => {
      const kind = SPECIAL_KINDS[service.serviceClazz] || { label: service.serviceClazz, icon: 'bi-stars' }
      const card = $('<button>').attr({ type: 'button', id: 'special_' + service.serviceClazz }).addClass('card h-100 w-100 p-3 text-start sa-choice')
      card.append($('<div>').addClass('d-flex gap-3 align-items-start')
        .append($('<i>').addClass('bi fs-3 ' + kind.icon).attr('aria-hidden', 'true'))
        .append($('<div>')
          .append($('<div>').addClass('fw-semibold').text(this.__(kind.label)))
          .append($('<div>').addClass('small text-body-secondary').html(this.__(service.description)))))
      card.on('click', () => this.showForm(services, service))
      grid.append($('<div>').addClass('col-12 col-md-6').append(card))
    })
    content.append(grid)
    this.dialog.setBody(content)
  }

  async showForm (services, service) {
    this.publishButton.render().removeClass('d-none')
    this.fixedServiceLabel = specialKindLabel(this.application, service.serviceClazz)
    this.showAdvanced = false
    this.serviceSettings = {
      method: 'saveDevice',
      name: this.fixedServiceLabel,
      address: 'new:special',
      instanceIDs: { 0: undefined },
      serviceClass: service.serviceClazz,
      template: service.settings,
      settings: {},
      uuid: 'new'
    }
    const content = $('<div>')
    const back = $('<button>').attr('type', 'button').addClass('btn btn-link px-0 mb-2').text('← ' + this.__('Choose another kind'))
      .on('click', () => this.showKinds(services))
    content.append(back)
    this.grid = new Grid('editDeviceGrid', { rowStyle: 'margin-bottom:15px' })
    await this.buildDeviceSettings()
    content.append(this.grid.render())
    this.dialog.setBody(content)
  }
}
