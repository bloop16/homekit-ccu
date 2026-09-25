const path = require('path')
const fs = require('fs')
const { Accessory, Categories, CameraController } = require('@homebridge/hap-nodejs')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const StreamingDelegate = require(path.join(__dirname, 'camera', 'StreamingDelegate.js'))
const FfmpegProcess = require(path.join(__dirname, 'camera', 'FfmpegProcess.js'))
const { buildStreamingOptions, withDoorbellAudio } = require(path.join(__dirname, 'camera', 'streamingOptions.js'))
const { usernameFromUuid, isValidSetupCode } = require(path.join(__dirname, 'camera', 'hapIdentity.js'))
const hapIds = require(path.join(__dirname, '..', 'util', 'hapIds.js'))
const { isActionDatapoint } = require(path.join(__dirname, '..', 'util', 'regaBulkRead.js'))
const { INSTALL_DIR: FFMPEG_DIR } = require(path.join(__dirname, '..', 'util', 'ffmpegInstaller.js'))
const { StillImage } = require(path.join(__dirname, '..', 'util', 'doorbellImage.js'))
const { createRingTrigger } = require(path.join(__dirname, '..', 'util', 'doorbellTrigger.js'))
const { VIDEO_IMAGE_SETTINGS, imageSources, refreshSeconds } = require(path.join(__dirname, 'camera', 'doorbellSettings.js'))

const DEFAULTS = { maxWidth: 1280, maxHeight: 720, maxFPS: 15, maxBitrate: 1000, vcodec: 'libx264' }
// the path hap-homematic and older versions stored as default
const SYSTEM_FFMPEG = '/usr/local/bin/ffmpeg'

/**
 * The ffmpeg to run: a configured one that exists, else the one the add-on installed (see
 * util/ffmpegInstaller.js), else the configured or the system path (the probe then says why
 * there is none).
 */
function resolveFfmpegPath (configured) {
  const own = path.join(process.env.HOMEKIT_CCU_FFMPEG_DIR || FFMPEG_DIR, 'ffmpeg')
  const value = String(configured || '').trim()
  if (value && value.includes('/') && fs.existsSync(value)) {
    return value
  }
  if (fs.existsSync(own)) {
    return own
  }
  return value || SYSTEM_FFMPEG
}

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
      ffmpegPath: resolveFfmpegPath(this.getDeviceSettings('ffmpegpath')),
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
    const offered = buildStreamingOptions({ encoders, audio: settings.audio, twoWay: Boolean(settings.returnAudioTarget) })
    if (settings.audio && !offered.audio) {
      this.log.warn('[Camera %s] ffmpeg has neither libopus nor libfdk_aac, publishing without audio', this._name)
    }
    // hap fakes an Opus configuration when no codec is offered, so the delegate must know whether audio is really on
    const audioOffered = Boolean(offered.audio)
    const talkback = audioOffered && offered.audio.twoWayAudio
    // a video doorbell always has microphone and speaker (HAP 11.3.2), a camera only with its audio
    const streamingOptions = this.getDeviceSettings('address_door_bell_key') ? withDoorbellAudio(offered) : offered
    // a picture from a URL or file answers the snapshots, the video is only opened for live view
    const setting = (key) => this.getDeviceSettings(key)
    const sources = imageSources(setting, undefined)
    const stillImage = (sources.length > 0) ? new StillImage(sources, this.log, this._name, { refreshSeconds: refreshSeconds(setting) }) : undefined
    this.streamingDelegate = new StreamingDelegate(this._name, { ...settings, audio: audioOffered, returnAudioTarget: talkback ? settings.returnAudioTarget : '' }, this.log, { stillImage })
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
    // hap answers reads of ProgrammableSwitchEvent with null itself, so no get handler is needed
    const dingDong = doorbellService.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
    // a key press (PRESS_SHORT, ...) rings with every event, a state when it becomes active;
    // rings closer than 3 s count once (util/doorbellTrigger.js)
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress(doorBellSensor), createRingTrigger({
      isAction: isActionDatapoint(doorBellSensor),
      ring: () => {
        this.debugLog('DingDong')
        // an event notification is sent for every ring, even though the value stays SINGLE_PRESS
        dingDong.sendEventNotification(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS)
      }
    }))
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
        options: { filterChannels: ['KEY', 'KEY_TRANSCEIVER', 'VIRTUAL_KEY', 'MULTI_MODE_INPUT_TRANSMITTER', 'SWITCH_INTERFACE', 'SHUTTER_CONTACT', 'SHUTTER_CONTACT_TRANSCEIVER', 'CONTACT', 'SENSOR'] },
        mandatory: true
      },
      ffmpeg: { type: 'ffmpeg', label: 'ffmpeg', hint: 'The video needs ffmpeg, which OpenCCU does not have. The add-on installs a static build of the Homebridge project (it contains the non-free fdk-aac and is therefore not part of the add-on)' },
      video_source: { type: 'text', hint: 'RTSP URL, or raw ffmpeg input args starting with - (e.g. -re -f lavfi -i testsrc); no quoting supported, arguments are split on spaces', label: 'URL RTSP video', mandatory: true },
      ...VIDEO_IMAGE_SETTINGS,
      video_stillImageSource: { advanced: true, type: 'text', hint: 'With the picture "From the video": another ffmpeg input for the snapshot, e.g. a substream', label: 'URL still image', default: '' },
      'pin-code': { type: 'text', hint: 'Setup code for adding the doorbell in Apple Home. A random code is suggested; save the settings to keep it.', label: 'PinCode', default: hapIds.generatePin() },
      ffmpegpath: { advanced: true, type: 'text', hint: 'Empty: the ffmpeg installed by the add-on', label: 'Path to ffmpeg', default: '' },
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
