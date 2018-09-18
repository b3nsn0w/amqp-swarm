// external modules
const amqplib = require('amqplib')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const unwrap = require('async-unwrap')

// internal modules
const emitter = require('./emitter')
const error = require('./error')
const { encodeMessage, decodeMessage } = require('./encoding')
const Pool = require('./pool')
const receivedError = require('./received-error')
const replyHandler = require('./reply-handler')

function createServer ({
  url = 'amqp://localhost',
  socketOptions = {},
  prefix = 'amqp-swarm'
} = {}) {
  const amqp = amqplib.connect(url, socketOptions || {})
  const pool = new Pool(url, socketOptions)

  const serverEvents = new EventEmitter()

  amqp.then(() => {
    serverEvents.emit('open')
  })

  const exchangeFromId = id => `${prefix}.client.${id}`
  const sendOverAmqp = async (exchange, message) => pool.send(exchange, encodeMessage(message))

  const createNode = async (id, socket) => {
    if (!id) id = crypto.randomBytes(16).toString('base64')
    const channel = await (await amqp).createChannel()
    const exchange = exchangeFromId(id)

    const nodeEvents = new EventEmitter()

    // connect to amqp
    channel.assertExchange(exchange, 'fanout', { durable: false })
    const queue = await channel.assertQueue('', { exclusive: true })
    channel.bindQueue(queue.queue, exchange, '')

    // handle incoming messages through amqp
    channel.consume(queue.queue, ({ content }) => {
      const message = decodeMessage(content) // TODO figure out error handling

      if (message.type === 'server-request') handleIncoming(message)
      if (message.type === 'server-response') replyHandler.handleResponse(message.correlationId, message.result)
      if (message.type === 'server-error') replyHandler.handleError(message.correlationId, message)

      if (message.type === 'remote-client-request') handlePassthrough(message)
      if (message.type === 'remote-client-response') replyHandler.handleResponse(message.correlationId, message.result)
      if (message.type === 'remote-client-error') replyHandler.handleError(message.correlationId, message)
    })

    // handle incoming messages through the socket
    socket.on('message', (data) => {
      const message = decodeMessage(data)

      if (message.type === 'request') handleClient(message)
      if (message.type === 'response') replyHandler.handleResponse(message.correlationId, message.result)
      if (message.type === 'error') replyHandler.handleError(message.correlationId, message)

      if (message.type === 'ping') sendOverSocket(encodeMessage({ type: 'pong', correlationId: message.correlationId }))
      if (message.type === 'pong') replyHandler.handleResponse(message.correlationId)
    })

    const sendOverSocket = (message) => {
      if (socket.readyState === socket.OPEN) socket.send(message)
    }

    const emitters = {
      server: emitter(),
      client: emitter(),
      remoteClient: emitter({ pass: true })
    }

    // send a server request to another node
    const sendServerRequest = async (node, name, ...args) => {
      const request = replyHandler.createRequest()

      await sendOverAmqp(exchangeFromId(node), {
        type: 'server-request',
        name,
        args,
        correlationId: request.correlationId,
        replyTo: exchange,
        sender: id
      })

      return request.promise
    }

    // handle an incoming server request
    const handleIncoming = async ({ name, args, replyTo, correlationId, sender }) => {
      const [err, context] = await emitters.server.emit(name, args, { sender })[unwrap]

      if (err) {
        return sendOverAmqp(replyTo, {
          ...error.decode(err),
          type: 'server-error',
          correlationId
        })
      }

      const { result } = context
      await sendOverAmqp(replyTo, {
        type: 'server-response',
        correlationId,
        result
      })
    }

    // send a request to the attached client
    const sendClientRequest = async (name, ...args) => {
      const request = replyHandler.createRequest()

      sendOverSocket(encodeMessage({
        type: 'request',
        name,
        args,
        correlationId: request.correlationId
      }))

      return request.promise
    }

    // handle an incoming request from the client
    const handleClient = async ({ name, args, correlationId }) => {
      const [err, context] = await emitters.client.emit(name, args)[unwrap]

      if (err) {
        return sendOverSocket(encodeMessage({
          ...error.decode(err),
          type: 'error',
          correlationId
        }))
      }

      const { result } = context
      sendOverSocket(encodeMessage({
        type: 'response',
        correlationId,
        result
      }))
    }

    // send a remote client request through another node
    const sendRemoteClientRequest = async (node, name, ...args) => {
      const request = replyHandler.createRequest()

      await sendOverAmqp(exchangeFromId(node), {
        type: 'remote-client-request',
        name,
        args,
        correlationId: request.correlationId,
        replyTo: exchange,
        sender: id
      })

      return request.promise
    }

    // handle an incoming server request
    const handlePassthrough = async ({ name, args, replyTo, correlationId, sender }) => {
      const [err, context] = await emitters.remoteClient.emit(name, args, { result: args, sender }, true)[unwrap]

      if (err) {
        return sendOverAmqp(replyTo, {
          ...error.decode(err),
          type: 'remote-client-error',
          correlationId
        })
      }

      const { result, pass } = context
      if (pass) {
        const request = replyHandler.createRequest()

        sendOverSocket(encodeMessage({
          type: 'request',
          name,
          args: result,
          correlationId: request.correlationId
        }))

        const [clientError, clientResult] = await request.promise[unwrap]

        if (clientError) {
          return sendOverAmqp(replyTo, {
            ...error.decode(clientError),
            type: 'remote-client-error',
            correlationId
          })
        }

        await sendOverAmqp(replyTo, {
          type: 'remote-client-response',
          correlationId,
          result: clientResult
        })
      } else {
        await sendOverAmqp(replyTo, {
          type: 'remote-client-response',
          correlationId,
          result
        })
      }
    }

    // clean up listeners
    let serverOpen = true

    const closeServer = (channelOpen = true) => {
      if (!serverOpen) return

      channel.close().catch(() => {}) // it's already closed, no need to care

      if (socket.readyState === socket.OPEN) {
        socket.send(encodeMessage({ type: 'close' }))
        socket.close()
      }

      serverOpen = false
      nodeEvents.emit('close')
    }

    socket.on('close', closeServer)
    channel.on('close', () => {
      closeServer(false)
    })

    // let the client know the interface is ready
    sendOverSocket(encodeMessage({ type: 'init' }))

    // start pinging client
    const clientPing = setInterval(async () => {
      const request = replyHandler.createRequest()

      sendOverSocket(encodeMessage({
        type: 'ping',
        correlationId: request.correlationId
      }))

      const [err] = await request.promise[unwrap]
      if (err) {
        clearInterval(clientPing)
        closeServer()
      }
    }, 1000)

    // set up interface
    return {
      id,
      on: emitters.server.addHandler,
      send: sendServerRequest,
      client: {
        on: emitters.client.addHandler,
        send: sendClientRequest
      },
      remoteClient: {
        on: emitters.remoteClient.addHandler,
        send: sendRemoteClientRequest
      },
      close: closeServer,
      throw: error.throw,
      get isOpen () { return serverOpen },
      events: nodeEvents
    }
  }

  const close = async () => {
    ;(await amqp).close()
    pool.close()
    serverEvents.emit('close')
  }

  return {
    createNode,
    close,
    connected: async () => {
      await amqp
    },
    events: serverEvents
  }
}

createServer.ErrorType = receivedError.Type
module.exports = createServer
