const path = require('path')
const expect = require('expect.js')
const { EventChannel } = require(path.join(__dirname, '..', 'lib', 'util', 'eventChannel.js'))

describe('HomeKit-CCU event channel (long polling)', () => {
  let clock
  let channel

  beforeEach(() => {
    clock = 1000
    channel = new EventChannel({ timeoutMs: 30, maxQueue: 3, idleMs: 100, now: () => clock })
  })

  afterEach(() => channel.close())

  const poll = (id) => new Promise(resolve => channel.poll(id, resolve))

  it('answers at once with the queued messages', async () => {
    const id = channel.register()
    channel.push(id, 'a')
    channel.broadcast('b')
    expect(await poll(id)).to.eql(['a', 'b'])
  })

  it('holds a poll until a message comes, else answers [] after the timeout', async () => {
    const id = channel.register()
    const waiting = poll(id)
    setTimeout(() => channel.broadcast('late'), 5)
    expect(await waiting).to.eql(['late'])
    expect(await poll(id)).to.eql([])
  })

  it('keeps only the newest messages of a full queue', async () => {
    const id = channel.register()
    ;['1', '2', '3', '4', '5'].forEach(message => channel.push(id, message))
    expect(await poll(id)).to.eql(['3', '4', '5'])
  })

  it('answers an older poll with [] when a newer one comes', async () => {
    const id = channel.register()
    const older = poll(id)
    const newer = poll(id)
    channel.broadcast('x')
    expect(await older).to.eql([])
    expect(await newer).to.eql(['x'])
  })

  it('drops a closed poll and keeps the messages for the next one', async () => {
    const id = channel.register()
    let answered = false
    const drop = channel.poll(id, () => { answered = true })
    drop()
    channel.broadcast('kept')
    expect(answered).to.be(false)
    expect(await poll(id)).to.eql(['kept'])
  })

  it('answers an unknown client with [] and forgets idle clients', async () => {
    expect(await poll('nope')).to.eql([])
    expect(channel.has(undefined)).to.be(false)
    const idle = channel.register()
    const active = channel.register()
    clock += 200
    const waiting = poll(active)
    channel.prune()
    expect([channel.has(idle), channel.has(active)]).to.eql([false, true])
    channel.close()
    expect(await waiting).to.eql([])
    expect(channel.size).to.be(0)
  })
})
