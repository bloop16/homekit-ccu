'use strict'

const dgram = require('dgram')

// The viewer (iPhone, home hub) sends RTCP and talkback to the return ports of a stream. The
// restrictive firewall of the CCU drops UDP to other ports, so the return ports come from this
// range, which the configuration opens while there is a video doorbell. A stream takes three
// (video return, audio return RTP and RTCP), a video doorbell up to two streams.
const STREAM_PORTS = Object.freeze({ first: 9950, last: 9979 })

/** every port of the range */
function streamPorts (range = STREAM_PORTS) {
  const ports = []
  for (let port = range.first; port <= range.last; port++) {
    ports.push(port)
  }
  return ports
}

/**
 * Bind a UDP socket (port 0 = any free port) and resolve with the bound socket.
 * The socket is closed again when binding fails.
 * @param {'ipv4'|'ipv6'} addressVersion
 * @param {number} port
 * @returns {Promise<dgram.Socket>}
 */
function bindUdpSocket (addressVersion = 'ipv4', port = 0) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(addressVersion === 'ipv6' ? 'udp6' : 'udp4')
    const onError = (err) => {
      socket.close()
      reject(err)
    }
    socket.once('error', onError)
    socket.bind(port, () => {
      socket.removeListener('error', onError)
      resolve(socket)
    })
  })
}

function closeSocket (socket) {
  return new Promise(resolve => socket.close(resolve))
}

/**
 * Bind a UDP socket on the first free port of the range (the video return socket of a stream).
 * @returns {Promise<dgram.Socket>}
 */
async function bindReturnSocket (addressVersion = 'ipv4', range = STREAM_PORTS) {
  for (const port of streamPorts(range)) {
    const socket = await bindUdpSocket(addressVersion, port).catch(() => null)
    if (socket) {
      return socket
    }
  }
  throw new Error(`no free UDP port for a stream in ${range.first}-${range.last}`)
}

/**
 * Reserve an even RTP port of the range whose odd neighbour (RTCP) is free as well, then
 * release both, so an ffmpeg SDP input can bind the pair.
 * @returns {Promise<{rtp: number, rtcp: number}>}
 */
async function reserveUdpPortPair (addressVersion = 'ipv4', range = STREAM_PORTS) {
  for (const rtp of streamPorts(range).filter(port => (port % 2 === 0) && (port + 1 <= range.last))) {
    const rtpSocket = await bindUdpSocket(addressVersion, rtp).catch(() => null)
    if (!rtpSocket) {
      continue
    }
    const rtcpSocket = await bindUdpSocket(addressVersion, rtp + 1).catch(() => null)
    await closeSocket(rtpSocket)
    if (rtcpSocket) {
      await closeSocket(rtcpSocket)
      return { rtp, rtcp: rtp + 1 }
    }
  }
  throw new Error(`no free even/odd UDP port pair for a stream in ${range.first}-${range.last}`)
}

module.exports = { STREAM_PORTS, streamPorts, bindReturnSocket, reserveUdpPortPair, bindUdpSocket }
