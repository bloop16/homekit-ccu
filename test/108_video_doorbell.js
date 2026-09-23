const path = require('path')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const VideoDoorBell = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticSPVideoDoorBellAccessory.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))
const fs = require('fs')
const os = require('os')

const FAKE = path.join(__dirname, 'fixtures', 'fake-ffmpeg.sh')
const log = new Logger('HAP Test')
log.setDebugEnabled(false)

function createDoorBell (settings, logger = log) {
  const registered = []
  const server = {
    isTestMode: true,
    log: logger,
    _ccu: {
      variableWithName: () => undefined,
      registerAddressForEventProcessingAtAccessory: (address, callback) => registered.push({ address, callback })
    }
  }
  const accessory = new VideoDoorBell({ address: 'VIDEODOORBELL:0', type: 'SPECIAL', name: 'Door' }, 'SPECIAL', server, { name: 'Door', settings })
  accessory.registered = registered
  accessory.createHomeKitAccessory()
  accessory.publishServices(hap.Service, hap.Characteristic)
  return accessory
}

describe('HomeKit-CCU video doorbell accessory', () => {
  const accessories = []
  const make = (settings, logger) => {
    const accessory = createDoorBell(settings, logger)
    accessories.push(accessory)
    return accessory
  }

  after(() => accessories.forEach(accessory => accessory.shutdown()))

  it('prepends -re -i to a plain URL and keeps raw ffmpeg input args', () => {
    const url = make({ ffmpegpath: FAKE, video_source: 'rtsp://cam/stream', video_stillImageSource: 'http://cam/snap.jpg' })
    expect(url.cameraSettings().source).to.be('-re -i rtsp://cam/stream')
    expect(url.cameraSettings().stillImageSource).to.be('-i http://cam/snap.jpg')
    const raw = make({ ffmpegpath: FAKE, video_source: ' -f lavfi -i testsrc ' })
    expect(raw.cameraSettings().source).to.be('-f lavfi -i testsrc')
    expect(raw.cameraSettings().stillImageSource).to.be(undefined)
  })

  it('uses defaults for missing or invalid numbers and parses audio flags', () => {
    const settings = make({ ffmpegpath: FAKE, video_source: 'rtsp://x', maxWidth: '640', maxFPS: 'abc', audio: 'false' }).cameraSettings()
    expect(settings.maxWidth).to.be(640)
    expect(settings.maxHeight).to.be(720)
    expect(settings.maxFPS).to.be(15)
    expect(settings.maxBitrate).to.be(1000)
    expect(settings.vcodec).to.be('libx264')
    expect(settings.audio).to.be(false)
    expect(settings.returnAudioTarget).to.be('')
  })

  it('configures a CameraController with audio when encoders exist', () => {
    const accessory = make({ ffmpegpath: FAKE, video_source: 'rtsp://x', audio_return_target: 'rtsp://cam/talk' })
    expect(accessory.cameraUnavailable).to.be(undefined)
    expect(accessory.cameraController).to.be.a(hap.CameraController)
    expect(accessory.streamingDelegate.settings.audio).to.be(true)
    expect(accessory.homeKitAccessory.getService(hap.Service.CameraRTPStreamManagement)).to.be.ok()
    expect(accessory.homeKitAccessory.getService(hap.Service.Doorbell)).to.be(undefined)
  })

  it('degrades to video only when ffmpeg has no audio encoder', () => {
    const accessory = make({ ffmpegpath: FAKE, video_source: 'rtsp://x' })
    // re-publish with an encoder list without audio encoders
    process.env.FAKE_ENCODERS = ' V..... libx264            libx264 H.264'
    try {
      accessory.createHomeKitAccessory()
      accessory.publishServices(hap.Service, hap.Characteristic)
    } finally {
      delete process.env.FAKE_ENCODERS
    }
    expect(accessory.streamingDelegate.settings.audio).to.be(false)
  })

  it('adds the doorbell service and rings on events after the initial query', () => {
    const accessory = make({ ffmpegpath: FAKE, video_source: 'rtsp://x', address_door_bell_key: 'BidCos-RF.KEQ0000001:1.PRESS_SHORT' })
    const doorbell = accessory.homeKitAccessory.getService(hap.Service.Doorbell)
    expect(doorbell).to.be.ok()
    expect(doorbell.isPrimaryService).to.be(true)
    expect(accessory.registered.length).to.be(1)
    const events = []
    doorbell.getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent).on('change', (change) => events.push(change.newValue))
    accessory.registered[0].callback(true)
    accessory.registered[0].callback(true)
    expect(events).to.eql([0])
  })

  it('is not published when the ffmpeg binary is missing', () => {
    const accessory = make({ ffmpegpath: '/nonexistent/ffmpeg', video_source: 'rtsp://x' })
    expect(accessory.cameraUnavailable).to.be(true)
    expect(accessory.cameraController).to.be(undefined)
    let published = false
    accessory.homeKitAccessory.publish = () => { published = true }
    accessory.publishSingleAccessory(51000)
    expect(published).to.be(false)
  })

  it('is not published when ffmpeg cannot be executed, with an actionable hint', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-')), 'ffmpeg')
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o644 })
    const rec = recordingLog()
    const accessory = make({ ffmpegpath: file, video_source: 'rtsp://x' }, rec)
    expect(accessory.cameraUnavailable).to.be(true)
    expect(accessory.cameraController).to.be(undefined)
    expect(rec.text('error')).to.contain('chmod +x ' + file)
    expect(rec.text('error')).to.contain('will not be published')
  })

  it('is not published when ffmpeg lacks the configured video encoder', () => {
    const rec = recordingLog()
    process.env.FAKE_ENCODERS = ' A..... libopus            libopus Opus'
    let accessory
    try {
      accessory = make({ ffmpegpath: FAKE, video_source: 'rtsp://x' }, rec)
    } finally {
      delete process.env.FAKE_ENCODERS
    }
    expect(accessory.cameraUnavailable).to.be(true)
    expect(rec.text('error')).to.contain('libx264')
    expect(rec.text('error')).to.contain('copy')
  })

  it('accepts copy without a video encoder', () => {
    process.env.FAKE_ENCODERS = ' A..... libopus            libopus Opus'
    let accessory
    try {
      accessory = make({ ffmpegpath: FAKE, video_source: 'rtsp://x', vcodec: 'copy' })
    } finally {
      delete process.env.FAKE_ENCODERS
    }
    expect(accessory.cameraUnavailable).to.be(undefined)
    expect(accessory.cameraController).to.be.a(hap.CameraController)
  })

  it('resolves a bare ffmpeg name via PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-'))
    fs.symlinkSync(FAKE, path.join(dir, 'hkccu-fake-ffmpeg'))
    const oldPath = process.env.PATH
    process.env.PATH = dir + path.delimiter + oldPath
    let accessory
    try {
      accessory = make({ ffmpegpath: 'hkccu-fake-ffmpeg', video_source: 'rtsp://x' })
    } finally {
      process.env.PATH = oldPath
    }
    expect(accessory.cameraUnavailable).to.be(undefined)
    expect(accessory.cameraController).to.be.a(hap.CameraController)
  })

  it('is not published without a video source', () => {
    const rec = recordingLog()
    const accessory = make({ ffmpegpath: FAKE, video_source: '  ' }, rec)
    expect(accessory.cameraUnavailable).to.be(true)
    expect(rec.text('error')).to.contain('video source')
  })

  it('offers every configuration item with a default for the new camera settings', () => {
    const items = VideoDoorBell.configurationItems()
    for (const key of ['vcodec', 'maxWidth', 'maxHeight', 'maxFPS', 'maxBitrate', 'audio', 'audio_return_target']) {
      expect(items[key]).to.have.property('default')
    }
    expect(VideoDoorBell.channelTypes()).to.eql(['SPECIAL'])
  })
})
