const path = require('path')
const expect = require('expect.js')
const { isValidSetupCode } = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'hapIdentity.js'))

describe('HomeKit-CCU hapIdentity', () => {
  it('accepts only well formed, non trivial setup codes', () => {
    expect(isValidSetupCode('482-91-736')).to.be(true)
    expect(isValidSetupCode('123-45-678')).to.be(false)
    expect(isValidSetupCode('876-54-321')).to.be(false)
    expect(isValidSetupCode('000-00-000')).to.be(false)
    expect(isValidSetupCode('999-99-999')).to.be(false)
    expect(isValidSetupCode('03145154')).to.be(false)
    expect(isValidSetupCode('031-45-15a')).to.be(false)
    expect(isValidSetupCode(undefined)).to.be(false)
  })
})
