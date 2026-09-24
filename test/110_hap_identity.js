const path = require('path')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const { usernameFromUuid, isValidSetupCode } = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'hapIdentity.js'))

describe('HomeKit-CCU hapIdentity', () => {
  it('derives a well formed, locally administered unicast username', () => {
    const username = usernameFromUuid('00112233-4455-6677-8899-aabbccddeeff')
    expect(username).to.be('02:11:22:33:44:55')
    for (let i = 0; i < 50; i++) {
      const u = usernameFromUuid(hap.uuid.generate('door ' + i))
      expect(u).to.match(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/)
      expect('26AE').to.contain(u[1])
    }
  })

  it('is deterministic and differs between uuids', () => {
    const a = hap.uuid.generate('SPECIAL:Front door')
    const b = hap.uuid.generate('SPECIAL:Back door')
    expect(usernameFromUuid(a)).to.be(usernameFromUuid(a))
    expect(usernameFromUuid(a)).to.not.be(usernameFromUuid(b))
    expect(usernameFromUuid('ffffffff-ffff-ffff-ffff-ffffffffffff')).to.be('FE:FF:FF:FF:FF:FF')
  })

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
