'use strict'

/*
 * The still image of a doorbell without camera. Apple Home shows a doorbell only as part of a
 * camera; the camera of such a doorbell delivers this picture as its snapshot. HomeKit wants
 * a JPEG in the size it asks for (HAP 11.5), so the picture (the device picture of the CCU is a
 * PNG with transparency) is decoded once and drawn centered on white for every size asked for.
 * Pure JavaScript (pngjs, jpeg-js): the CCU has no image tools and no ffmpeg.
 */

const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads')
const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')

const MAX_BYTES = 10 * 1024 * 1024
const MAX_PIXELS = 40 * 1000 * 1000
const URL_TIMEOUT_MS = 10000
// the picture fills at most this part of the snapshot and is never blown up more than MAX_SCALE
const FILL = 0.8
const MAX_SCALE = 2
const JPEG_QUALITY = 85
const MAX_CACHED_SIZES = 8
const WHITE = 255
const FALLBACK_GREY = 238
// the pictures of the CCU WebUI, below its web root
const CCU_PICTURE = /^\/config\/img\/devices\/250\/[\w.+-]+\.png$/

const isPng = (buffer) => buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504E47
const isJpeg = (buffer) => buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF
const PICTURE_FILE = /\.(png|jpe?g)$/i

// pngjs allocates the pixels for the size in the header before it decodes: a small PNG that
// declares a huge size must be refused before (the first chunk is IHDR with width and height)
function pngPixels (buffer) {
  if ((buffer.length < 24) || (buffer.toString('latin1', 12, 16) !== 'IHDR')) {
    throw new Error('the picture must be a PNG or JPEG file of at most 10 MB')
  }
  return buffer.readUInt32BE(16) * buffer.readUInt32BE(20)
}

/**
 * @param {Buffer} buffer the file content
 * @returns {{width: number, height: number, data: Buffer|Uint8Array}} RGBA pixels
 */
function decodeImage (buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BYTES || !(isPng(buffer) || isJpeg(buffer))) {
    throw new Error('the picture must be a PNG or JPEG file of at most 10 MB')
  }
  if (isPng(buffer) && (pngPixels(buffer) > MAX_PIXELS)) {
    throw new Error('the picture is empty or too large')
  }
  const image = isPng(buffer)
    ? PNG.sync.read(buffer)
    : jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1e6, maxMemoryUsageInMB: 256 })
  if (!(image.width > 0) || !(image.height > 0) || (image.width * image.height > MAX_PIXELS)) {
    throw new Error('the picture is empty or too large')
  }
  return { width: image.width, height: image.height, data: image.data }
}

/** the RGBA value of channel c at (x, y), bilinear between the four neighbours */
function sample (image, x, y, c) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, image.width - 1)
  const y1 = Math.min(y0 + 1, image.height - 1)
  const fx = x - x0
  const fy = y - y0
  const at = (px, py) => image.data[(py * image.width + px) * 4 + c]
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx
  return top * (1 - fy) + bottom * fy
}

/**
 * The picture centered on white, as JPEG of the requested size.
 * @param {object} image from decodeImage, undefined for a plain image
 * @param {number} width
 * @param {number} height
 * @returns {Buffer} JPEG
 */
function renderSnapshot (image, width, height) {
  const canvas = Buffer.alloc(width * height * 4, image ? WHITE : FALLBACK_GREY)
  if (image) {
    const scale = Math.min(FILL * width / image.width, FILL * height / image.height, MAX_SCALE)
    const drawWidth = Math.max(1, Math.round(image.width * scale))
    const drawHeight = Math.max(1, Math.round(image.height * scale))
    const left = Math.floor((width - drawWidth) / 2)
    const top = Math.floor((height - drawHeight) / 2)
    for (let y = 0; y < drawHeight; y++) {
      const sy = Math.min(image.height - 1, (y + 0.5) / scale - 0.5)
      for (let x = 0; x < drawWidth; x++) {
        const sx = Math.min(image.width - 1, (x + 0.5) / scale - 0.5)
        const alpha = sample(image, Math.max(0, sx), Math.max(0, sy), 3) / 255
        const i = ((top + y) * width + (left + x)) * 4
        for (let c = 0; c < 3; c++) {
          // transparent parts of the picture show the white background
          canvas[i + c] = Math.round(sample(image, Math.max(0, sx), Math.max(0, sy), c) * alpha + WHITE * (1 - alpha))
        }
      }
    }
  }
  return jpeg.encode({ width, height, data: canvas }, JPEG_QUALITY).data
}

