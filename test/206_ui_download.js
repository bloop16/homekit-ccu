'use strict'

// Backup, log and support downloads were refused with 403: they submitted a hidden form, and
// because OpenCCU sends "Referrer-Policy: no-referrer" a browser sends "Origin: null" with any
// POST that is not in cors mode, which the origin check of the config server rejects. In cors
// mode (like the XHR of all other api calls) the real Origin is sent.

const path = require('path')
const { pathToFileURL } = require('url')
const expect = require('expect.js')

const ROOT = path.join(__dirname, '..')

describe('HomeKit-CCU downloads of the configuration UI', () => {
  let Network
  const oldWindow = global.window
  const oldFetch = global.fetch

  before(async () => {
    ({ Network } = await import(pathToFileURL(path.join(ROOT, 'lib', 'configurationsrv', 'html', 'js', 'network.js')).href))
  })

  beforeEach(() => {
    global.window = { location: new URL('https://ccu.local/addons/homekit-ccu/index.html?sid=@abc@') }
  })

  after(() => {
    global.window = oldWindow
    global.fetch = oldFetch
  })

  it('fetches the file from the api of its own origin with the session in the body', async () => {
    const requests = []
    global.fetch = async (url, options) => {
      requests.push({ url, options })
      return new Response('log text', { status: 200, headers: { 'Content-Disposition': 'attachment; filename=homekit-ccu-log.txt' } })
    }
    const file = await new Network('@abc@').downloadFile({ method: 'getLog' })

    expect(requests.length).to.be(1)
    expect(requests[0].url).to.be('https://ccu.local/addons/homekit-ccu/api/')
    expect(requests[0].options.method).to.be('POST')
    expect(requests[0].options.mode).to.be('cors')
    const body = new URLSearchParams(requests[0].options.body)
    expect(body.get('method')).to.be('getLog')
    expect(body.get('sid')).to.be('@abc@')
    expect(requests[0].url).not.to.contain('abc') // the session never goes into the URL
    expect(file.filename).to.be('homekit-ccu-log.txt')
    expect(await file.blob.text()).to.be('log text')
  })

  it('takes quoted file names and falls back to a name of its own', async () => {
    global.fetch = async () => new Response('x', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="HmIP-SWDO 0001.json"' } })
    expect((await new Network('s').downloadFile({ method: 'support', address: 'A' })).filename).to.be('HmIP-SWDO 0001.json')
    global.fetch = async () => new Response('x', { status: 200 })
    expect((await new Network('s').downloadFile({ method: 'backup' })).filename).to.be('homekit-ccu-backup')
  })

  it('fails with the status of a refused request', async () => {
    global.fetch = async () => new Response('{"error":"Forbidden"}', { status: 403, statusText: 'Forbidden' })
    let error
    try {
      await new Network('s').downloadFile({ method: 'backup' })
    } catch (e) {
      error = e
    }
    expect(error.status).to.be(403)
  })
})
