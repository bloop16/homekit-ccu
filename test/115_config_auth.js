'use strict'

// Config server access control: CCU session check (on the CCU as well as in remote mode),
// same-origin CORS and the websocket hello. The service runs on a random local port.

const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { EventEmitter, once } = require('events')
const expect = require('expect.js')
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))

const ConfigurationService = require(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'))
const Rega = require(path.join(__dirname, '..', 'lib', 'HomeMaticRegaRequest.js'))

const SID = '@abcdefghij@'
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-115-'))
after(() => fs.rmSync(scratch, { recursive: true, force: true }))

const serviceLog = () => {
  const log = recordingLog()
  return { ...log, isDebugEnabled: () => false, close () {} }
}

// constructs the real service with the given config.json and environment
const setEnv = (name, value) => {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

const withEnv = (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map(name => [name, process.env[name]]))
  Object.entries(vars).forEach(([name, value]) => setEnv(name, value))
  try {
    return fn()
  } finally {
    Object.entries(saved).forEach(([name, value]) => setEnv(name, value))
  }
}

const construct = ({ config = {}, ccuHost } = {}) => {
  const configDir = fs.mkdtempSync(path.join(scratch, 'cfg-'))
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config))
  const service = withEnv({ UIX_CONFIG_PATH: configDir, UIX_CCUHOST: ccuHost }, () => new ConfigurationService(serviceLog()))
  return { service, configDir }
}

const startService = async ({ config, validSids = [SID] } = {}) => {
  const { service } = construct({ config })
  const calls = { validated: [], restarts: 0 }
  service.isValidCCUSession = async (sid) => {
    calls.validated.push(sid)
    return validSids.includes(sid)
  }
  service.restartSystem = () => { calls.restarts++; return true }
  service.heartBeat = () => {}
  service.bridges = [{ id: 'b1', displayName: 'Bridge', pincode: '031-45-154' }]
  service.configServerPort = 0
  service.configServerBind = '127.0.0.1'
  await service.run()
  if (!service.server.listening) {
    await once(service.server, 'listening')
  }
  const port = service.server.address().port
  return { service, calls, port, close: () => service.server.close() }
}

const request = (port, { method = 'GET', path: reqPath = '/', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
    let data = ''
    res.setEncoding('utf8')
    res.on('data', chunk => { data += chunk })
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
  })
  req.on('error', reject)
  if (body !== undefined) {
    req.write(body)
  }
  req.end()
})

const postApi = (port, params, headers = {}) => request(port, {
  method: 'POST',
  path: '/api/',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams(params).toString()
})

