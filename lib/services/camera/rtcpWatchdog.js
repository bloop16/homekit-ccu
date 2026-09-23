'use strict'

const MAX_TIMEOUT_SECONDS = 60

/**
 * Seconds without RTCP from the viewer after which a session counts as dead:
 * five RTCP intervals, at least floorSeconds, at most 60 seconds.
 * @param {number} rtcpInterval  seconds, from the hap START request
 * @param {number} floorSeconds
 */
function watchdogSeconds (rtcpInterval, floorSeconds) {
  const interval = rtcpInterval > 0 ? rtcpInterval : 0.5
  return Math.min(Math.max(interval * 5, floorSeconds), MAX_TIMEOUT_SECONDS)
}

/**
 * Call onTimeout when the socket receives nothing for timeoutSeconds; every datagram restarts the timer.
 * @returns {Function} stop function (clears the timer and the listener)
 */
function startRtcpWatchdog (socket, timeoutSeconds, onTimeout) {
  let timer = null
  const reset = () => {
    clearTimeout(timer)
    timer = setTimeout(onTimeout, timeoutSeconds * 1000)
  }
  socket.on('message', reset)
  reset()
  return () => {
    clearTimeout(timer)
    socket.removeListener('message', reset)
  }
}

module.exports = { watchdogSeconds, startRtcpWatchdog }
