'use strict'

/*
 * Secrets never go into the log: users attach it to support requests. A HomeKit setup code lets
 * anyone pair a bridge, a CCU session id gives full access to the CCU.
 */

const SECRET_KEYS = ['pincode', 'pin', 'pin-code', 'setupID', 'setupURI', 'password', 'sid', 'auth']
const SESSION = /@[0-9a-zA-Z]{10}@/g

/** a copy of value with the secret keys replaced by '***', for log output */
function withoutSecrets (value, depth = 0) {
  if ((value === null) || (typeof value !== 'object') || (depth > 20)) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => withoutSecrets(item, depth + 1))
  }
  const result = {}
  Object.keys(value).forEach(key => {
    result[key] = SECRET_KEYS.includes(key) ? '***' : withoutSecrets(value[key], depth + 1)
  })
  return result
}

/** text with CCU session ids and the credentials of URLs (user:password@) replaced */
function redactText (text) {
  return String(text)
    .replace(SESSION, '@***@')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
}

module.exports = { withoutSecrets, redactText }
