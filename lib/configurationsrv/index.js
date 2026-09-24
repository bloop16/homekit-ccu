/*
 * File: index.js
 * Project: homekit-ccu
 * File Created: Tuesday, 10th March 2020 7:15:57 pm
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

const path = require('path')
const Logger = require(path.join(__dirname, '..', 'logger.js'))
const ConfigurationService = require(path.join(__dirname, 'ConfigurationService.js'))

process.title = 'homekit-ccu-config'

const logger = new Logger('HAP ConfigServer')
logger.setDebugEnabled(process.env.UIX_DEBUG)
// into the log of the main process; without it refused api calls left no trace at all
if (process.env.UIX_LOGFILE) {
  logger.setLogFile(process.env.UIX_LOGFILE, false)
}
const pcs = new ConfigurationService(logger)
pcs.run()
pcs.process = process

logger.info('[Config] server is up and running messaging daemon about that')
process.send({
  topic: 'cfghello'
})

setInterval(() => {
  if (!process.connected) {
    logger.info('[Config] Shutdown Configuration Service')
    pcs.shutdown()
    process.exit()
  }
}, 10000)

process.on('message', (message) => {
  pcs.handleIncommingIPCMessage(message)
})

process.on('disconnect', () => {
  logger.info('[Config] Shutdown Configuration Service')
  pcs.shutdown()
  process.exit()
})
