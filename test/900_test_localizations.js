const assert = require('assert')
const path = require('path')
const fs = require('fs')

describe('HomeKit-CCU Localization Tests', () => {
  this.regEx = /.__\('([^,][^']*)/g
  this.regExIndex = /data-localize="(.*)"/g

  const locFile = path.join(__dirname, '..', 'lib', 'configurationsrv', 'localization', 'de.json')
  if (fs.existsSync(locFile)) {
    this.localizations = JSON.parse(fs.readFileSync(locFile).toString())
    this.localizations[''] = ' ' // add a dummy
    console.log(`Using Localization from ${locFile}`)
  }

  it('HomeKit-CCU check all service files ', (done) => {
    // load the file

    const items = fs.readdirSync(path.join(__dirname, '..', 'lib', 'services'))
    items.forEach(item => {
      if (item.match(/HomeMatic.*Accessory.js/)) {
        const test = require(path.join(__dirname, '..', 'lib', 'services', item))
        const serviceDescription = test.serviceDescription()
        assert.ok(this.localizations[serviceDescription] !== undefined, `serviceDescription ${serviceDescription}  has no localization for ${item}`)
        const configurationItems = test.configurationItems()
        Object.keys(configurationItems).forEach((key) => {
          const cItem = configurationItems[key]
          // check label
          if (cItem.label !== undefined) {
            assert.ok(this.localizations[cItem.label], `Label for ${cItem.label} has no localization in ${item}`)
          }
          if (cItem.hint !== undefined) {
            // chekc hint
            assert.ok(this.localizations[cItem.hint], `Hint for ${cItem.hint} has no localization in ${item}`)
          }
        })
      }
    })
    done()
  })
})
