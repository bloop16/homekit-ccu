'use strict'

// After a start, Apple Home reads every value while Rega (one script at a time) reads the
// databases and the values of all devices. A thermostat whose values were not known yet asked
// Rega three times one after the other and waited behind all of that: hap-nodejs logged "didn't
// respond at all" and Apple Home showed "No Response". Every read is now answered in time, with
// the last known value when the CCU is late, and the reads of Apple Home go before the
// background work in the Rega queue.

const http = require('http')
const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { installReadBudget, BUDGET_MS } = require(path.join(__dirname, '..', 'lib', 'util', 'readBudget.js'))
const Rega = require(path.join(__dirname, '..', 'lib', 'HomeMaticRegaRequest.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

describe('HomeKit-CCU reads of Apple Home answered in time', () => {
  // a short budget for the tests; the add-on uses BUDGET_MS
  before(() => installReadBudget(Characteristic, recordingLog(), 50))
  after(() => installReadBudget(Characteristic, recordingLog(), BUDGET_MS))

  const thermostat = (read) => {
    const service = new Service.Thermostat('Küche')
    const characteristic = service.getCharacteristic(Characteristic.CurrentTemperature)
    characteristic.value = 21
    characteristic.on('get', read)
    return characteristic
  }

  it('answers the 2.5 s of the add-on, below the 3 s after which hap-nodejs warns', () => {
    expect(BUDGET_MS).to.be(2500)
  })

  it('answers with the value of the handler when it is in time', async () => {
    const characteristic = thermostat((callback) => setTimeout(() => callback(null, 23), 5))
    expect(await characteristic.handleGetRequest()).to.be(23)
  })

  it('answers with the last known value when the CCU is late, and reports the late value', async () => {
    let answer
    const characteristic = thermostat((callback) => { answer = callback })
    const changes = []
    characteristic.on('change', (change) => changes.push(change))
    const started = Date.now()
    expect(await characteristic.handleGetRequest({ remoteAddress: 'iPhone' })).to.be(21)
    expect(Date.now() - started).to.be.lessThan(1000)

    answer(null, 23)
    await wait(5)
    expect(characteristic.value).to.be(23)
    // hap-nodejs tells every device but the one that read; the read budget tells all of them
    expect(changes.map(change => [change.newValue, change.originator])).to.eql([[23, { remoteAddress: 'iPhone' }], [23, undefined]])
  })

  it('reports nothing more when the late value is the one answered', async () => {
    let answer
    const characteristic = thermostat((callback) => { answer = callback })
    const changes = []
    characteristic.on('change', (change) => changes.push(change))
    expect(await characteristic.handleGetRequest()).to.be(21)
    answer(null, 21)
    await wait(5)
    expect(changes).to.eql([])
  })

  it('keeps a late error of the handler from becoming an unhandled rejection', async () => {
    const unhandled = []
    const record = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', record)
    try {
      let answer
      const characteristic = thermostat((callback) => { answer = callback })
      expect(await characteristic.handleGetRequest()).to.be(21)
      answer(new Error('Rega timeout'))
      await wait(20)
      expect(unhandled).to.eql([])
    } finally {
      process.removeListener('unhandledRejection', record)
    }
  })

  it('passes an error of the handler in time on to Apple Home', async () => {
    const characteristic = thermostat((callback) => callback(new Error('unreachable')))
    let error
    try {
      await characteristic.handleGetRequest()
    } catch (e) {
      error = e
    }
    expect(error).to.be.ok()
  })
})

describe('HomeKit-CCU Rega queue: Apple Home before background work', () => {
  let server
  let received
  before(done => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        received.push(body)
        // the first script runs a while, as the database scripts do
        setTimeout(() => res.end(body + '<xml><exec></exec></xml>'), received.length === 1 ? 100 : 5)
      })
    })
    server.listen(0, '127.0.0.1', done)
  })
  after(done => server.close(done))
  beforeEach(() => { received = [] })

  const rega = (tag, background) => {
    const r = new Rega(recordingLog(), '127.0.0.1', tag, 2)
    r.port = server.address().port
    r.background = background
    return r
  }

  it('runs a read of Apple Home before the background work waiting, after the running script', async () => {
    const running = rega('fetchVariables', true).script('database 1', 0)
    await wait(20)
    const waiting = [
      rega('fetchPrograms', true).script('database 2', 0),
      rega('fetchRooms', true).script('database 3', 0),
      rega('getValue', false).script('read of Apple Home', 0),
      rega('setValue', false).script('command of Apple Home', 0)
    ]
    await Promise.all([running, ...waiting])
    expect(received).to.eql(['database 1', 'read of Apple Home', 'command of Apple Home', 'database 2', 'database 3'])
  })

  it('keeps the order of requests of the same kind', async () => {
    await Promise.all(['a', 'b', 'c'].map(name => rega('getValue', false).script(name, 0)))
    expect(received).to.eql(['a', 'b', 'c'])
  })
})
