const path = require('path')
const fs = require('fs')
const { Accessory, Categories, CameraController } = require('@homebridge/hap-nodejs')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const StreamingDelegate = require(path.join(__dirname, 'camera', 'StreamingDelegate.js'))
const FfmpegProcess = require(path.join(__dirname, 'camera', 'FfmpegProcess.js'))
const { buildStreamingOptions } = require(path.join(__dirname, 'camera', 'streamingOptions.js'))
const { usernameFromUuid, isValidSetupCode } = require(path.join(__dirname, 'camera', 'hapIdentity.js'))
const hapIds = require(path.join(__dirname, '..', 'util', 'hapIds.js'))

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

  /**
   * Check the configuration and ffmpeg; returns the encoder set, or null after logging why the doorbell is not published.
   */
  probeCamera (settings) {
    const fail = (reason) => {
      this.log.error('[Camera %s] %s, doorbell will not be published', this._name, reason)
      return null
    }
    if (!isValidSetupCode(this.pinCode())) {
      return fail('the configured pin code is invalid; use eight digits in the form XXX-XX-XXX and avoid trivial codes such as repeated or ascending digits')
    }
    if (!String(this.getDeviceSettings('video_source') || '').trim()) {
      return fail('no video source configured')
    }
    // the setting (also from a restored backup) starts a program as root: only one named ffmpeg
    if (!/^(\/[\w.+-]+)*\/?ffmpeg$/.test(settings.ffmpegPath)) {
      return fail(`the ffmpeg path must name a program called ffmpeg, not ${settings.ffmpegPath}`)
    }
    // a bare name like "ffmpeg" is looked up in PATH by the probe
    if (settings.ffmpegPath.includes('/') && !fs.existsSync(settings.ffmpegPath)) {
      return fail(`ffmpeg not found at ${settings.ffmpegPath}`)
    }
    const encoders = FfmpegProcess.probeEncoders(settings.ffmpegPath, this.log)
    if (!encoders) {
      return fail(`ffmpeg at ${settings.ffmpegPath} cannot be used (see error above)`)
    }
    if (settings.vcodec !== 'copy' && !encoders.has(settings.vcodec)) {
      return fail(`ffmpeg at ${settings.ffmpegPath} has no ${settings.vcodec} encoder; use a build with ${settings.vcodec} or set the video codec to copy if the camera delivers H.264`)
    }
    return encoders
  }

  publishServices (Service, Characteristic) {
    const settings = this.cameraSettings()
    const encoders = this.probeCamera(settings)
    if (!encoders) {
      this.cameraUnavailable = true
      return
    }
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
    // hap answers reads of ProgrammableSwitchEvent with null itself, so no get handler is needed
    const dingDong = doorbellService.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress(doorBellSensor), () => {
      if (!this.initialQuery) {
        this.debugLog('DingDong')
        // an event notification is sent for every ring, even though the value stays SINGLE_PRESS
        dingDong.sendEventNotification(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS)
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

  // the configured setup code, otherwise a random one generated once for this doorbell
  pinCode () {
    const configured = this.getDeviceSettings('pin-code')
    if (configured) return configured
    let generated = this.getPersistentValue('pin-code')
    if (!generated) {
      generated = hapIds.generatePin()
      this.savePersistentValue('pin-code', generated)
    }
    return generated
  }

  getPublishInfo () {
    return {
      // unique per doorbell, so several doorbells do not collide
      username: usernameFromUuid(this._accessoryUUID),
      port: this.getPort(),
      pincode: this.pinCode(),
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
      video_source: { type: 'text', hint: 'RTSP URL, or raw ffmpeg input args starting with - (e.g. -re -f lavfi -i testsrc); no quoting supported, arguments are split on spaces', label: 'URL RTSP video', mandatory: true },
      video_stillImageSource: { type: 'text', hint: '', label: 'URL still image', default: '' },
      'pin-code': { type: 'text', hint: 'Setup code for adding the doorbell in Apple Home. A random code is suggested; save the settings to keep it.', label: 'PinCode', default: hapIds.generatePin() },
      ffmpegpath: { advanced: true, type: 'text', hint: '', label: 'Path to ffmpeg', default: '/usr/local/bin/ffmpeg' },
      vcodec: { advanced: true, type: 'text', hint: '\'copy\' when the camera delivers H.264 (recommended on the CCU itself); libx264 transcodes and needs a fast CPU', label: 'Video codec', default: 'libx264' },
      maxWidth: { advanced: true, type: 'number', hint: '', label: 'Max width', default: 1280 },
      maxHeight: { advanced: true, type: 'number', hint: '', label: 'Max height', default: 720 },
      maxFPS: { advanced: true, type: 'number', hint: '', label: 'Max FPS', default: 15 },
      maxBitrate: { advanced: true, type: 'number', hint: '', label: 'Max bitrate (kbit/s)', default: 1000 },
      audio: { type: 'checkbox', hint: '', label: 'Audio', default: true },
      audio_return_target: { advanced: true, type: 'text', hint: 'ffmpeg output for talkback, empty disables two-way audio; raw options starting with - override codec, e.g. -codec:a pcm_mulaw -ar 8000 -f rtsp rtsp://cam/talk', label: 'Talkback target', default: '' }
    }
  }

  static channelTypes () {
    return ['SPECIAL']
  }
}
