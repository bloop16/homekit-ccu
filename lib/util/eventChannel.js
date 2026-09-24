'use strict'

/*
 * Server messages for the configuration UI by long polling (api method events).
 *
 * The UI asks for new messages; when there are none the server holds the request until a message
 * comes or the timeout ends (then an empty list). Every UI has a client id with its own queue, so
 * no message is lost between two polls. This replaces sockjs, which the UI only used with its
 * polling transports anyway; the api checks the CCU session of every poll.
 */

const crypto = require('crypto')

class EventChannel {
  constructor ({ timeoutMs = 25 * 1000, maxQueue = 100, idleMs = 90 * 1000, now = () => Date.now() } = {}) {
    this.timeoutMs = timeoutMs
    this.maxQueue = maxQueue
    this.idleMs = idleMs
    this.now = now
    this.clients = new Map()
  }

  /** a new client with an empty queue; returns its id */
  register () {
    const id = crypto.randomBytes(16).toString('hex')
    this.clients.set(id, { queue: [], waiting: undefined, lastSeen: this.now() })
    return id
  }

  has (id) {
    return (typeof id === 'string') && this.clients.has(id)
  }

  get size () {
    return this.clients.size
  }

  /** queues a message for one client; the oldest messages go when the queue is full */
  push (id, message) {
    const client = this.clients.get(id)
    if (!client) return
    client.queue.push(message)
    if (client.queue.length > this.maxQueue) {
      client.queue.splice(0, client.queue.length - this.maxQueue)
    }
    this.flush(client)
  }

  /** queues a message for every client */
  broadcast (message) {
    this.clients.forEach((client, id) => this.push(id, message))
  }

  /**
   * Answers the poll of a client with send(messages): at once when messages are queued, else with
   * the next message or [] after the timeout. A newer poll answers the older one with [].
   * Returns a function that drops the poll (the request was closed).
   */
  poll (id, send) {
    const client = this.clients.get(id)
    if (!client) {
      send([])
      return () => {}
    }
    client.lastSeen = this.now()
    if (client.waiting) {
      this.answer(client, [])
    }
    const waiting = { send, timer: undefined }
    client.waiting = waiting
    if (client.queue.length > 0) {
      this.flush(client)
    } else {
      waiting.timer = setTimeout(() => this.answer(client, []), this.timeoutMs)
    }
    return () => {
      if (client.waiting === waiting) {
        clearTimeout(waiting.timer)
        client.waiting = undefined
      }
    }
  }

  flush (client) {
    if (client.waiting && (client.queue.length > 0)) {
      this.answer(client, client.queue.splice(0))
    }
  }

  answer (client, messages) {
    const waiting = client.waiting
    client.waiting = undefined
    client.lastSeen = this.now()
    clearTimeout(waiting.timer)
    try {
      waiting.send(messages)
    } catch (e) {
      // the request is gone; the messages were meant for it only
    }
  }

  /** removes clients that stopped polling */
  prune () {
    const limit = this.now() - this.idleMs
    this.clients.forEach((client, id) => {
      if (!client.waiting && (client.lastSeen < limit)) {
        this.clients.delete(id)
      }
    })
  }

  /** answers every waiting poll and forgets all clients */
  close () {
    this.clients.forEach(client => {
      if (client.waiting) this.answer(client, [])
    })
    this.clients.clear()
  }
}

module.exports = { EventChannel }
