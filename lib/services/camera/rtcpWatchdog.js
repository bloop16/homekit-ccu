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
 * Call onTimeout(seconds, first) when the socket receives nothing for the current window.
 * Until the first datagram the window is initialSeconds (never shorter than timeoutSeconds),
 * so slow cameras get time to deliver the first frames; afterwards every datagram restarts
 * a timer of timeoutSeconds.
 * @param {EventEmitter} socket   emits 'message' for every received datagram
 * @param {number} timeoutSeconds
 * @param {Function} onTimeout    (seconds, first) => void; first is true when no datagram arrived at all
 * @param {number} [initialSeconds] defaults to timeoutSeconds
 * @returns {Function} stop function (clears the timer and the listener)
 */
function startRtcpWatchdog (socket, timeoutSeconds, onTimeout, initialSeconds = timeoutSeconds) {
  let timer = null
  const arm = (seconds, first) => {
    clearTimeout(timer)
    timer = setTimeout(() => onTimeout(seconds, first), seconds * 1000)
  }
  const reset = () => arm(timeoutSeconds, false)
  socket.on('message', reset)
  arm(Math.max(initialSeconds, timeoutSeconds), true)
  return () => {
    clearTimeout(timer)
    socket.removeListener('message', reset)
  }
}

module.exports = { watchdogSeconds, startRtcpWatchdog }
