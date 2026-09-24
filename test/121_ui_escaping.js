'use strict'

const path = require('path')
const { pathToFileURL } = require('url')
const expect = require('expect.js')

const uiModule = (name) => import(pathToFileURL(path.join(__dirname, '..', 'lib', 'configurationsrv', 'html', 'js', name)).href)

describe('HomeKit-CCU configuration UI escaping', () => {
  it('escapeHtml neutralises markup and quotes', async () => {
    const { escapeHtml } = await uiModule('ui.js')
    expect(escapeHtml('<img src=x onerror="a(\'b\')">&')).to.be('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;')
    expect(escapeHtml(42)).to.be('42')
  })

  it('keeps the markup of a translation but escapes the inserted values', async () => {
    const { Localization } = await uiModule('localization.js')
    const loc = new Localization('de')
    loc.phrases = { 'Edit the device %s here': 'Bearbeite das Gerät <b>%s</b> hier' }
    expect(loc.localize('Edit the device %s here', '<img src=x onerror=alert(1)>'))
      .to.be('Bearbeite das Gerät <b>&lt;img src=x onerror=alert(1)&gt;</b> hier')
  })

  it('returns untranslated keys unchanged and fills several values in order', async () => {
    const { Localization } = await uiModule('localization.js')
    const loc = new Localization('de')
    loc.phrases = {}
    const warn = console.warn
    console.warn = () => {}
    try {
      expect(loc.localize('%s cores %s', 6, 'Intel & Co')).to.be('6 cores Intel &amp; Co')
      expect(loc.localize('Plain')).to.be('Plain')
    } finally {
      console.warn = warn
    }
  })
})
