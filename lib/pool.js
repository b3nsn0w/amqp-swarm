// the purpose of the pool is to filter out dead connections and heal itself

// external modules
const amqplib = require('amqplib')

const privateMap = new WeakMap()
const getRandomElement = set => Array.from(set)[Math.floor(Math.random() * set.size)]

class DeadPool {
  constructor (url = 'amqp://localhost', socketOptions = {}, size = 4) {
    const privates = {
      url,
      socketOptions,
      size,
      shouldRefill: true,
      availableConnections: new Set(),
      queue: [],
      connect: async () => {
        const connection = await amqplib.connect(url, socketOptions)
        const channel = await connection.createChannel()

        const exported = { connection, channel }

        channel.on('error', async () => {
          privates.availableConnections.delete(exported)

          try {
            await connection.close()
          } catch (err) {
            // probably already closed
          }

          if (privates.shouldRefill) privates.connect() // the channel should replace itself
        })

        if (!privates.shouldRefill) return connection.close()

        privates.availableConnections.add(exported)
        privates.checkQueue()
      },
      checkQueue: () => {
        if (!privates.availableConnections.size) return
        if (!privates.queue.length) return

        const { exchange, message, resolve } = privates.queue.shift()
        const connection = getRandomElement(privates.availableConnections)

        connection.channel.publish(exchange, '', message)
        resolve()

        privates.checkQueue()
      }
    }

    privateMap.set(this, privates)
    new Array(size).fill().map(() => privates.connect()) // for is for noobs
  }

  send (exchange, message) {
    const privates = privateMap.get(this)

    return new Promise((resolve, reject) => {
      privates.queue.push({
        exchange,
        message,
        resolve
      })
      privates.checkQueue()
    })
  }

  close () {
    const privates = privateMap.get(this)

    privates.shouldRefill = false
    privates.availableConnections.forEach(({ connection, channel }) => {
      channel.close()
      connection.close()
    })
  }
}

module.exports = DeadPool
