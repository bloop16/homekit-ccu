'use strict'

// Reset HomeKit-CCU on the settings page (js/wizzards.js, ResetAllDialog): after the reset was
// started the page waits until the add-on went away and answers again, then loads again. The
// add-on answers until the rc.d script stopped it; after the reset its new configuration asks for
// the session again, so a refused answer (401) also means it is back.

const path = require('path')
const { pathToFileURL } = require('url')
const expect = require('expect.js')

const WIZZARDS = path.join(__dirname, '..', 'lib', 'configurationsrv', 'html', 'js', 'wizzards.js')

describe('HomeKit-CCU reset of the whole configuration on the settings page', () => {
  let ResetAllDialog
  const oldWindow = global.window
  const old$ = global.$
  const oldSetTimeout = global.setTimeout

  before(async () => {
    global.window = { location: {} }
    global.$ = () => ({})
    ;({ ResetAllDialog } = await import(pathToFileURL(WIZZARDS).href))
  })

  after(() => {
    global.window = oldWindow
    global.$ = old$
    global.setTimeout = oldSetTimeout
  })

  // runs waitForRestart against the answers in turn (an object resolves, { status } rejects) and
  // tells after how many requests the page was loaded again (undefined: never)
  const reloadAfter = async (answers) => {
    let requests = 0
    let reloadedAt
    global.window = { location: { reload: () => { reloadedAt = requests } } }
    const pending = []
    global.setTimeout = (fn) => { pending.push(fn) }
    const dialog = Object.create(ResetAllDialog.prototype)
    dialog.application = {
      makeApiRequest: () => {
        const answer = answers[Math.min(requests, answers.length - 1)]
        requests++
        return answer.status === undefined ? Promise.resolve(answer) : Promise.reject(answer)
      }
    }
    dialog.waitForRestart(false)
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setImmediate(resolve))
      const next = pending.shift()
      if (next) next()
    }
    global.setTimeout = oldSetTimeout
    return reloadedAt
  }

  it('does not load the page again while the add-on still answers before it is stopped', async () => {
    expect(await reloadAfter([[]])).to.be(undefined)
  })

  it('loads the page again once the add-on went away and answers again', async () => {
    expect(await reloadAfter([[], { status: 0 }, { status: 0 }, []])).to.be(4)
  })

  it('takes 502/503/504 of lighttpd as the add-on being away', async () => {
    expect(await reloadAfter([[], { status: 503 }, { status: 502 }, { status: 504 }, []])).to.be(5)
  })

  it('takes a refused answer of the new configuration (401) as the add-on being back', async () => {
    expect(await reloadAfter([[], { status: 503 }, { status: 401 }])).to.be(3)
  })

  it('does not load the page again for a 401 before the add-on went away', async () => {
    expect(await reloadAfter([{ status: 401 }])).to.be(undefined)
  })
})