/**
 * renderSnapshot in a worker thread: a large snapshot takes about a second on a Raspberry Pi,
 * which would stop the add-on (CCU events, HomeKit answers) meanwhile.
 * @returns {Promise<Buffer>} JPEG
 */
function renderSnapshotInWorker (image, width, height) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { image, width, height } })
    worker.once('message', (jpg) => resolve(Buffer.from(jpg)))
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error('rendering the picture stopped with code ' + code))
      }
    })
  })
}

function download (url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const request = client.get(url, { timeout: URL_TIMEOUT_MS }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error('the picture URL answered HTTP ' + response.statusCode))
        return
      }
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BYTES) {
          request.destroy(new Error('the picture at the URL is larger than 10 MB'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('the picture URL did not answer within 10 s')))
    request.on('error', reject)
  })
}

async function readLimited (file) {
  const stat = await fs.promises.stat(file)
  if (stat.size > MAX_BYTES) {
    throw new Error('the picture file is larger than 10 MB')
  }
  return fs.promises.readFile(file)
}

/**
 * Loads and decodes a picture.
 * @param {{kind: 'ccu'|'url'|'file', value: string, wwwRoot?: string}} source ccu: path of a
 *   device picture on the CCU web server (below wwwRoot, /www on the CCU); url: http(s) URL;
 *   file: path of a file
 * @returns {Promise<object>} the decoded picture
 */
async function loadImage (source) {
  const value = String((source && source.value) || '').trim()
  switch (source && source.kind) {
    case 'ccu':
      if (!CCU_PICTURE.test(value)) {
        throw new Error('not a device picture of the CCU: ' + value)
      }
      return decodeImage(await readLimited(path.join(source.wwwRoot || '/www', value)))
    case 'url':
      if (!/^https?:\/\//i.test(value)) {
        throw new Error('the picture URL must start with http:// or https://')
      }
      return decodeImage(await download(value))
    case 'file':
      if (!path.isAbsolute(value)) {
        throw new Error('the picture path must be absolute')
      }
      // the add-on runs as root: only picture files are read
      if (!PICTURE_FILE.test(value)) {
        throw new Error('the picture file must end in .png, .jpg or .jpeg')
      }
      return decodeImage(await readLimited(value))
    default:
      throw new Error('unknown picture source ' + (source && source.kind))
  }
}

/**
 * The snapshot of a doorbell: the first source that loads, otherwise a plain grey image.
 * Loaded once, one JPEG per size asked for.
 */
class StillImage {
  /**
   * @param {object[]} sources for loadImage, in order of preference
   * @param {object} log
   * @param {string} name for the log
   */
  constructor (sources, log, name) {
    this.sources = sources.filter(source => source && source.value)
    this.log = log
    this.name = name
    this.snapshots = new Map()
  }

  image () {
    if (!this.loading) {
      this.loading = this.firstImage()
    }
    return this.loading
  }

  async firstImage () {
    const reasons = []
    for (const source of this.sources) {
      try {
        return await loadImage(source)
      } catch (e) {
        reasons.push(source.kind + ': ' + e.message)
      }
    }
    this.log.warn('[Doorbell %s] no picture (%s), Apple Home shows a plain image', this.name, reasons.join('; ') || 'none configured')
    return undefined
  }

  /** @returns {Promise<Buffer>} JPEG of this size; requests of a size being rendered share it */
  snapshot (width, height) {
    const key = width + 'x' + height
    if (!this.snapshots.has(key)) {
      if (this.snapshots.size >= MAX_CACHED_SIZES) {
        this.snapshots.delete(this.snapshots.keys().next().value)
      }
      const rendering = this.image().then(image => renderSnapshotInWorker(image, width, height))
      rendering.catch(() => this.snapshots.delete(key))
      this.snapshots.set(key, rendering)
    }
    return this.snapshots.get(key)
  }
}

// the worker of renderSnapshotInWorker
if (!isMainThread && workerData && workerData.width) {
  const { image, width, height } = workerData
  parentPort.postMessage(renderSnapshot(image, width, height))
}

module.exports = { decodeImage, renderSnapshot, renderSnapshotInWorker, loadImage, StillImage }
