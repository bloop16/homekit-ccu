'use strict'

// The new device dialog and the setup assistant showed the reason the configuration service
// refused a save in English also on a German page ("channel already in HomeKit"): they did not
// translate it, and de.json had none of these reasons. All dialogs translate it now.

const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const expect = require('expect.js')

const html = path.join(__dirname, '..', 'lib', 'configurationsrv', 'html')
const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'configurationsrv', 'ConfigurationService.js'), 'utf8')
const de = JSON.parse(fs.readFileSync(path.join(html, 'assets', 'de.json'), 'utf8'))
const load = () => import(pathToFileURL(path.join(html, 'js', 'saveresult.js')).href)

// the reasons the configuration service sends with a refused save
const reasons = () => {
  const found = new Set()
  for (const match of source.matchAll(/reason(?::| =) '((?:[^'\\]|\\.)*)'/g)) found.add(match[1].trim())
  const combined = source.slice(source.indexOf('  checkCombinedChannels ('), source.indexOf('  addNewMappings ('))
  for (const match of combined.matchAll(/return '((?:[^'\\]|\\.)*)'/g)) found.add(match[1])
  for (const match of source.matchAll(/^const NAME_TAKEN = '((?:[^'\\]|\\.)*)'/gm)) found.add(match[1])
  return [...found]
}

describe('HomeKit-CCU translated save reasons', () => {
  it('finds the reasons of the configuration service', () => {
    expect(reasons()).to.contain('channel already in HomeKit')
    expect(reasons()).to.contain('invalid setting')
    expect(reasons()).to.contain('invalid combination')
    expect(reasons()).to.contain('Another channel of this type already has this name on this bridge.')
  })

  it('has a German text for every reason', () => {
    expect(reasons().filter(reason => de[reason] === undefined)).to.eql([])
  })

  it('translates a reason and keeps the key of a refused setting', async () => {
    const { failureText } = await load()
    const translate = (text) => de[text] || text
    expect(failureText(translate, 'channel already in HomeKit')).to.be('Der Kanal ist schon in HomeKit.')
    expect(failureText(translate, 'invalid setting Type')).to.be('Ungültige Einstellung Type')
    expect(failureText(translate, 'something new')).to.be('something new')
  })

  it('lets the dialogs that save devices translate the reason', () => {
    ['newdevicewizzard.js', 'setupassistant.js', 'wizzards.js'].forEach(file => {
      const script = fs.readFileSync(path.join(html, 'js', file), 'utf8')
      expect(script).to.contain('failureText(this.__.bind(this), ')
      expect(script).not.to.match(/throw new Error\(\(result && result\.reason\)/)
    })
  })
})