describe('HomeKit-CCU config server authentication', () => {
  describe('settings', () => {
    it('requires a CCU session by default on the CCU', () => {
      const { service } = construct()
      expect(service.isRemote).to.be(false)
      expect(service.useAuth).to.be(true)
      expect(service.ccuHost).to.be('127.0.0.1')
    })

    it('requires a CCU session by default in remote mode and remembers the CCU host', () => {
      const { service } = construct({ ccuHost: '10.0.0.5' })
      expect(service.isRemote).to.be(true)
      expect(service.useAuth).to.be(true)
      expect(service.ccuHost).to.be('10.0.0.5')
    })

    it('turns the session check off only when useCCCAuthentication is explicitly false', () => {
      expect(construct({ config: { useCCCAuthentication: false } }).service.useAuth).to.be(false)
      expect(construct({ config: { useCCCAuthentication: true } }).service.useAuth).to.be(true)
      expect(construct({ config: { useCCCAuthentication: false }, ccuHost: '10.0.0.5' }).service.useAuth).to.be(false)
    })

    it('keeps the stored authentication setting when a settings save does not carry it', () => {
      const { service, configDir } = construct({ config: { configVersion: 2 } })
      const read = () => JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'))
      withEnv({ UIX_CONFIG_PATH: configDir }, () => {
        service.saveGlobalSettings({ settings: JSON.stringify({ enableMonitoring: true }) })
        expect(read().useCCCAuthentication).to.be(undefined)
        service.saveGlobalSettings({ settings: JSON.stringify({ useAuth: false }) })
        expect(read().useCCCAuthentication).to.be(false)
        service.saveGlobalSettings({ settings: JSON.stringify({ enableMonitoring: false }) })
        expect(read().useCCCAuthentication).to.be(false)
        service.saveGlobalSettings({ settings: JSON.stringify({ useAuth: 'true' }) })
        expect(read().useCCCAuthentication).to.be(true)
        expect(read().configVersion).to.be(2)
      })
    })

    it('writes configVersion 2 with the settings, so an explicit false survives the next start', () => {
      const { service, configDir } = construct({ config: { configVersion: 2, mappings: {} } })
      const read = () => JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'))
      withEnv({ UIX_CONFIG_PATH: configDir }, () => {
        service.saveGlobalSettings({ settings: JSON.stringify({ useAuth: false }) })
        expect(read()).to.eql({ configVersion: 2, mappings: {}, useCCCAuthentication: false, useTLS: false, enableMonitoring: false, disableHistory: false })
        fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({}))
        service.saveGlobalSettings({ settings: JSON.stringify({ useAuth: false }) })
        expect(read().configVersion).to.be(2)
        expect(read().useCCCAuthentication).to.be(false)
      })
    })

    it('does not carry an old unconscious false into version 2 when the save does not set it', () => {
      // e.g. a hap-homematic backup restored while the config server is running
      const { service, configDir } = construct({ config: { configVersion: 2 } })
      fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ useCCCAuthentication: false }))
      const read = () => JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'))
      withEnv({ UIX_CONFIG_PATH: configDir }, () => {
        service.saveGlobalSettings({ settings: JSON.stringify({ enableMonitoring: true }) })
        expect(read().useCCCAuthentication).to.be(true)
        expect(read().configVersion).to.be(2)
      })
    })
  })

  describe('mapping instances', () => {
    const DEFAULT = 'b6589fc6-ab0d-4c82-8f12-099d1c2d40ab'
    const withService = (config, fn) => {
      const { service, configDir } = construct({ config })
      service.process = { send () {} }
      const read = () => JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'))
      return withEnv({ UIX_CONFIG_PATH: configDir }, () => fn(service, read))
    }

    it('moves mappings of a removed bridge to the default bridge, also when stored as an array', () => {
      withService({
        configVersion: 2,
        instances: { [DEFAULT]: { name: 'default' }, b2: { name: 'b2' } },
        mappings: { 'A:1': { instance: 'b2' }, 'B:1': { instance: ['b2'] }, 'C:1': { instance: [DEFAULT, 'b2'] }, 'D:1': { instance: DEFAULT } }
      }, (service, read) => {
        service.bridges = [{ id: DEFAULT }, { id: 'b2' }]
        service.removeInstance('b2')
        const { mappings, instances } = read()
        expect(mappings['A:1'].instance).to.be(DEFAULT)
        expect(mappings['B:1'].instance).to.be(DEFAULT)
        expect(mappings['C:1'].instance).to.be(DEFAULT)
        expect(mappings['D:1'].instance).to.be(DEFAULT)
        expect(instances.b2).to.be(undefined)
        expect(read().configVersion).to.be(2)
      })
    })

    it('stores a device assigned to one bridge with the bridge id as a string', async () => {
      const save = (service, instanceIDs) => service.saveDevice({
        name: 'Switch',
        address: 'ABC:1',
        serviceClass: 'HomeMaticSwitchAccessory',
        settings: JSON.stringify({ instanceIDs })
      })
      const { service, configDir } = construct({ config: { configVersion: 2 } })
      const read = () => JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'))
      const saved = process.env.UIX_CONFIG_PATH
      process.env.UIX_CONFIG_PATH = configDir
      try {
        expect(await save(service, { 0: 'b2' })).to.eql({ result: 'saved' })
        expect(read().mappings['ABC:1'].instance).to.be('b2')
        await save(service, { 0: 'b2', 1: DEFAULT })
        expect(read().mappings['ABC:1'].instance).to.eql(['b2', DEFAULT])
        expect(read().configVersion).to.be(2)
      } finally {
        setEnv('UIX_CONFIG_PATH', saved)
      }
    })
  })

  describe('api', () => {
    let ctx
    afterEach(() => ctx && ctx.close())

    it('answers 401 JSON to an api call without a session', async () => {
      ctx = await startService()
      const res = await postApi(ctx.port, { method: 'bridges' })
      expect(res.status).to.be(401)
      expect(res.headers['content-type']).to.contain('application/json')
      expect(JSON.parse(res.body)).to.eql({ error: 'Unauthorized' })
      expect(res.body).not.to.contain('031-45-154')
    })

    it('answers 401 to a GET api call with an invalid session', async () => {
      ctx = await startService()
      const res = await request(ctx.port, { path: '/api/?method=backup&sid=@zzzzzzzzzz@' })
      expect(res.status).to.be(401)
      expect(ctx.calls.validated).to.eql(['@zzzzzzzzzz@'])
    })

    it('serves the api call with a valid session', async () => {
      ctx = await startService()
      const res = await postApi(ctx.port, { method: 'bridges', sid: SID })
      expect(res.status).to.be(200)
      expect(JSON.parse(res.body)[0].pincode).to.be('031-45-154')
      expect(ctx.calls.validated).to.eql([SID])
    })

    it('guards every api method, including the state-changing ones', async () => {
      ctx = await startService()
      const methods = ['bridges', 'backup', 'getLog', 'restart', 'saveSettings', 'update', 'system',
        'createinstance', 'createinstancewizzard', 'removehapinstance', 'saveDevice', 'removeDevice',
        'publish', 'debug', 'support', 'changelog', 'updateChangelog', 'ccuGetDatapoints', 'unknown']
      for (const method of methods) {
        const res = await postApi(ctx.port, { method })
        expect(res.status).to.be(401)
      }
      expect(ctx.calls.restarts).to.be(0)
    })

    it('rejects a restore upload without a session', async () => {
      ctx = await startService()
      const extracted = []
      ctx.service.checkAndExtractUploadedConfig = (file) => extracted.push(file)
      const form = new FormData()
      form.append('method', 'restore')
      form.append('file', new Blob([Buffer.from('x')]), 'backup.tar.gz')
      const res = await fetch(`http://127.0.0.1:${ctx.port}/restore/`, { method: 'POST', body: form })
      expect(res.status).to.be(401)
      expect(extracted).to.have.length(0)
      expect(ctx.calls.restarts).to.be(0)
    })

    it('serves api calls without a session when useCCCAuthentication is explicitly false', async () => {
      ctx = await startService({ config: { useCCCAuthentication: false } })
      const res = await postApi(ctx.port, { method: 'bridges' })
      expect(res.status).to.be(200)
      expect(ctx.calls.validated).to.have.length(0)
    })

    it('checks a valid session once for a burst of calls, an invalid one every time', async () => {
      ctx = await startService()
      await postApi(ctx.port, { method: 'bridges', sid: SID })
      await postApi(ctx.port, { method: 'bridges', sid: SID })
      await postApi(ctx.port, { method: 'bridges', sid: '@zzzzzzzzzz@' })
      await postApi(ctx.port, { method: 'bridges', sid: '@zzzzzzzzzz@' })
      expect(ctx.calls.validated).to.eql([SID, '@zzzzzzzzzz@', '@zzzzzzzzzz@'])
    })

    it('serves static files without a session', async () => {
      ctx = await startService()
      const res = await request(ctx.port, { path: '/index.html' })
      expect(res.status).to.be(200)
    })
  })

  describe('static files', () => {
    let ctx
    beforeEach(async () => { ctx = await startService() })
    afterEach(() => ctx.close())

    it('answers 404 for a directory and keeps serving', async () => {
      for (const dir of ['/js', '/js/', '/assets']) {
        const res = await request(ctx.port, { path: dir })
        expect(res.status).to.be(404)
      }
      const res = await request(ctx.port, { path: '/index.html' })
      expect(res.status).to.be(200)
      expect(res.headers['content-type']).to.contain('text/html')
    })

    it('answers 500 and logs when the file cannot be read', async () => {
      const origCreateReadStream = fs.createReadStream
      fs.createReadStream = () => {
        const stream = new (require('stream').PassThrough)()
        setImmediate(() => stream.emit('error', new Error('EACCES: permission denied')))
        return stream
      }
      try {
        const res = await request(ctx.port, { path: '/index.html' })
        expect(res.status).to.be(500)
      } finally {
        fs.createReadStream = origCreateReadStream
      }
      expect(ctx.service.log.text('error')).to.contain('EACCES')
      const res = await request(ctx.port, { path: '/index.html' })
      expect(res.status).to.be(200)
    })
  })

  describe('cors', () => {
    let ctx
    beforeEach(async () => { ctx = await startService() })
    afterEach(() => ctx.close())

    it('rejects a foreign origin without CORS headers', async () => {
      const res = await postApi(ctx.port, { method: 'bridges', sid: SID }, { Origin: 'http://evil.example' })
      expect(res.status).to.be(403)
      expect(res.headers).not.to.have.key('access-control-allow-origin')
      expect(res.body).not.to.contain('031-45-154')
    })

    it('rejects a foreign origin even when only the port matches', async () => {
      const res = await postApi(ctx.port, { method: 'bridges', sid: SID }, { Origin: `http://evil.example:${ctx.port}` })
      expect(res.status).to.be(403)
      expect(res.headers).not.to.have.key('access-control-allow-origin')
    })

    it('rejects an opaque origin', async () => {
      const res = await postApi(ctx.port, { method: 'bridges', sid: SID }, { Origin: 'null' })
      expect(res.status).to.be(403)
    })

    it('allows the origin of the same host on another port and scheme', async () => {
      const res = await postApi(ctx.port, { method: 'bridges', sid: SID }, { Origin: 'https://127.0.0.1' })
      expect(res.status).to.be(200)
      expect(res.headers['access-control-allow-origin']).to.be('https://127.0.0.1')
    })

    it('compares the origin with the Host header, not with the address the server listens on', async () => {
      const allowed = await postApi(ctx.port, { method: 'bridges', sid: SID }, { Origin: 'http://CCU.local', Host: 'ccu.local:9874' })
      expect(allowed.status).to.be(200)
      expect(allowed.headers['access-control-allow-origin']).to.be('http://CCU.local')
      const rejected = await postApi(ctx.port, { method: 'bridges', sid: SID }, { Origin: 'http://127.0.0.1', Host: 'ccu.local:9874' })
      expect(rejected.status).to.be(403)
    })

    it('answers a preflight only for the same host', async () => {
      const foreign = await request(ctx.port, { method: 'OPTIONS', path: '/api/', headers: { Origin: 'http://evil.example' } })
      expect(foreign.status).to.be(403)
      expect(foreign.headers).not.to.have.key('access-control-allow-origin')
      const own = await request(ctx.port, { method: 'OPTIONS', path: '/api/', headers: { Origin: 'http://127.0.0.1' } })
      expect(own.status).to.be(204)
      expect(own.headers['access-control-allow-origin']).to.be('http://127.0.0.1')
    })

    it('sends no CORS headers without an Origin', async () => {
      const res = await postApi(ctx.port, { method: 'bridges', sid: SID })
      expect(res.status).to.be(200)
      expect(res.headers).not.to.have.key('access-control-allow-origin')
    })

    it('applies the same rule to the websocket endpoint', async () => {
      const foreign = await request(ctx.port, { path: '/websockets/info', headers: { Origin: 'http://evil.example' } })
      expect(foreign.status).to.be(403)
      expect(foreign.headers).not.to.have.key('access-control-allow-origin')
      const own = await request(ctx.port, { path: '/websockets/info', headers: { Origin: 'http://127.0.0.1' } })
      expect(own.status).to.be(200)
    })
  })

  describe('websocket hello', () => {
    const fakeConn = () => {
      const written = []
      return { id: 'c1', written, write: (msg) => written.push(JSON.parse(msg)) }
    }
    const makeService = (validSids) => {
      const { service } = construct()
      service.isValidCCUSession = async (sid) => validSids.includes(sid)
      service.connections = {}
      return service
    }

    it('does not register a socket without a valid session', async () => {
      const service = makeService([SID])
      const conn = fakeConn()
      await service.handleSocketRequest(conn, { command: 'hello' })
      await service.handleSocketRequest(conn, { command: 'hello', sid: '@zzzzzzzzzz@' })
      expect(service.connections).to.eql({})
      expect(conn.written.map(m => m.message)).to.eql(['unauthorized', 'unauthorized'])
    })

    it('registers a socket with a valid session', async () => {
      const service = makeService([SID])
      const conn = fakeConn()
      await service.handleSocketRequest(conn, { command: 'hello', sid: SID })
      expect(service.connections).to.have.key('c1')
      expect(conn.written[0].message).to.be('ackn')
    })
  })

  describe('session validation host', () => {
    let origScript, origRequest
    beforeEach(() => {
      origScript = Rega.prototype.script
      origRequest = http.request
    })
    afterEach(() => {
      Rega.prototype.script = origScript
      http.request = origRequest
    })

    const stubCcu = (fail = false) => {
      const hosts = { rega: [], http: [] }
      Rega.prototype.script = async function () {
        hosts.rega.push(this.ccuIP)
        return '1001;8;Admin;;;'
      }
      http.request = (options, cb) => {
        hosts.http.push(options.hostname)
        const req = new EventEmitter()
        req.write = () => {}
        req.end = () => setImmediate(() => {
          if (fail) {
            req.emit('error', new Error('ECONNREFUSED'))
            return
          }
          const res = new EventEmitter()
          cb(res)
          res.emit('data', '{}')
          res.emit('end')
        })
        return req
      }
      return hosts
    }

    it('validates against the configured CCU host in remote mode', async () => {
      const hosts = stubCcu()
      const { service } = construct({ ccuHost: '10.0.0.5' })
      expect(await service.isValidCCUSession(SID)).to.be(true)
      await new Promise(resolve => setImmediate(resolve))
      expect(hosts.rega).to.eql(['10.0.0.5'])
      expect(hosts.http).to.eql(['10.0.0.5'])
    })

    it('validates against localhost on the CCU', async () => {
      const hosts = stubCcu()
      const { service } = construct()
      expect(await service.isValidCCUSession(SID)).to.be(true)
      await new Promise(resolve => setImmediate(resolve))
      expect(hosts.rega).to.eql(['127.0.0.1'])
      expect(hosts.http).to.eql(['127.0.0.1'])
    })

    it('logs a failed session renewal instead of leaving an unhandled rejection', async () => {
      stubCcu(true)
      const { service } = construct()
      const unhandled = []
      const onUnhandled = (reason) => unhandled.push(reason)
      process.on('unhandledRejection', onUnhandled)
      try {
        expect(await service.isValidCCUSession(SID)).to.be(true)
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(unhandled).to.have.length(0)
        expect(service.log.text('warn')).to.contain('ECONNREFUSED')
      } finally {
        process.removeListener('unhandledRejection', onUnhandled)
      }
    })

    it('rejects a sid that is not in the CCU format without asking the CCU', async () => {
      const hosts = stubCcu()
      const { service } = construct()
      expect(await service.isValidCCUSession('abc')).to.be(false)
      expect(await service.isValidCCUSession(undefined)).to.be(false)
      expect(hosts.rega).to.have.length(0)
    })
  })
})
