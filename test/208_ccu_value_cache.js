'use strict'

// HomeKit reads were each sent to Rega, which runs one script at a time: when Apple Home read all
// values at once (app opened, bridge started), the later reads exceeded the 10 s of hap-nodejs and
// the devices showed "No Response". The CCU reports every change by an RPC event, so reads are
// answered from the values kept by those events; Rega is asked only for values not known yet,
// and the known datapoints are read in bulk at the start.

const path = require('path')
const expect = require('expect.js')
const HomeMaticCCU = require(path.join(__dirname, '..', 'lib', 'HomeMaticCCU.js'))
const { bulkReadScripts, parseBulkRead, FIELD_SEP: F, RECORD_SEP: R } = require(path.join(__dirname, '..', 'lib', 'util', 'regaBulkRead.js'))
const { recordingLog } = require(path.join(__dirname, 'helpers', 'recordingLog.js'))

function ccuWithRega (answer) {
  const ccu = new HomeMaticCCU(recordingLog(), { storagePath: '/tmp' })
  ccu.scripts = []
  ccu.runRega = (tag, script) => {
    ccu.scripts.push(script)
    return Promise.resolve(answer(script))
  }
  return ccu
}

describe('HomeKit-CCU value cache', () => {
  it('answers a read from the value of the last event without asking Rega', async () => {
    const ccu = ccuWithRega(() => 'false')
    ccu.setCache('HmIP-RF.000A60C9A06093:0.STICKY_UNREACH', 'true')
    expect(await ccu.getValue('HmIP-RF.000A60C9A06093:0.STICKY_UNREACH', true)).to.be('true')
    expect(ccu.scripts).to.eql([])
  })

  it('asks Rega once for a value that is not known yet, also for simultaneous reads', async () => {
    const ccu = ccuWithRega(() => '21.500000')
    const reads = [1, 2, 3].map(() => ccu.getValue('HmIP-RF.000A1D8991DA1B:1.ACTUAL_TEMPERATURE', true))
    expect(await Promise.all(reads)).to.eql(['21.500000', '21.500000', '21.500000'])
    expect(ccu.scripts.length).to.be(1)
    expect(ccu.getCache('HmIP-RF.000A1D8991DA1B:1.ACTUAL_TEMPERATURE')).to.be('21.500000')
  })

  it('asks Rega again after a failed read', async () => {
    let fail = true
    const ccu = ccuWithRega(() => { if (fail) throw new Error('socket hang up'); return 'true' })
    let error
    try { await ccu.getValue('HmIP-RF.A:1.STATE', true) } catch (e) { error = e }
    expect(error.message).to.be('socket hang up')
    fail = false
    expect(await ccu.getValue('HmIP-RF.A:1.STATE', true)).to.be('true')
  })

  it('fills the cache of all event datapoints with a few bulk scripts', async () => {
    const addresses = Array.from({ length: 120 }, (_, i) => 'HmIP-RF.DEV' + i + ':1.STATE')
    const ccu = ccuWithRega(script => {
      // echo every requested address with a value, the way the bulk script writes it
      const asked = [...script.matchAll(/GetObject\('([^']+)'\)/g)].map(m => m[1])
      return asked.map(a => a + F + (a.endsWith('7:1.STATE') ? 'true' : 'false') + R).join('')
    })
    const events = []
    ccu.fireEvent = (address, value) => events.push([address, value])
    await ccu.refreshValues(addresses)
    expect(ccu.scripts.length).to.be(Math.ceil(120 / 50))
    expect(ccu.getCache('HmIP-RF.DEV7:1.STATE')).to.be('true')
    expect(ccu.getCache('HmIP-RF.DEV8:1.STATE')).to.be('false')
    expect(events).to.eql([]) // a first value is no change: HomeKit reads it from the cache
  })

  it('only reports values that changed when refreshing', async () => {
    const ccu = ccuWithRega(() => 'HmIP-RF.A:1.STATE' + F + 'true' + R + 'HmIP-RF.B:1.STATE' + F + 'false' + R)
    ccu.setCache('HmIP-RF.A:1.STATE', 'true')
    ccu.setCache('HmIP-RF.B:1.STATE', 'true')
    const events = []
    ccu.fireEvent = (address, value) => events.push([address, value])
    await ccu.refreshValues(['HmIP-RF.A:1.STATE', 'HmIP-RF.B:1.STATE'])
    expect(events).to.eql([['HmIP-RF.B:1.STATE', 'false']])
  })
})

describe('HomeKit-CCU requery and start values', () => {
  it('asks Rega anew on a requery and passes the value on even when it is known', async () => {
    const ccu = ccuWithRega(() => 'false')
    ccu.setCache('HmIP-RF.K:1.LOCK_STATE', 'false')
    const events = []
    ccu.fireEvent = (address, value) => events.push([address, value])
    expect(await ccu.requeryValue('HmIP-RF.K:1.LOCK_STATE')).to.be('false')
    expect(ccu.scripts.length).to.be(1)
    expect(events).to.eql([['HmIP-RF.K:1.LOCK_STATE', 'false']])
  })

  it('reads the start values of all registered datapoints with one bulk script, not one each', async () => {
    const ccu = ccuWithRega(script => [...script.matchAll(/GetObject\('([^']+)'\)/g)].map(m => m[1] + F + 'true' + R).join(''))
    ccu.startValuesPending = true
    const received = []
    ;['HmIP-RF.A:1.STATE', 'HmIP-RF.B:1.STATE', 'HmIP-RF.C:1.STATE'].forEach(address => {
      ccu.registerAddressForEventProcessingAtAccessory(address, (value) => received.push([address, value]))
    })
    expect(ccu.scripts).to.eql([])
    await ccu.startValueRefresh()
    ccu.stopValueRefresh()
    expect(ccu.scripts.length).to.be(1)
    expect(received.length).to.be(3) // the accessories get their start values
    expect(ccu.startValuesPending).to.be(false)
  })

  it('gives a datapoint registered later its known value at once', () => {
    const ccu = ccuWithRega(() => 'true')
    ccu.setCache('HmIP-RF.A:1.STATE', 'true')
    const received = []
    ccu.registerAddressForEventProcessingAtAccessory('HmIP-RF.A:1.STATE', (value) => received.push(value))
    expect(received).to.eql(['true'])
    expect(ccu.scripts).to.eql([])
  })

  it('stops a bulk read that is still running when a reload stops the refresh', async () => {
    const addresses = Array.from({ length: 120 }, (_, i) => 'HmIP-RF.D' + i + ':1.STATE')
    const ccu = ccuWithRega(script => {
      ccu.stopValueRefresh() // a reload during the first script
      return [...script.matchAll(/GetObject\('([^']+)'\)/g)].map(m => m[1] + F + 'true' + R).join('')
    })
    await ccu.refreshValues(addresses, true)
    expect(ccu.scripts.length).to.be(1)
    expect(ccu.getCache('HmIP-RF.D0:1.STATE')).to.be(undefined)
  })
})

describe('HomeKit-CCU bulk read scripts', () => {
  it('reads each datapoint that exists and skips the others', () => {
    const [script] = bulkReadScripts(['HmIP-RF.A:1.STATE'])
    expect(script).to.contain("dom.GetObject('HmIP-RF.A:1.STATE')")
    expect(script).to.contain('if (o)')
  })

  it('never reads key presses, their last value would look like a new press', () => {
    expect(bulkReadScripts(['BidCos-RF.BidCoS-RF:50.PRESS_SHORT', 'HmIP-RF.K:1.PRESS_LONG', 'HmIP-RF.K:0.INSTALL_TEST'])).to.eql([])
  })

  it('never puts a quote of an address into the script', () => {
    expect(bulkReadScripts(["HmIP-RF.A:1.STATE');system.Exec('x"])).to.eql([])
  })

  it('parses values and ignores unknown or broken records', () => {
    const parsed = parseBulkRead('HmIP-RF.A:1.STATE' + F + 'true' + R + 'broken' + R + 'HmIP-RF.C:1.STATE' + F + 'x' + R + 'HmIP-RF.B:1.LEVEL' + F + '0.500000' + R, ['HmIP-RF.A:1.STATE', 'HmIP-RF.B:1.LEVEL'])
    expect(parsed).to.eql({ 'HmIP-RF.A:1.STATE': 'true', 'HmIP-RF.B:1.LEVEL': '0.500000' })
  })
})

describe('HomeKit-CCU duty cycle', () => {
  it('does not ask BidCos-RF when no device of it is in use', async () => {
    const log = recordingLog()
    const ccu = new HomeMaticCCU(log, { storagePath: '/tmp' })
    ccu.interfaces = { 1007: { id: 1007, name: 'BidCos-RF', inUse: false } }
    let asked = 0
    ccu.sendInterfaceCommand = () => { asked++; return Promise.resolve([]) }
    expect(await ccu.getCCUDutyCycle()).to.eql({})
    expect(asked).to.be(0)
    expect(log.text('warn')).to.be('')
  })

  it('reads the duty cycle of the BidCos interfaces in use', async () => {
    const ccu = new HomeMaticCCU(recordingLog(), { storagePath: '/tmp' })
    ccu.interfaces = { 1007: { id: 1007, name: 'BidCos-RF', inUse: true } }
    ccu.sendInterfaceCommand = () => Promise.resolve([{ ADDRESS: 'NEQ1234567', DUTY_CYCLE: 12 }])
    expect(await ccu.getCCUDutyCycle()).to.eql({ NEQ1234567: 12 })
  })
})
