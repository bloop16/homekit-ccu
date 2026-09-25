'use strict'

// The still image of a doorbell without camera: Apple Home shows a doorbell only as part of a
// camera, and a camera snapshot must be a JPEG in the size Apple Home asks for (HAP 11.5).
// Sources: the picture of the device in the CCU WebUI (PNG), a URL or a file.

const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const expect = require('expect.js')
const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')
const { parseDevDb, parsePictures } = require(path.join(__dirname, '..', 'lib', 'util', 'deviceIcons.js'))
const { decodeImage, renderSnapshot, renderSnapshotInWorker, loadImage, StillImage } = require(path.join(__dirname, '..', 'lib', 'util', 'doorbellImage.js'))

/** a PNG: red square with a transparent border */
function redSquarePng (size = 40, border = 10) {
  const png = new PNG({ width: size, height: size })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inside = (x >= border) && (x < size - border) && (y >= border) && (y < size - border)
      png.data[i] = 255
      png.data[i + 1] = 0
      png.data[i + 2] = 0
      png.data[i + 3] = inside ? 255 : 0
    }
  }
  return PNG.sync.write(png)
}

function pixel (image, x, y) {
  const i = (y * image.width + x) * 4
  return [image.data[i], image.data[i + 1], image.data[i + 2]]
}

const near = (actual, expected) => actual.every((value, index) => Math.abs(value - expected[index]) < 40)

