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

export class Network {
  constructor (sid) {
    this.sid = sid
    // API is served by lighttpd on dedicated proxy ports
    const apiPort = (window.location.protocol === 'https:') ? 49874 : 9874
    this.apiBase = window.location.protocol + '//' + window.location.hostname + ':' + apiPort
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
