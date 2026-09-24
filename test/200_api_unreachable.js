const path = require('path')
const { pathToFileURL } = require('url')
const expect = require('expect.js')

const loadModule = (name) => import(pathToFileURL(path.join(__dirname, '..', 'lib', 'configurationsrv', 'html', 'js', name)).href)

describe('HomeKit-CCU configuration UI: api out of reach', () => {
  let ServerEvents

  before(async () => {
    ({ ServerEvents } = await loadModule('sockets.js'))
  })

  // answers: an error ({ status }) or a result per request; the last answer stops the polling
  const run = (answers) => new Promise((resolve) => {
    const messages = []
    let calls = 0
    const events = new ServerEvents(async () => {
      const answer = answers[calls++]
      if (calls === answers.length) {
        events.stop()
      }
      if (answer.status !== undefined) {
        throw answer
      }
      return answer
    })
    // no waiting between retries in the test
    const setTimeoutOrig = global.setTimeout
    global.setTimeout = (fn) => setTimeoutOrig(fn, 0)
    events.initSocket((socket, data) => { if (data) messages.push(data.message) })
    const wait = () => (calls >= answers.length) ? setTimeoutOrig(() => { global.setTimeout = setTimeoutOrig; resolve(messages) }, 5) : setTimeoutOrig(wait, 1)
    wait()
  })

  it('reports once that the api does not answer (certificate) and when it answers again', async () => {
    const messages = await run([{ status: 0 }, { status: 0 }, { client: 'c', messages: [{ message: 'ackn' }] }, { client: 'c', messages: [] }])
    expect(messages).to.eql(['unreachable', 'reachable', 'ackn'])
  })

  it('does not call a restart of the server unreachable', async () => {
    const messages = await run([{ client: 'c', messages: [] }, { status: 0 }, { client: 'c', messages: [] }])
    expect(messages).to.eql([])
  })

  it('still reports a missing session', async () => {
    const messages = await run([{ status: 401 }])
    expect(messages).to.eql(['unauthorized'])
  })
})
