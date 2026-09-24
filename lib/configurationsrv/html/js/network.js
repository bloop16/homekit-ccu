/*
 * File: network.js
 * Project: homekit-ccu
 * File Created: Monday, 2nd March 2020 4:59:08 pm
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

// the file name of a Content-Disposition header, with or without quotes
function fileNameOf (disposition) {
  const match = /filename="?([^";]+)"?/i.exec(disposition || '')
  return match ? match[1].trim() : 'homekit-ccu-backup'
}

export class Network {
  constructor (sid) {
    this.sid = sid
    // the api is next to this page (same host, port and directory): on the CCU lighttpd passes
    // /addons/homekit-ccu/api/ to the config server, in remote mode that server serves the page
    this.apiBase = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '')
  }

  makeApiRequest (data, type = 'json') {
    data.sid = this.sid
    return new Promise((resolve, reject) => {
      $.ajax({
        dataType: 'text',
        url: this.apiBase + '/api/',
        data,
        method: 'POST',
        success: (responseText) => {
          let responseData = responseText
          if (type === 'json') {
            try {
              responseData = responseText ? JSON.parse(responseText) : {}
            } catch (e) {
              responseData = {}
            }
          }
          resolve(responseData)
        },
        error: (error) => {
          console.warn('API request %s failed: %s %s', data.method, error.status, error.statusText)
          reject(error)
        }
      })
    })
  }

  // A file of the api (backup, log, support data), requested like every other api call.
  // Not a submitted form or any other non-cors request: OpenCCU sends "Referrer-Policy:
  // no-referrer", and for a POST that is not in cors mode the browser then sends
  // "Origin: null" (Fetch standard, "append a request Origin header"), which the config
  // server refuses. fetch runs in cors mode by default, like the XHR of makeApiRequest.
  async downloadFile (params) {
    const response = await fetch(this.apiBase + '/api/', {
      method: 'POST',
      mode: 'cors',
      credentials: 'same-origin',
      body: new URLSearchParams({ ...params, sid: this.sid })
    })
    if (!response.ok) {
      const error = new Error('download ' + params.method + ' failed: ' + response.status + ' ' + response.statusText)
      error.status = response.status
      throw error
    }
    return { blob: await response.blob(), filename: fileNameOf(response.headers.get('Content-Disposition')) }
  }

  // a file upload (restore): the server checks the session header before it stores anything
  makeFormRequest (url, form) {
    return new Promise((resolve, reject) => {
      $.ajax({
        url: this.apiBase + url,
        headers: { 'X-HomeKit-CCU-Session': this.sid },
        data: form,
        method: 'POST',
        contentType: false,
        processData: false,
        success: (responseData) => {
          resolve(responseData)
        },
        error: (error) => {
          console.warn('Request %s failed: %s %s', url, error.status, error.statusText)
          reject(error)
        }
      })
    })
  }
}
