'use strict'

const dgram = require('dgram')

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
 * Reserve an even RTP port whose odd neighbour (RTCP) is free as well, then release both,
 * so an ffmpeg SDP input can bind the pair.
 * @returns {Promise<{rtp: number, rtcp: number}>}
 */
async function reserveUdpPortPair (addressVersion = 'ipv4', attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const rtpSocket = await bindUdpSocket(addressVersion)
    const rtp = rtpSocket.address().port
    if (rtp % 2 === 0) {
      const rtcpSocket = await bindUdpSocket(addressVersion, rtp + 1).catch(() => null)
      if (rtcpSocket) {
        await Promise.all([closeSocket(rtcpSocket), closeSocket(rtpSocket)])
        return { rtp, rtcp: rtp + 1 }
      }
    }
    await closeSocket(rtpSocket)
  }
  throw new Error(`no free even/odd UDP port pair found after ${attempts} attempts`)
}

module.exports = { reserveUdpPortPair, bindUdpSocket }
