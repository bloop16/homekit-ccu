/*
 * File: sockets.js
 * Project: homekit-ccu
 * File Created: Tuesday, 12th May 2020 5:56:08 pm
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

// Server messages by long polling (api method events, lib/util/eventChannel.js): every request
// waits on the server until messages come or 25 seconds pass, then the next one starts.
const RETRY_MS = 2000
const MAX_RETRY_MS = 30000

export class ServerEvents {
  /** request: the api call of the application (network.js makeApiRequest) */
  constructor (request) {
    this.request = request
    this.client = ''
    this.failures = 0
  }

  /** callback(events, message) for every message; once with undefined at the start */
  initSocket (callback) {
    this.callback = callback
    this.stopped = false
    callback(this, undefined)
    this.poll()
  }

  stop () {
    this.stopped = true
  }

  async poll () {
    while (!this.stopped) {
      try {
        const result = await this.request({ method: 'events', client: this.client })
        this.connected = true
        this.client = (result && result.client) || ''
        if (this.unreachable) {
          this.unreachable = false
          this.callback(this, { message: 'reachable' })
        }
        this.failures = 0
        ;((result && result.messages) || []).forEach(message => this.callback(this, message))
      } catch (e) {
        if (e && (e.status === 401)) {
          this.stopped = true
          this.callback(this, { message: 'unauthorized' })
          return
        }
        // the server restarts or the network is gone: wait a little longer each time
        this.failures += 1
        // no answer from the start: no HTTP status, or lighttpd without its config server (502-504);
        // later failures are restarts of the server
        if (e && [0, 502, 503, 504].includes(e.status) && (!this.connected) && (!this.unreachable)) {
          this.unreachable = true
          this.callback(this, { message: 'unreachable' })
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(MAX_RETRY_MS, RETRY_MS * this.failures)))
      }
    }
  }
}
