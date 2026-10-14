'use strict'

// The handshake of HomeKit (pair verify) with native crypto instead of tweetnacl in JavaScript: on a
// Raspberry Pi one took about 115 ms, and the handshakes of all Apple devices with all bridges after a
// start kept the add-on busy for some 15 seconds (Rega answers and reads of Apple Home waited). The
// native functions must give the same results as those of tweetnacl they replace.

const path = require('path')
const crypto = require('crypto')
const expect = require('expect.js')
const { installNativeHapCrypto, originalTweetnacl, hapTweetnacl } = require(path.join(__dirname, '..', 'lib', 'util', 'nativeHapCrypto.js'))

const ROUNDS = 25
const bytes = (n) => new Uint8Array(crypto.randomBytes(n))
const same = (a, b) => expect(Buffer.from(a).equals(Buffer.from(b))).to.be(true)

describe('HomeKit-CCU native crypto for the HomeKit handshake', () => {
  let nacl
  let original

  before(() => {
    nacl = hapTweetnacl()
    expect(installNativeHapCrypto(nacl)).to.be(true)
    original = originalTweetnacl(nacl)
  })

  it('replaces the functions in the tweetnacl of hap-nodejs, once', () => {
    const hapCrypto = require(path.join(path.dirname(require.resolve('@homebridge/hap-nodejs')), 'lib', 'util', 'hapCrypto.js'))
    const fromHap = hapCrypto.generateCurve25519KeyPair
    expect(nacl.box.keyPair).not.to.be(original.boxKeyPair)
    expect(nacl.sign.detached).not.to.be(original.sign)
    expect(installNativeHapCrypto(nacl)).to.be(true)
    expect(originalTweetnacl(nacl)).to.be(original)
    // hap-nodejs calls into the module at call time: it gets the native key pair
    expect(fromHap().secretKey).to.have.length(32)
  })

  it('signs like tweetnacl (Ed25519 signatures are deterministic)', () => {
    for (let i = 0; i < ROUNDS; i++) {
      const key = nacl.sign.keyPair()
      const msg = bytes(i * 13)
      same(nacl.sign.detached(msg, key.secretKey), original.sign(msg, key.secretKey))
    }
  })

  it('verifies like tweetnacl: a good signature, a changed message, another key', () => {
    for (let i = 0; i < ROUNDS; i++) {
      const key = nacl.sign.keyPair()
      const other = nacl.sign.keyPair()
      const msg = bytes(64)
      const sig = original.sign(msg, key.secretKey)
      const changed = Uint8Array.from(msg)
      changed[i % 64] ^= 1
      expect(nacl.sign.detached.verify(msg, sig, key.publicKey)).to.be(true)
      expect(nacl.sign.detached.verify(changed, sig, key.publicKey)).to.be(false)
      expect(nacl.sign.detached.verify(msg, sig, other.publicKey)).to.be(false)
    }
  })

  it('answers a public key that is no point on the curve like tweetnacl', () => {
    const key = nacl.sign.keyPair()
    const msg = bytes(32)
    const sig = original.sign(msg, key.secretKey)
    for (let i = 0; i < ROUNDS; i++) {
      const pub = bytes(32)
      expect(nacl.sign.detached.verify(msg, sig, pub)).to.be(original.verify(msg, sig, pub))
    }
  })

  it('makes X25519 key pairs whose public key belongs to the secret key', () => {
    for (let i = 0; i < ROUNDS; i++) {
      const pair = nacl.box.keyPair()
      expect(pair.publicKey).to.have.length(32)
      expect(pair.secretKey).to.have.length(32)
      same(pair.publicKey, nacl.scalarMult.base(pair.secretKey))
    }
    // the functions hanging off keyPair stay
    expect(nacl.box.keyPair.fromSecretKey).to.be.a('function')
  })

  it('computes the shared X25519 key like tweetnacl, also for a point of small order', () => {
    for (let i = 0; i < ROUNDS; i++) {
      const n = bytes(32)
      const p = nacl.box.keyPair().publicKey
      same(nacl.scalarMult(n, p), original.scalarMult(n, p))
    }
    const n = bytes(32)
    same(nacl.scalarMult(n, new Uint8Array(32)), original.scalarMult(n, new Uint8Array(32)))
  })

  it('both sides of a handshake get the same shared key, as hap-nodejs computes it', () => {
    const hapCrypto = require(path.join(path.dirname(require.resolve('@homebridge/hap-nodejs')), 'lib', 'util', 'hapCrypto.js'))
    const accessory = hapCrypto.generateCurve25519KeyPair()
    const controller = original.boxKeyPair()
    same(hapCrypto.generateCurve25519SharedSecKey(accessory.secretKey, controller.publicKey),
      original.scalarMult(controller.secretKey, accessory.publicKey))
  })

  it('does nothing for a hap-nodejs without tweetnacl, which does this crypto natively itself', () => {
    const fs = require('fs')
    const os = require('os')
    // a directory with no tweetnacl in it or above it
    const hapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkccu-243-'))
    try {
      expect(hapTweetnacl(hapDir)).to.be(undefined)
      expect(installNativeHapCrypto(hapTweetnacl(hapDir))).to.be(true)
    } finally {
      fs.rmSync(hapDir, { recursive: true, force: true })
    }
  })

  it('leaves a call with wrong key lengths to tweetnacl, with its error', () => {
    const msg = bytes(16)
    expect(() => nacl.sign.detached(msg, bytes(32))).to.throwError(/bad secret key size/)
    expect(() => nacl.sign.detached.verify(msg, bytes(10), bytes(32))).to.throwError(/bad signature size/)
    expect(() => nacl.scalarMult(bytes(31), bytes(32))).to.throwError(/bad n size/)
  })
})
