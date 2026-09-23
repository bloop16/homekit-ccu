const path = require('path')
const fs = require('fs')
const { Accessory, Categories, CameraController } = require('@homebridge/hap-nodejs')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const StreamingDelegate = require(path.join(__dirname, 'camera', 'StreamingDelegate.js'))
const FfmpegProcess = require(path.join(__dirname, 'camera', 'FfmpegProcess.js'))
const { buildStreamingOptions } = require(path.join(__dirname, 'camera', 'streamingOptions.js'))

const DEFAULTS = { maxWidth: 1280, maxHeight: 720, maxFPS: 15, maxBitrate: 1000, vcodec: 'libx264' }

/**
 * A plain URL gets the given prefix ("-re -i "); a value that already starts with "-" is taken as raw ffmpeg input args.
 */
function inputArgs (value, prefix) {
  const trimmed = String(value || '').trim()
  return trimmed.startsWith('-') ? trimmed : prefix + trimmed
}

module.exports = class HomeMaticSPVideoDoorBellAccessory extends HomeMaticAccessory {
  createHomeKitAccessory () {
    this.debugLog('publishing services for %s', this.getName())
    this.homeKitAccessory = new Accessory(this._name, this._accessoryUUID, Categories.VIDEO_DOORBELL)
    this.homeKitAccessory.on('identify', (paired, callback) => callback())
    this.homeKitAccessory.log = this.log
  }

  /**
   * Positive integer setting or its default.
   */
  numberSetting (key) {
    const value = parseInt(this.getDeviceSettings(key), 10)
    return Number.isFinite(value) && value > 0 ? value : DEFAULTS[key]
  }

  /**
   * Settings object for StreamingDelegate built from the device configuration.
   */
  cameraSettings () {
    return {
      ffmpegPath: this.getDeviceSettings('ffmpegpath') || '/usr/local/bin/ffmpeg',
      source: inputArgs(this.getDeviceSettings('video_source'), '-re -i '),
      stillImageSource: this.getDeviceSettings('video_stillImageSource') ? inputArgs(this.getDeviceSettings('video_stillImageSource'), '-i ') : undefined,
      vcodec: this.getDeviceSettings('vcodec') || DEFAULTS.vcodec,
      maxWidth: this.numberSetting('maxWidth'),
      maxHeight: this.numberSetting('maxHeight'),
      maxFPS: this.numberSetting('maxFPS'),
      maxBitrate: this.numberSetting('maxBitrate'),
      audio: this.getDeviceSettings('audio') !== false && this.getDeviceSettings('audio') !== 'false',
      returnAudioTarget: this.getDeviceSettings('audio_return_target') || ''
    }
  }

  publishServices (Service, Characteristic) {
    const settings = this.cameraSettings()
    if (!fs.existsSync(settings.ffmpegPath)) {
      this.log.error('[Camera %s] ffmpeg not found at %s, doorbell will not be published', this._name, settings.ffmpegPath)
      this.cameraUnavailable = true
      return
    }
    const encoders = FfmpegProcess.probeEncoders(settings.ffmpegPath, this.log)
    const streamingOptions = buildStreamingOptions({ encoders, audio: settings.audio, twoWay: Boolean(settings.returnAudioTarget) })
    if (settings.audio && !streamingOptions.audio) {
      this.log.warn('[Camera %s] ffmpeg has neither libopus nor libfdk_aac, publishing without audio', this._name)
    }
    // hap fakes an Opus configuration when no codec is offered, so the delegate must know whether audio is really on
    const audioOffered = Boolean(streamingOptions.audio)
    const talkback = audioOffered && streamingOptions.audio.twoWayAudio
    this.streamingDelegate = new StreamingDelegate(this._name, { ...settings, audio: audioOffered }, this.log)
    this.cameraController = new CameraController({ cameraStreamCount: 2, delegate: this.streamingDelegate, streamingOptions })
    this.streamingDelegate.attachController(this.cameraController)
    this.homeKitAccessory.configureController(this.cameraController)
    this.log.info('[Camera %s] published (%s, audio %s, talkback %s)', this._name, settings.vcodec, audioOffered ? 'on' : 'off', talkback ? 'on' : 'off')

    this.addDoorbellService(Service, Characteristic)
  }

  addDoorbellService (Service, Characteristic) {
    const doorBellSensor = this.getDeviceSettings('address_door_bell_key')
    if (!doorBellSensor) {
      return
    }
    const doorbellService = new Service.Doorbell(this._name)
    // like hap's DoorbellController: Apple Home expects the doorbell as primary service of a video doorbell
    doorbellService.setPrimaryService()
    this.homeKitAccessory.addService(doorbellService)
    this.initialQuery = true
    const dingDong = doorbellService.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      .on('get', (callback) => callback(null, 0))
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress(doorBellSensor), () => {
      if (!this.initialQuery) {
        this.debugLog('DingDong')
        dingDong.updateValue(0, null)
      }
      this.initialQuery = false
    })
  }

  publishSingleAccessory (port) {
    if (this.cameraUnavailable) {
      return
    }
    super.publishSingleAccessory(port)
  }

  shutdown () {
    super.shutdown()
    if (this.streamingDelegate) {
      this.streamingDelegate.shutdown().catch(e => this.log.error('[Camera %s] shutdown failed: %s', this._name, e.message))
    }
  }

  isBridgedAccessory () {
    return false
  }

  getPublishInfo () {
    return {
      username: '00:00:11:22:22:11',
      port: this.getPort(),
      pincode: this.getDeviceSettings('pin-code') || '123-45-678',
      category: Categories.VIDEO_DOORBELL
    }
  }

  static serviceDescription () {
    return 'This service provides a Video door bell for HomeKit'
  }

  static configurationItems () {
    return {
      address_door_bell_key: {
        type: 'text',
        label: 'Address door bell indicator',
        selector: 'datapoint',
        hint: '',
        options: { filterChannels: ['KEY', 'VIRTUAL_KEY', 'MULTI_MODE_INPUT_TRANSMITTER'] },
        mandatory: true
      },
      video_source: { type: 'text', hint: 'RTSP URL, or raw ffmpeg input args starting with - (e.g. -f lavfi -i testsrc)', label: 'URL RTSP video', mandatory: true },
      video_stillImageSource: { type: 'text', hint: '', label: 'URL still image', default: '' },
      'pin-code': { type: 'text', hint: '', label: 'PinCode', default: '123-45-678' },
      ffmpegpath: { type: 'text', hint: '', label: 'Path to ffmpg', default: '/usr/local/bin/ffmpeg' },
      vcodec: { type: 'text', hint: 'Use copy when the camera already delivers H.264', label: 'Video codec', default: 'libx264' },
      maxWidth: { type: 'number', hint: '', label: 'Max width', default: 1280 },
      maxHeight: { type: 'number', hint: '', label: 'Max height', default: 720 },
      maxFPS: { type: 'number', hint: '', label: 'Max FPS', default: 15 },
      maxBitrate: { type: 'number', hint: '', label: 'Max bitrate (kbit/s)', default: 1000 },
      audio: { type: 'checkbox', hint: '', label: 'Audio', default: true },
      audio_return_target: { type: 'text', hint: 'ffmpeg output for talkback, empty disables two-way audio', label: 'Talkback target', default: '' }
    }
  }

  static channelTypes () {
    return ['SPECIAL']
  }
}
