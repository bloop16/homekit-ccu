'use strict'

/*
 * Native crypto for the handshake of HomeKit (pair verify). hap-nodejs does its X25519 and Ed25519 with
 * tweetnacl, in JavaScript: on a Raspberry Pi one handshake takes about 115 ms (verifying a signature
 * alone 66 ms), with Node's crypto (OpenSSL) about 2 ms. After a start every Apple device connects to
 * every bridge at once, and these handshakes kept the add-on busy for some 15 seconds: Rega answers and
 * the reads of Apple Home waited, devices showed "No Response".
 *
 * The functions hap-nodejs calls on every handshake are replaced in the tweetnacl module it loads; they
 * give the same results (Ed25519 signatures are deterministic). sign.keyPair, used once for the key of a
 * bridge, stays as it is. A call that native crypto does not take (e.g. a wrong key length) goes to the
 * original function, which keeps its errors.
 */

const crypto = require('crypto')
const path = require('path')

// DER of a raw 32-byte key (RFC 8410)
const ED25519_PRIVATE = Buffer.from('302e020100300506032b657004220420', 'hex')
const ED25519_PUBLIC = Buffer.from('302a300506032b6570032100', 'hex')
const X25519_PRIVATE = Buffer.from('302e020100300506032b656e04220420', 'hex')
const X25519_PUBLIC = Buffer.from('302a300506032b656e032100', 'hex')

const ORIGINAL = Symbol('homekit-ccu original tweetnacl')

const privateKey = (prefix, raw) => crypto.createPrivateKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'pkcs8' })
const publicKey = (prefix, raw) => crypto.createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' })
const raw32 = (keyObject, type) => new Uint8Array(keyObject.export({ format: 'der', type }).subarray(-32))

/**
 * The tweetnacl module hap-nodejs loads; undefined when there is none: a hap-nodejs that does this crypto
 * natively itself no longer depends on tweetnacl, and it is not installed then.
 */
function hapTweetnacl (hapDir = path.dirname(require.resolve('@homebridge/hap-nodejs'))) {
  try {
    return require(require.resolve('tweetnacl', { paths: [hapDir] }))
  } catch (e) {
    return undefined
  }
}

/**
 * Puts native crypto into tweetnacl (the one of hap-nodejs unless given). Returns false when Node has no
 * Ed25519/X25519; once installed, a second call changes nothing. Without tweetnacl (a hap-nodejs with native
 * crypto) there is nothing to do.
 */
function installNativeHapCrypto (nacl = hapTweetnacl()) {
  if ((!nacl) || (nacl[ORIGINAL])) {
    return true
  }
  try {
    crypto.generateKeyPairSync('ed25519')
    crypto.generateKeyPairSync('x25519')
  } catch (e) {
    return false
  }
  const original = {
    boxKeyPair: nacl.box.keyPair,
    scalarMult: nacl.scalarMult,
    sign: nacl.sign.detached,
    verify: nacl.sign.detached.verify
  }

  const boxKeyPair = () => {
    const pair = crypto.generateKeyPairSync('x25519')
    return { publicKey: raw32(pair.publicKey, 'spki'), secretKey: raw32(pair.privateKey, 'pkcs8') }
  }
  // the box functions of tweetnacl hang off keyPair (keyPair.fromSecretKey)
  Object.assign(boxKeyPair, original.boxKeyPair)

  const scalarMult = (n, p) => {
    if ((!n) || (!p) || (n.length !== 32) || (p.length !== 32)) {
      return original.scalarMult(n, p)
    }
    try {
      return new Uint8Array(crypto.diffieHellman({ privateKey: privateKey(X25519_PRIVATE, n), publicKey: publicKey(X25519_PUBLIC, p) }))
    } catch (e) {
      // OpenSSL refuses a point of small order (all-zero result), tweetnacl returns the zeros
      return original.scalarMult(n, p)
    }
  }
  Object.assign(scalarMult, original.scalarMult)

  const sign = (msg, secretKey) => {
    if ((!msg) || (!secretKey) || (secretKey.length !== 64)) {
      return original.sign(msg, secretKey)
    }
    // a secret key of tweetnacl is the seed and the public key
    return new Uint8Array(crypto.sign(null, msg, privateKey(ED25519_PRIVATE, secretKey.subarray(0, 32))))
  }
  sign.verify = (msg, sig, pub) => {
    if ((!msg) || (!sig) || (!pub) || (sig.length !== 64) || (pub.length !== 32)) {
      return original.verify(msg, sig, pub)
    }
    try {
      return crypto.verify(null, msg, publicKey(ED25519_PUBLIC, pub), sig)
    } catch (e) {
      return false // not a point on the curve
    }
  }

  nacl.box.keyPair = boxKeyPair
  nacl.scalarMult = scalarMult
  nacl.sign.detached = sign
  nacl[ORIGINAL] = original
  return true
}

/** the replaced functions, for the tests */
function originalTweetnacl (nacl = hapTweetnacl()) {
  return nacl[ORIGINAL]
}

module.exports = { installNativeHapCrypto, originalTweetnacl, hapTweetnacl }
