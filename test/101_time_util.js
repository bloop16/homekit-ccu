const path = require('path')
const expect = require('expect.js')
const { nowUnix } = require(path.join(__dirname, '..', 'lib', 'util', 'time.js'))

describe('HomeKit-CCU time util', () => {
  it('returns whole seconds close to Date.now()', () => {
    const before = Math.floor(Date.now() / 1000)
    const value = nowUnix()
    const after = Math.floor(Date.now() / 1000)
    expect(Number.isInteger(value)).to.be(true)
    expect(value).to.be.within(before, after)
  })
})