describe('HomeKit-CCU doorbell still image', () => {
  let tmp
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-214-')) })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('reads the 250 pixel picture of a device type from DEVDB.tcl', () => {
    const text = 'array set DEV_PATHS       {HmIP-BSM {{50 /config/img/devices/50/PushButton-2ch-wm_thumb.png} {250 /config/img/devices/250/PushButton-2ch-wm.png}} ' +
      'HmIP-DSD-PCB {{50 /config/img/devices/50/HmIP-DSD-PCB_thumb.png} {250 /config/img/devices/250/HmIP-DSD-PCB.png}}}'
    expect(parsePictures(text)['HmIP-DSD-PCB']).to.be('/config/img/devices/250/HmIP-DSD-PCB.png')
    expect(parseDevDb(text)['HmIP-BSM']).to.be('/config/img/devices/50/PushButton-2ch-wm_thumb.png')
  })

  it('decodes PNG and JPEG, refuses anything else', () => {
    expect(decodeImage(redSquarePng()).width).to.be(40)
    const jpg = jpeg.encode({ width: 8, height: 4, data: Buffer.alloc(8 * 4 * 4, 200) }, 90).data
    expect(decodeImage(jpg).height).to.be(4)
    expect(() => decodeImage(Buffer.from('GIF89a......'))).to.throwError(/PNG or JPEG/)
    expect(() => decodeImage(Buffer.alloc(0))).to.throwError(/PNG or JPEG/)
  })

  it('refuses a PNG that declares a huge size before decoding it', () => {
    // signature, IHDR of 30000 x 30000 RGBA (3.6 GB decoded), a tiny IDAT, IEND
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(30000, 0)
    ihdr.writeUInt32BE(30000, 4)
    ihdr[8] = 8
    ihdr[9] = 6
    const chunk = (type, data) => {
      const length = Buffer.alloc(4)
      length.writeUInt32BE(data.length)
      return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)])
    }
    const bomb = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.from([0x78, 0x9C, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])), chunk('IEND', Buffer.alloc(0))])
    expect(() => decodeImage(bomb)).to.throwError(/too large/)
  })

  it('reads only picture files from a path', async () => {
    let error
    await loadImage({ kind: 'file', value: '/etc/shadow' }).catch(e => { error = e })
    expect(error.message).to.contain('.png, .jpg or .jpeg')
    error = undefined
    await loadImage({ kind: 'file', value: 'relative/bell.png' }).catch(e => { error = e })
    expect(error.message).to.contain('absolute')
  })

  it('renders a JPEG of the requested size, the picture centered on white', () => {
    const snapshot = renderSnapshot(decodeImage(redSquarePng()), 320, 180)
    expect(snapshot[0]).to.be(0xFF)
    expect(snapshot[1]).to.be(0xD8)
    const image = jpeg.decode(snapshot, { useTArray: true })
    expect([image.width, image.height]).to.eql([320, 180])
    expect(near(pixel(image, 160, 90), [255, 0, 0])).to.be(true)
    expect(near(pixel(image, 3, 3), [255, 255, 255])).to.be(true)
    // the transparent border of the PNG is white as well
    expect(near(pixel(image, 160, 12), [255, 255, 255])).to.be(true)
  })

  it('renders in a worker thread, so the add-on keeps answering meanwhile, with the same result', async () => {
    const image = decodeImage(redSquarePng())
    let ticks = 0
    const timer = setInterval(() => { ticks++ }, 1)
    const jpg = await renderSnapshotInWorker(image, 1920, 1080)
    clearInterval(timer)
    expect(Buffer.compare(jpg, renderSnapshot(image, 1920, 1080))).to.be(0)
    // the event loop ran while the worker rendered
    expect(ticks).to.be.greaterThan(0)
  })

  it('does not blow a small picture up beyond twice its size', () => {
    const image = jpeg.decode(renderSnapshot(decodeImage(redSquarePng(40, 0)), 1280, 720), { useTArray: true })
    // 40 px at most doubled: 80 px red in the middle, white 60 px left of the center
    expect(near(pixel(image, 640, 360), [255, 0, 0])).to.be(true)
    expect(near(pixel(image, 580, 360), [255, 255, 255])).to.be(true)
  })

  it('loads a file, a URL and the picture of the CCU', async () => {
    const file = path.join(tmp, 'bell.png')
    fs.writeFileSync(file, redSquarePng())
    expect((await loadImage({ kind: 'file', value: file })).width).to.be(40)

    fs.mkdirSync(path.join(tmp, 'config', 'img', 'devices', '250'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'config', 'img', 'devices', '250', 'HmIP-DSD-PCB.png'), redSquarePng(30))
    expect((await loadImage({ kind: 'ccu', value: '/config/img/devices/250/HmIP-DSD-PCB.png', wwwRoot: tmp })).width).to.be(30)

    const server = http.createServer((request, response) => {
      if (request.url === '/bell.png') {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(redSquarePng(20))
      } else {
        response.writeHead(404)
        response.end()
      }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = 'http://127.0.0.1:' + server.address().port
      expect((await loadImage({ kind: 'url', value: base + '/bell.png' })).width).to.be(20)
      let error
      await loadImage({ kind: 'url', value: base + '/missing.png' }).catch(e => { error = e })
      expect(error.message).to.contain('404')
    } finally {
      server.close()
    }
  })

  it('refuses a picture from a path outside the CCU pictures for the kind "ccu"', async () => {
    let error
    await loadImage({ kind: 'ccu', value: '/../../etc/passwd', wwwRoot: tmp }).catch(e => { error = e })
    expect(error.message).to.contain('picture')
  })

  it('falls back to a plain image when the source fails, and caches each size', async () => {
    const log = { messages: [], warn: (...args) => log.messages.push(args.join(' ')), debug: () => {} }
    const still = new StillImage([{ kind: 'file', value: path.join(tmp, 'missing.png') }], log, 'Door')
    const first = await still.snapshot(640, 360)
    const image = jpeg.decode(first, { useTArray: true })
    expect([image.width, image.height]).to.eql([640, 360])
    expect(log.messages.length).to.be(1)
    expect(await still.snapshot(640, 360)).to.be(first)
    // requests at the same time share one rendering
    const [a, b] = await Promise.all([still.snapshot(320, 240), still.snapshot(320, 240)])
    expect(a).to.be(b)
  })

  it('takes the first source that works', async () => {
    const file = path.join(tmp, 'bell.png')
    fs.writeFileSync(file, redSquarePng())
    const log = { warn: () => {}, debug: () => {} }
    const still = new StillImage([{ kind: 'file', value: path.join(tmp, 'missing.png') }, { kind: 'file', value: file }], log, 'Door')
    const image = jpeg.decode(await still.snapshot(320, 180), { useTArray: true })
    expect(near(pixel(image, 160, 90), [255, 0, 0])).to.be(true)
  })
})
