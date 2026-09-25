'use strict'

// The video doorbell with the ffmpeg of the add-on and a still picture:
// - an ffmpeg installed by the add-on is used, also when the old default path is stored
// - a picture from a URL or file (e.g. the snapshot a battery camera stores) answers the
//   snapshots of Apple Home without ffmpeg; the video is only opened for live view

const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const { PNG } = require('pngjs')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const VideoDoorBell = require(path.join(__dirname, '..', 'lib', 'services', 'HomeMaticSPVideoDoorBellAccessory.js'))

const log = new Logger('HAP Test')
log.setDebugEnabled(false)

function createDoorBell (settings) {
  const server = {
    isTestMode: true,
    log,
    _ccu: { variableWithName: () => undefined, registerAddressForEventProcessingAtAccessory: () => {} }
  }
  const accessory = new VideoDoorBell({ address: 'VIDEODOORBELL:0', type: 'SPECIAL', name: 'Door' }, 'SPECIAL', server, { name: 'Door', settings })
  accessory.createHomeKitAccessory()
  accessory.publishServices(hap.Service, hap.Characteristic)
  return accessory
}

describe('HomeKit-CCU video doorbell with the ffmpeg of the add-on', () => {
  let tmp
  let installed
  const accessories = []
  const make = (settings) => {
    const accessory = createDoorBell(settings)
    accessories.push(accessory)
    return accessory
  }

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-220-'))
    fs.mkdirSync(path.join(tmp, 'addon-ffmpeg'))
    installed = path.join(tmp, 'addon-ffmpeg', 'ffmpeg')
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-ffmpeg.sh'), installed)
    fs.chmodSync(installed, 0o755)
    process.env.HOMEKIT_CCU_FFMPEG_DIR = path.join(tmp, 'addon-ffmpeg')
  })

  after(() => {
    accessories.forEach(accessory => accessory.shutdown())
    delete process.env.HOMEKIT_CCU_FFMPEG_DIR
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('takes the ffmpeg of the add-on when none is set', () => {
    const doorbell = make({ video_source: 'rtsp://cam/stream' })
    expect(doorbell.cameraUnavailable).to.not.be(true)
    expect(doorbell.cameraSettings().ffmpegPath).to.be(installed)
  })

  it('takes the ffmpeg of the add-on when the stored path has none', () => {
    const doorbell = make({ ffmpegpath: '/usr/local/bin/ffmpeg', video_source: 'rtsp://cam/stream' })
    expect(doorbell.cameraSettings().ffmpegPath).to.be(installed)
    expect(doorbell.cameraUnavailable).to.not.be(true)
  })

  it('keeps an ffmpeg of its own that exists', () => {
    const own = path.join(tmp, 'own', 'ffmpeg')
    fs.mkdirSync(path.dirname(own))
    fs.copyFileSync(installed, own)
    fs.chmodSync(own, 0o755)
    expect(make({ ffmpegpath: own, video_source: 'rtsp://cam/stream' }).cameraSettings().ffmpegPath).to.be(own)
  })

  it('offers the picture choice, from the video by default, and the ffmpeg installation', () => {
    const items = VideoDoorBell.configurationItems()
    expect(items.imageSource.array).to.eql(['From the video', 'URL', 'File on the CCU'])
    expect(items.imageSource.default).to.be('From the video')
    expect(items.image.selector).to.be('picture')
    expect(items.imageRefresh.default).to.be(10)
    expect(items.ffmpeg.type).to.be('ffmpeg')
  })

  it('answers snapshots from a configured picture without ffmpeg', async () => {
    const png = new PNG({ width: 16, height: 9 })
    png.data.fill(200)
    const server = http.createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'image/png' })
      response.end(PNG.sync.write(png))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const doorbell = make({ video_source: 'rtsp://cam/stream', imageSource: 'URL', image: 'http://127.0.0.1:' + server.address().port + '/still' })
      let ffmpegRuns = 0
      doorbell.streamingDelegate.collectStdout = () => { ffmpegRuns++; return Promise.resolve(Buffer.from('x')) }
      const jpg = await new Promise((resolve, reject) => doorbell.streamingDelegate.handleSnapshotRequest({ width: 640, height: 360 }, (error, buffer) => error ? reject(error) : resolve(buffer)))
      expect(jpg[0]).to.be(0xFF)
      expect(jpg[1]).to.be(0xD8)
      expect(ffmpegRuns).to.be(0)
    } finally {
      server.close()
    }
  })

  it('takes snapshots from the video when that is chosen', async () => {
    const doorbell = make({ video_source: 'rtsp://cam/stream' })
    let ffmpegRuns = 0
    doorbell.streamingDelegate.collectStdout = () => { ffmpegRuns++; return Promise.resolve(Buffer.from([0xFF, 0xD8])) }
    await new Promise((resolve, reject) => doorbell.streamingDelegate.handleSnapshotRequest({ width: 640, height: 360 }, (error, buffer) => error ? reject(error) : resolve(buffer)))
    expect(ffmpegRuns).to.be(1)
  })

  // HAP 11.3.2: a video doorbell requires microphone and speaker; without them Apple Home showed
  // the still image doorbell but never asked it for a snapshot (0.1.2-rc.1 on a real iPhone)
  describe('services of a video doorbell', () => {
    const services = (doorbell) => doorbell.homeKitAccessory.services.map(service => service.UUID)
    const has = (doorbell, type) => services(doorbell).includes(type.UUID)

    it('always has microphone and speaker, also without audio and talkback', () => {
      const doorbell = make({ video_source: 'rtsp://cam/stream', address_door_bell_key: 'HmIP-RF.0002DD89A1B2C3:1.PRESS_SHORT', audio: false })
      expect(has(doorbell, hap.Service.Doorbell)).to.be(true)
      expect(has(doorbell, hap.Service.Microphone)).to.be(true)
      expect(has(doorbell, hap.Service.Speaker)).to.be(true)
      // no audio is streamed nor taken
      expect(doorbell.streamingDelegate.settings.audio).to.be(false)
      expect(doorbell.streamingDelegate.settings.returnAudioTarget).to.be('')
    })

    it('streams audio and takes talkback when they are set', () => {
      const doorbell = make({ video_source: 'rtsp://cam/stream', address_door_bell_key: 'HmIP-RF.0002DD89A1B2C3:1.PRESS_SHORT', audio: true, audio_return_target: 'rtsp://cam/talk' })
      expect(has(doorbell, hap.Service.Speaker)).to.be(true)
      expect(doorbell.streamingDelegate.settings.audio).to.be(true)
    })

    it('leaves a camera without doorbell datapoint as it was', () => {
      const camera = make({ video_source: 'rtsp://cam/stream', audio: false })
      expect(has(camera, hap.Service.Doorbell)).to.be(false)
      expect(has(camera, hap.Service.Speaker)).to.be(false)
    })
  })

  // on a real CCU the source 're -f lavfi -i testsrc ...' (the - missing) was taken for a URL:
  // ffmpeg looked for a file named re and snapshot and stream failed at once
  describe('video source', () => {
    it('is a URL or ffmpeg input arguments starting with -', () => {
      ;['rtsp://cam/stream', 'rtsps://u:p@cam:322/live', 'http://cam/video.mjpg', '-re -f lavfi -i testsrc', '  -rtsp_transport tcp -i rtsp://cam  ']
        .forEach(source => expect(VideoDoorBell.validateSettings({ video_source: source })).to.be(undefined))
      ;['re -f lavfi -i testsrc', 'cam/stream', '192.168.0.10:554/live', '']
        .forEach(source => expect(VideoDoorBell.validateSettings({ video_source: source })).to.contain('URL'))
    })

    it('is checked when the video doorbell starts', () => {
      const errors = []
      const recording = Object.assign(Object.create(log), { error: (...args) => errors.push(require('util').format(...args)) })
      const server = { isTestMode: true, log: recording, _ccu: { variableWithName: () => undefined, registerAddressForEventProcessingAtAccessory: () => {} } }
      const doorbell = new VideoDoorBell({ address: 'VIDEODOORBELL:0', type: 'SPECIAL', name: 'Door' }, 'SPECIAL', server, { name: 'Door', settings: { video_source: 're -f lavfi -i testsrc' } })
      doorbell.createHomeKitAccessory()
      doorbell.publishServices(hap.Service, hap.Characteristic)
      accessories.push(doorbell)
      expect(doorbell.cameraUnavailable).to.be(true)
      expect(errors.join('\n')).to.contain('starting with -')
    })
  })
})
