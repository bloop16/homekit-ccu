const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const expect = require('expect.js')

// point the restart at a scratch location before the module reads it
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-107-'))
const rcdScript = path.join(scratch, 'homekit-ccu')
process.env.HOMEKIT_CCU_RCD = rcdScript
const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))

const makeService = ({ useAuth = false, validSession = true } = {}) => {
  // bypass the constructor: it reads the real settings from UIX_CONFIG_PATH
  const service = Object.create(ConfigurationService.prototype)
  const calls = { errors: [], extracted: [], restarts: 0 }
  service.log = {
    error: (...args) => calls.errors.push(args),
    warn () {},
    info () {},
    debug () {}
  }
  service.useAuth = useAuth
  service.isValidCCUSession = async () => validSession
  service.checkAndExtractUploadedConfig = (file) => {
    calls.extracted.push({ file, existed: fs.existsSync(file) })
    return true
  }
  service.restartSystem = () => { calls.restarts++ }
  return { service, calls }
}

const postRestore = async (service, fileCount = 1) => {
  const server = http.createServer((req, res) => service.processRestore(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const form = new FormData()
    form.append('method', 'restore')
    for (let i = 0; i < fileCount; i++) {
      form.append('file', new Blob([Buffer.from('not really a tarball ' + i)]), `backup${i}.tar.gz`)
    }
    const res = await fetch(`http://127.0.0.1:${server.address().port}/restore/`, { method: 'POST', body: form, headers: { 'X-HomeKit-CCU-Session': '@abcdefghij@' } })
    return { status: res.status, body: await res.text() }
  } finally {
    server.close()
  }
}

const waitFor = async (check, timeoutMs = 3000) => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

after(() => fs.rmSync(scratch, { recursive: true, force: true }))

describe('HomeKit-CCU ConfigurationService.processRestore', () => {
  let uploadDir

  beforeEach(() => {
    uploadDir = fs.mkdtempSync(path.join(scratch, 'upload-'))
    process.env.HOMEKIT_CCU_UPLOAD_DIR = uploadDir
  })

  afterEach(() => {
    delete process.env.HOMEKIT_CCU_UPLOAD_DIR
  })

  const uploadDirIsEmpty = () => fs.readdirSync(uploadDir).length === 0

  it('rejects an invalid session with 401 before anything is stored', async () => {
    const { service, calls } = makeService({ useAuth: true, validSession: false })
    const res = await postRestore(service)
    expect(res.status).to.be(401)
    expect(calls.extracted).to.have.length(0)
    expect(calls.restarts).to.be(0)
    expect(uploadDirIsEmpty()).to.be(true)
  })

  it('refuses a second restore while one runs', async () => {
    const { service } = makeService({ useAuth: true, validSession: true })
    service.restoreRunning = true
    const res = await postRestore(service)
    expect(res.status).to.be(409)
  })

  it('extracts the upload and restarts on a valid session', async () => {
    const { service, calls } = makeService({ useAuth: true, validSession: true })
    const res = await postRestore(service)
    expect(res.status).to.be(200)
    expect(calls.extracted).to.have.length(1)
    expect(calls.extracted[0].existed).to.be(true)
    expect(calls.restarts).to.be(1)
    await waitFor(() => !fs.existsSync(calls.extracted[0].file))
    await waitFor(uploadDirIsEmpty)
  })

  it('answers 200 and logs an error when no file was uploaded', async () => {
    const { service, calls } = makeService()
    const res = await postRestore(service, 0)
    expect(res.status).to.be(200)
    expect(calls.extracted).to.have.length(0)
    expect(calls.restarts).to.be(0)
    expect(calls.errors.map(args => args[0])).to.contain('[Config] restore: no file in upload')
  })

  it('rejects a second file with 413 and leaves no uploaded file behind', async () => {
    const { service, calls } = makeService()
    const res = await postRestore(service, 2)
    expect(res.status).to.be(413)
    expect(calls.extracted).to.have.length(0)
    expect(calls.restarts).to.be(0)
    await waitFor(uploadDirIsEmpty)
  })
})

describe('HomeKit-CCU ConfigurationService.restartSystem', () => {
  const makeBare = () => {
    const service = Object.create(ConfigurationService.prototype)
    const errors = []
    service.log = { error: (...args) => errors.push(args), info () {}, debug () {} }
    return { service, errors }
  }

  it('reports that restart is unavailable without the rc.d script', () => {
    const { service, errors } = makeBare()
    expect(service.restartSystem()).to.be(false)
    expect(errors[0][0]).to.contain('restart not available')
  })

  it('runs the rc.d script with restart', async function () {
    this.timeout(5000)
    const marker = path.join(scratch, 'called')
    fs.writeFileSync(rcdScript, `#!/bin/sh\necho "$1" > "${marker}"\n`, { mode: 0o755 })
    const { service, errors } = makeBare()
    expect(service.restartSystem()).to.be(true)
    await waitFor(() => fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === 'restart')
    expect(errors).to.have.length(0)
  })
})

describe('HomeKit-CCU ConfigurationService API restart', () => {
  const callApi = async (query, restartResult) => {
    const service = Object.create(ConfigurationService.prototype)
    service.log = { error () {}, info () {}, debug () {} }
    service.useAuth = false
    service.saveGlobalSettings = () => {}
    let restarts = 0
    service.restartSystem = () => { restarts++; return restartResult }
    const response = {
      headersSent: false,
      writeHead () { this.headersSent = true },
      end (body) { this.body = body }
    }
    await service.processApiCall(query, response)
    return { json: JSON.parse(response.body), restarts }
  }

  it('reports ok when the restart was scheduled', async () => {
    for (const method of ['restart', 'saveSettings']) {
      const { json, restarts } = await callApi({ method }, true)
      expect(json).to.eql({ response: 'ok' })
      expect(restarts).to.be(1)
    }
  })

  it('reports an error when restart is not available', async () => {
    for (const method of ['restart', 'saveSettings']) {
      const { json } = await callApi({ method }, false)
      expect(json).to.eql({ error: 'restart not available' })
    }
  })

  it('has no update methods (updates come from the CCU addon installer)', async () => {
    for (const method of ['update', 'updateChangelog']) {
      const { json, restarts } = await callApi({ method }, true)
      expect(json).to.eql({ error: 'unknown method' })
      expect(restarts).to.be(0)
    }
    expect(ConfigurationService.prototype.updateSystem).to.be(undefined)
  })
})
