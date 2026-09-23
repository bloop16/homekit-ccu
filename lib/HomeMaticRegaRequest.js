/*
 * File: HomeMaticRegaRequest.js
 * Project: homekit-ccu
 * File Created: Saturday, 7th March 2020 2:30:06 pm
 * Author: Thomas Kluge (th.kluge@me.com)
 * -----
 * The MIT License (MIT)
 *
 * Copyright (c) Thomas Kluge <th.kluge@me.com> (https://github.com/thkl)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * ==========================================================================
 */
'use strict'

const http = require('http')

// Module-level queue shared across all instances — Rega is single-threaded,
// concurrent requests cause socket hang-ups.
const _regaQueue = []
let _regaRunning = false
const _DRAIN_DELAY = 150 // ms pause between consecutive Rega requests

function _enqueue (fn) {
  return new Promise((resolve, reject) => {
    _regaQueue.push({ fn, resolve, reject })
    _drain()
  })
}

function _drain () {
  if (_regaRunning || _regaQueue.length === 0) return
  _regaRunning = true
  const entry = _regaQueue.shift()
  entry.fn().then(
    (result) => {
      _regaRunning = false
      entry.resolve(result)
      setTimeout(_drain, _DRAIN_DELAY)
    },
    (err) => {
      _regaRunning = false
      // Rega is down — reject all remaining queued requests instead of
      // trying each one and flooding the log with retries
      while (_regaQueue.length > 0) {
        _regaQueue.shift().reject(err)
      }
      entry.reject(err)
    }
  )
}

class HomeMaticRegaRequest {
  constructor (log, ccuIP = '127.0.0.1', tag = 'Common', timeout = 120) {
    this.log = log
    this.isRemote = ccuIP && ccuIP !== '127.0.0.1'
    this.ccuIP = ccuIP
    this.tag = tag
    this.timeout = timeout
  }

  _attempt (script) {
    const self = this
    return new Promise((resolve, reject) => {
      const postOptions = {
        host: this.ccuIP,
        port: this.isRemote ? '8181' : '8183',
        path: '/tclrega.exe',
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(script),
          Connection: 'close'
        }
      }

      let postReq
      try {
        postReq = http.request(postOptions, (res) => {
          let data = ''
          res.setEncoding('binary')
          res.on('data', (chunk) => { data += chunk.toString() })
          res.on('end', () => {
            const pos = data.lastIndexOf('<xml><exec>')
            const response = data.substring(0, pos)
            self.log.debug('[Rega] [%s] result is %s', self.tag, response)
            resolve(response)
          })
        })
      } catch (e) {
        self.log.debug('[Rega] [%s] attempt failed fir script %s', self.tag, script)
        self.log.error(e)
        reject(new Error('Rega request Error'))
        return
      }

      postReq.on('error', (e) => { reject(e) })
      postReq.on('timeout', () => {
        postReq.destroy()
        reject(new Error('TimeOut'))
      })
      postReq.setTimeout(this.timeout * 1000)
      postReq.write(script)
      postReq.end()
    })
  }

  script (script, retries = 3, retryDelay = 5) {
    const self = this
    self.log.debug('[Rega] [%s] RegaScript %s', self.tag, script)
    return _enqueue(async () => {
      let lastError
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await self._attempt(script)
        } catch (e) {
          lastError = e
          if (attempt < retries) {
            self.log.warn('[Rega] [%s] script failed (%s), retrying in %ds (attempt %d/%d): %s', self.tag, e.message, retryDelay, attempt + 1, retries, script)
            await new Promise(resolve => setTimeout(resolve, retryDelay * 1000))
          }
        }
      }
      self.log.error('[Rega] [%s] script failed after %d retries: %s', self.tag, retries, lastError.message)
      throw lastError
    })
  }

  setValue (hmadr, value) {
    const self = this
    return new Promise((resolve, reject) => {
      // check explicitDouble
      if (typeof value === 'object') {
        const v = value.explicitDouble
        if (v !== undefined) {
          value = v
        }
      }
      self.log.debug('[Rega] [%s] SetValue %s of %s', self.tag, value, hmadr.address())
      const script = 'var d = dom.GetObject("' + hmadr.address() + '");if (d){d.State("' + value + '");}'
      self.script(script).then(data => resolve(data)).catch(err => reject(err))
    })
  }

  setVariable (channel, value) {
    return new Promise((resolve, reject) => {
      const script = 'var d = dom.GetObject("' + channel + '");if (d){d.State("' + value + '");}'
      this.script(script).then(data => resolve(data)).catch(err => reject(err))
    })
  }

  getVariable (channel) {
    return new Promise((resolve, reject) => {
      const script = 'var d = dom.GetObject("' + channel + '");if (d){Write(d.State());}'
      this.script(script).then(data => resolve(data)).catch(err => reject(err))
    })
  }

  isInt (n) {
    return Number(n) === n && n % 1 === 0
  }

  isFloat (n) {
    return n === Number(n) && n % 1 !== 0
  }
}

module.exports = HomeMaticRegaRequest
