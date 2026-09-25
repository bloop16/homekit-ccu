'use strict'

/*
 * Settings of a doorbell without camera, shared by the doorbell service of a channel and the
 * special doorbell: where its still image comes from. The picture of the device in the CCU is
 * the default and the fallback of a configured picture.
 */

const path = require('path')
const { devicePicture } = require(path.join(__dirname, '..', '..', 'util', 'deviceIcons.js'))

// option shown in the settings (translated there) -> source kind of util/doorbellImage.js
const IMAGE_SOURCES = Object.freeze({
  'Picture of the device': 'ccu',
  URL: 'url',
  'File on the CCU': 'file'
})

const IMAGE_SETTINGS = Object.freeze({
  imageSource: {
    type: 'option',
    array: Object.keys(IMAGE_SOURCES),
    default: 'Picture of the device',
    label: 'Picture',
    hint: 'Apple Home shows it in the doorbell tile and the ring notification; a doorbell without camera has no live video'
  },
  image: {
    type: 'text',
    default: '',
    label: 'URL or file of the picture',
    hint: 'A PNG or JPEG, for a URL or a file on the CCU only'
  }
})

/**
 * The picture sources of a doorbell, in order of preference.
 * @param {function} setting getDeviceSettings of the accessory
 * @param {string} deviceType the device whose CCU picture is the default
 * @returns {object[]} sources for util/doorbellImage.js StillImage
 */
function imageSources (setting, deviceType) {
  const sources = []
  const kind = IMAGE_SOURCES[setting('imageSource')]
  const value = String(setting('image') || '').trim()
  if ((kind === 'url' || kind === 'file') && value) {
    sources.push({ kind, value })
  }
  const picture = deviceType ? devicePicture(deviceType) : undefined
  if (picture) {
    sources.push({ kind: 'ccu', value: picture })
  }
  return sources
}

module.exports = { IMAGE_SOURCES, IMAGE_SETTINGS, imageSources }
