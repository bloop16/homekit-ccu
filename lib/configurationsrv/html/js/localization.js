/*
 * File: localization.js
 * Project: homekit-ccu
 * File Created: Friday, 6th March 2020 7:43:51 pm
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

import { escapeHtml } from './ui.js'

export class Localization {
  constructor (language) {
    if (language === undefined) {
      language = (navigator.language || navigator.userLanguage).toLowerCase()
      language = language.slice(0, 2)
    }
    this.language = language
    // lets the browser hyphenate and read the page in the right language
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language
    }
  }

  init () {
    const self = this
    return new Promise((resolve, reject) => {
      self.phrases = {}
      fetch('./assets/' + self.language + '.json')
        .then(resp => resp.ok ? resp.json() : null)
        .then(result => {
          if (result) {
            self.phrases = result
          } else {
            console.log('Unable to load localization will use default')
          }
          resolve()
        })
        .catch(() => {
          console.log('Unable to load localization')
          resolve()
        })
    })
  }

  localizePage () {
    const self = this

    const elements = $('[data-localize]')

    elements.each((i) => {
      const element = $(elements[i])
      const key = element.attr('data-localize')
      if ((key) && (key !== '')) {
        const value = self.localize(key)
        element.html(value)
      }
    })
  }

  localize () {
    const args = Array.prototype.slice.call(arguments)
    let msg = args[0]
    if (this.phrases) {
      if ((this.phrases[msg] === undefined) && (msg !== undefined) && (msg !== '')) {
        console.warn('No translation for ' + msg)
      }

      msg = this.phrases[msg] || msg
    }
    const rep = args.slice(1, args.length)
    if (rep.length > 0) {
      let i = 0
      let output = msg
      if ((typeof msg) === 'string') {
        // translations may contain markup, the inserted values (device names ...) may not
        output = msg.replace(/%s/g, () => {
          const subst = rep.slice(i, ++i)
          return escapeHtml(subst.toString())
        })
      }
      return output
    } else {
      return msg
    }
  }
}
