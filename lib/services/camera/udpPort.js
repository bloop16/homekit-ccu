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

/**
 * Bind a UDP socket to port 0, read the assigned port, close the socket and return the port.
 * There is a small race until ffmpeg binds it, which is acceptable for local use.
 */
async function reserveUdpPort (addressVersion = 'ipv4') {
  const socket = await bindUdpSocket(addressVersion)
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  return port
}

module.exports = { reserveUdpPort, bindUdpSocket }
