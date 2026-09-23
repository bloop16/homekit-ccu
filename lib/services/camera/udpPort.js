'use strict'

const dgram = require('dgram')

/**
 * Bind a UDP socket to port 0, read the assigned port, close the socket and return the port.
 * There is a small race until ffmpeg binds it, which is acceptable for local use.
 */
function reserveUdpPort (addressVersion = 'ipv4') {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(addressVersion === 'ipv6' ? 'udp6' : 'udp4')
    socket.once('error', reject)
    socket.bind(0, () => {
      const port = socket.address().port
      socket.close(() => resolve(port))
    })
  })
}

module.exports = { reserveUdpPort }
