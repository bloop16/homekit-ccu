'use strict'

// A picture for a doorbell uploaded in the configuration UI: the session is checked before
// anything is stored, only a PNG or JPEG of at most 10 MB is kept. It goes into the configuration
// directory (so the backup has it), named by its content.

const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const crypto = require('crypto')
const expect = require('expect.js')
const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')
const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))

const png = () => {
  const image = new PNG({ width: 4, height: 4 })
  image.data.fill(128)
  return PNG.sync.write(image)
}
const jpg = () => jpeg.encode({ width: 4, height: 4, data: Buffer.alloc(64, 100) }, 80).data

function makeService ({ useAuth = false, validSession = true } = {}) {
  const service = Object.create(ConfigurationService.prototype)
  const calls = { errors: [] }
  service.log = { error: (...args) => calls.errors.push(args), warn () {}, info () {}, debug () {} }
  service.useAuth = useAuth
  service.isValidCCUSession = async () => validSession
  return { service, calls }
}

const waitFor = async (check, timeoutMs = 3000) => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function upload (service, content, name = 'bell.png') {
  const server = http.createServer((req, res) => service.processPictureUpload(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const form = new FormData()
    if (content) {
      form.append('file', new Blob([content]), name)
    }
    const res = await fetch(`http://127.0.0.1:${server.address().port}/upload/`, { method: 'POST', body: form, headers: { 'X-HomeKit-CCU-Session': '@abcdefghij@' } })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : undefined }
  } finally {
    server.close()
  }
}

describe('HomeKit-CCU picture upload', () => {
  let configDir
  let uploadDir

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-218-config-'))
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-218-upload-'))
    process.env.UIX_CONFIG_PATH = configDir
    process.env.HOMEKIT_CCU_UPLOAD_DIR = uploadDir
  })

  afterEach(() => {
    delete process.env.UIX_CONFIG_PATH
    delete process.env.HOMEKIT_CCU_UPLOAD_DIR
    fs.rmSync(configDir, { recursive: true, force: true })
    fs.rmSync(uploadDir, { recursive: true, force: true })
  })

  const stored = () => fs.existsSync(path.join(configDir, 'pictures')) ? fs.readdirSync(path.join(configDir, 'pictures')) : []
  const uploadsLeft = () => fs.readdirSync(uploadDir)

  it('rejects an invalid session with 401 before anything is stored', async () => {
    const { service } = makeService({ useAuth: true, validSession: false })
    const res = await upload(service, png())
    expect(res.status).to.be(401)
    expect(stored()).to.eql([])
    expect(uploadsLeft()).to.eql([])
  })

  it('stores a PNG in the configuration directory, named by its content', async () => {
    const { service } = makeService({ useAuth: true, validSession: true })
    const content = png()
    const res = await upload(service, content)
    expect(res.status).to.be(200)
    const name = crypto.createHash('sha256').update(content).digest('hex') + '.png'
    expect(res.body).to.eql({ path: path.join(configDir, 'pictures', name) })
    expect(fs.readFileSync(res.body.path).equals(content)).to.be(true)
    // the same picture again is the same file
    expect((await upload(service, content)).body).to.eql(res.body)
    expect(stored()).to.eql([name])
    await waitFor(() => uploadsLeft().length === 0)
  })

  it('stores a JPEG as .jpg whatever the file was called', async () => {
    const { service } = makeService()
    const res = await upload(service, jpg(), 'photo.png')
    expect(res.status).to.be(200)
    expect(res.body.path.endsWith('.jpg')).to.be(true)
  })

  it('refuses anything that is not a PNG or JPEG and keeps nothing', async () => {
    const { service, calls } = makeService()
    const res = await upload(service, Buffer.from('#!/bin/sh\necho hi\n'), 'bell.png')
    expect(res.status).to.be(400)
    expect(res.body.error).to.contain('PNG or JPEG')
    expect(stored()).to.eql([])
    await waitFor(() => uploadsLeft().length === 0)
    expect(calls.errors.length).to.be(1)
  })

  it('refuses a picture larger than 10 MB with 413', async () => {
    const { service } = makeService()
    const res = await upload(service, Buffer.concat([png(), Buffer.alloc(11 * 1024 * 1024)]))
    expect(res.status).to.be(413)
    expect(stored()).to.eql([])
  })

  it('answers 400 when no file was sent', async () => {
    const { service } = makeService()
    const res = await upload(service, undefined)
    expect(res.status).to.be(400)
  })
})
