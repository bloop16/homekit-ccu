'use strict'

// The configuration service runs as a child process. When it ended, the next message to it
// failed with EPIPE, which nobody caught, and the main process with all bridges went down.

const path = require('path')
const fs = require('fs')
const os = require('os')
const net = require('net')
const EventEmitter = require('events')
const childProcess = require('child_process')
const expect = require('expect.js')
const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))

class FakeChild extends EventEmitter {
  constructor () {
    super()
    this.pid = 4711
    this.connected = true
    this.sent = []
    this.failWith = undefined
  }

  send (message, callback) {
    this.sent.push(message)
    if (callback) process.nextTick(() => callback(this.failWith))
    return true
  }

  // as node does: the channel closes, then the process ends
  die (code, signal) {
    this.connected = false
    this.emit('exit', code, signal)
  }
}

describe('HomeKit-CCU configuration service ending on its own', () => {
  const originalFork = childProcess.fork
  let children
  let log
  let server
  let clock

  beforeEach(() => {
    children = []
    childProcess.fork = () => {
      const child = new FakeChild()
      children.push(child)
      return child
    }
    log = recordingLog()
    log.isDebugEnabled = () => false
    server = new Server(log, fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-250-')))
    clock = { now: 0 }
  })

  afterEach(() => {
    childProcess.fork = originalFork
    server._shuttingDown = true
  })

  // ends the child and catches the restart timer it sets: { ms, fire }
  function end (child, code, signal) {
    const realSetTimeout = global.setTimeout
    let timer
    global.setTimeout = (fn, ms) => {
      timer = { fn, ms }
      return { unref () {} }
    }
    try {
      child.die(code, signal)
    } finally {
      global.setTimeout = realSetTimeout
    }
    return timer && { ms: timer.ms, fire: timer.fn }
  }

  it('does not throw when sending to a service that is gone', (done) => {
    server.launchUIConfigurationServer()
    const child = children[0]
    child.failWith = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    expect(() => server.publishServiceTable()).not.to.throwError()
    // node emits this without a callback; a listener keeps it from becoming an uncaught exception
    expect(() => child.emit('error', new Error('write EPIPE'))).not.to.throwError()
    setImmediate(() => {
      expect(log.text('warn')).to.contain('sending services to the configuration service failed: write EPIPE')
      done()
    })
  })

  it('sends nothing to a closed channel and publishes the service table once it is there', () => {
    server.launchUIConfigurationServer()
    children[0].connected = false
    server.publishServiceTable()
    expect(children[0].sent).to.have.length(0)
    expect(server.configpushwasSkipped).to.be(true)
  })

  it('logs the end and starts the service again', () => {
    server.launchUIConfigurationServer()
    const timer = end(children[0], 1, null)
    expect(server.configUI).to.be(undefined)
    expect(log.text('error')).to.contain('the configuration service ended (exit code 1)')
    expect(timer.ms).to.be(5000)
    timer.fire()
    expect(children).to.have.length(2)
    expect(server.configUI).to.be(children[1])
  })

  it('names the signal that ended it', () => {
    server.launchUIConfigurationServer()
    end(children[0], null, 'SIGKILL')
    expect(log.text('error')).to.contain('ended (signal SIGKILL)')
  })

  it('sends the new service the current state once it says hello', () => {
    server.serviceConfig = { 'HM-Sec-SCo': ['HomeMaticWindowAccessory'] }
    server._compatibleDevices = [{ address: 'OEQ0223493' }]
    server._ccuVariables = []
    server._bridges = []
    server._publishedAccessories = {}
    server._configuration = { VariableUpdateEvent: undefined }
    server._ccu = { getPrograms: () => [], getRooms: () => [], getFunctions: () => [], getCCUDevices: () => [] }
    log.getLogFile = () => '/var/log/homekit-ccu.log'
    server.launchUIConfigurationServer()
    end(children[0], 1, null).fire()
    server._handleIncommingIPCMessage({ topic: 'cfghello' })
    const topics = children[1].sent.map(m => m.topic)
    expect(topics).to.contain('services')
    expect(topics).to.contain('serverdata')
    expect(topics).to.contain('bridges')
    expect(topics).to.contain('virtualKeys')
    expect(topics).to.contain('compatibleObjects')
    // only once
    children[1].sent = []
    server._handleIncommingIPCMessage({ topic: 'cfghello' })
    expect(children[1].sent).to.have.length(0)
  })

  it('waits longer each time it ends quickly, and 5 s again after a stable run', () => {
    const realNow = Date.now
    Date.now = () => clock.now
    try {
      const delays = []
      server.launchUIConfigurationServer()
      for (let i = 0; i < 9; i++) {
        clock.now += 1000
        const timer = end(children[children.length - 1], 1, null)
        delays.push(timer.ms)
        timer.fire()
      }
      expect(delays).to.eql([5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000])
      clock.now += 61 * 1000
      expect(end(children[children.length - 1], 1, null).ms).to.be(5000)
    } finally {
      Date.now = realNow
    }
  })

  it('is not started again while the server shuts down', () => {
    server._ccu = { shutdown: () => {} }
    server._bridges = []
    server.launchUIConfigurationServer()
    const realSetTimeout = global.setTimeout
    // shutdown() ends the process after 2 s
    global.setTimeout = () => ({ unref () {} })
    try {
      server.shutdown()
    } finally {
      global.setTimeout = realSetTimeout
    }
    expect(end(children[0], 0, null)).to.be(undefined)
    expect(children).to.have.length(1)
  })

  it('ignores the end of a service that was already replaced', () => {
    server.launchUIConfigurationServer()
    const first = children[0]
    server.launchUIConfigurationServer()
    expect(end(first, 1, null)).to.be(undefined)
    expect(server.configUI).to.be(children[1])
  })
})

describe('HomeKit-CCU configuration service crash file', function () {
  this.timeout(20000)

  it('writes the reason of an uncaught exception next to the configuration', (done) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-250c-'))
    // the port of the service is taken, so listen() fails with an uncaught EADDRINUSE
    const blocker = net.createServer()
    const start = () => {
      const env = Object.assign({}, process.env, { UIX_CONFIG_PATH: dir })
      delete env.UIX_CCUHOST
      delete env.UIX_LOGFILE
      const child = childProcess.fork(path.join(__dirname, '..', 'lib', 'configurationsrv'), [], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      child.on('exit', (code) => {
        blocker.close()
        try {
          expect(code).to.be(1)
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.config.crash'))
          expect(files).to.have.length(1)
          expect(fs.readFileSync(path.join(dir, files[0]), 'utf8')).to.contain('EADDRINUSE')
          done()
        } catch (e) {
          done(e)
        } finally {
          fs.rmSync(dir, { recursive: true, force: true })
        }
      })
    }
    blocker.once('error', start) // already taken by something else: fine as well
    blocker.listen(39874, '127.0.0.1', start)
  })
})
