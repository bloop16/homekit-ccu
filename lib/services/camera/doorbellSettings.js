'use strict'

/*
 * Settings of a doorbell without camera, shared by the doorbell service of a channel and the
 * special doorbell: where its still image comes from. The picture of the device in the CCU is
 * the default and the fallback of a configured picture.
 */

const path = require('path')
const { devicePicture } = require(path.join(__dirname, '..', '..', 'util', 'deviceIcons.js'))

// option shown in the settings (translated there) -> source kind of util/doorbellImage.js;
// 'From the video' (video doorbell) takes the snapshot from its video through ffmpeg
const IMAGE_SOURCES = Object.freeze({
  'Picture of the device': 'ccu',
  URL: 'url',
  'File on the CCU': 'file',
  'From the video': 'video'
})

const DEFAULT_REFRESH_SECONDS = 10

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
    hint: 'A PNG or JPEG, for a URL or a file on the CCU only; an uploaded picture is stored with the configuration',
    selector: 'picture'
  },
  imageRefresh: {
    type: 'number',
    default: DEFAULT_REFRESH_SECONDS,
    label: 'Read the picture again after (seconds)',
    hint: 'For a URL or file that is replaced, e.g. the snapshot a camera stores: it is read again when Apple Home asks for the picture, at most this often. 0 reads it once. Only what is stored is read, no camera is asked for a new picture'
  }
})

/** seconds after which the picture is read again; 0 (once) as set, the default when not set */
function refreshSeconds (setting) {
  const value = parseInt(setting('imageRefresh'), 10)
  return (Number.isFinite(value) && value >= 0) ? value : DEFAULT_REFRESH_SECONDS
}

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

// the picture of a video doorbell: from its video by default, or a URL or file (e.g. the snapshot
// a battery camera stores, so a snapshot of Apple Home never wakes it)
const VIDEO_IMAGE_SETTINGS = Object.freeze({
  imageSource: {
    ...IMAGE_SETTINGS.imageSource,
    array: ['From the video', 'URL', 'File on the CCU'],
    default: 'From the video',
    hint: 'The snapshot Apple Home shows in the tile and the ring notification; from the video it is taken through ffmpeg, which wakes a battery camera every time'
  },
  image: IMAGE_SETTINGS.image,
  imageRefresh: IMAGE_SETTINGS.imageRefresh
})

module.exports = { IMAGE_SOURCES, IMAGE_SETTINGS, VIDEO_IMAGE_SETTINGS, imageSources, refreshSeconds }
