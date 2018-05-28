// external modules
const amqplib = require('amqplib')
const crypto = require('crypto')

// internal modules
const emitter = require('./emitter')
const {encodeMessage, decodeMessage} = require('./encoding')
const replyHandler = require('./reply-handler')

function createServer ({
  url = 'amqp://localhost',
  socketOptions = {},
  prefix = 'amqp-swarm'
} = {}) {
  const amqp = amqplib.connect(url, socketOptions || {})

  const exchangeFromId = id => `${prefix}.client.${id}`

  const createNode = async (id, socket) => {
    if (!id) id = crypto.randomBytes(16).toString('base64')
    const channel = await (await amqp).createChannel()
    const exchange = exchangeFromId(id)

    // connect to amqp
    channel.assertExchange(exchange, 'fanout', {durable: false})
    const queue = await channel.assertQueue('', {exclusive: true})
    channel.bindQueue(queue.queue, exchange, '')

    // handle incoming messages through amqp
    channel.consume(queue.queue, ({content}) => {
      const message = decodeMessage(content) // TODO figure out error handling

      if (message.type === 'server-request') handleIncoming(message)
      if (message.type === 'server-response') replyHandler.handleResponse(message.correlationId, message.result)

      if (message.type === 'remote-client-request') handlePassthrough(message)
      if (message.type === 'remote-client-response') replyHandler.handleResponse(message.correlationId, message.result)
    })

    // handle incoming messages through the socket
    socket.on('message', (data) => {
      const message = decodeMessage(data)

      if (message.type === 'request') handleClient(message)
      if (message.type === 'response') replyHandler.handleResponse(message.correlationId, message.result)

      if (message.type === 'ping') sendOverSocket(encodeMessage({type: 'pong', correlationId: message.correlationId}))
      if (message.type === 'pong') replyHandler.handleResponse(message.correlationId)
    })

    const sendOverSocket = (message) => {
      if (socket.readyState === socket.OPEN) socket.send(message)
    }

    const emitters = {
      server: emitter(),
      client: emitter(),
      remoteClient: emitter({pass: true})
    }

    // send a server request to another node
    const sendServerRequest = async (node, name, ...args) => {
      const request = replyHandler.createRequest()

      channel.publish(exchangeFromId(node), '', encodeMessage({
        type: 'server-request',
        name,
        args,
        correlationId: request.correlationId,
        replyTo: exchange,
        sender: id
      }))

      return request.promise
    }

    // handle an incoming server request
    const handleIncoming = async ({name, args, replyTo, correlationId, sender}) => {
      const {result} = await emitters.server.emit(name, args, {sender})
      channel.publish(replyTo, '', encodeMessage({
        type: 'server-response',
        correlationId,
        result
      }))
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
    const handleClient = async ({name, args, correlationId}) => {
      const {result} = await emitters.client.emit(name, args)
      sendOverSocket(encodeMessage({
        type: 'response',
        correlationId,
        result
      }))
    }

    // send a remote client request through another node
    const sendRemoteClientRequest = async (node, name, ...args) => {
      const request = replyHandler.createRequest()

      channel.publish(exchangeFromId(node), '', encodeMessage({
        type: 'remote-client-request',
        name,
        args,
        correlationId: request.correlationId,
        replyTo: exchange,
        sender: id
      }))

      return request.promise
    }

    // handle an incoming server request
    const handlePassthrough = async ({name, args, replyTo, correlationId, sender}) => {
      const {result, pass} = await emitters.remoteClient.emit(name, args, {result: args, sender})
      if (pass) {
        const request = replyHandler.createRequest()

        sendOverSocket(encodeMessage({
          type: 'request',
          name,
          args,
          correlationId: request.correlationId
        }))
        const result = await request.promise

        channel.publish(replyTo, '', encodeMessage({
          type: 'remote-client-response',
          correlationId,
          result
        }))
      } else {
        channel.publish(replyTo, '', encodeMessage({
          type: 'remote-client-response',
          correlationId,
          result
        }))
      }
    }

    // clean up listeners
    const closeServer = (channelOpen = true) => {
      channel.close().catch(() => {}) // it's already closed, no need to care

      if (socket.readyState === socket.OPEN) {
        socket.send(encodeMessage({type: 'close'}))
        socket.close()
      }
    }

    socket.on('close', closeServer)
    channel.on('close', () => {
      closeServer(false)
    })

    // let the client know the interface is ready
    sendOverSocket(encodeMessage({type: 'init'}))

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
      close: closeServer
    }
  }

  const close = async () => (await amqp).close()

  return {createNode, close}
}

module.exports = createServer
