// external modules
const unwrap = require('async-unwrap')

// internal modules
const emitter = require('./emitter')
const error = require('./error')
const {encodeMessage, decodeMessage} = require('./encoding')
const receivedError = require('./received-error')
const replyHandler = require('./reply-handler')
const resilientSocket = require('./resilient-socket')

function createClient (url, customSocket) {
  if (!url && !customSocket) throw new TypeError('either url or customSocket must be provided')
  const socket = url ? resilientSocket(url) : customSocket

  const clientEmitter = emitter()

  // handle incoming messages
  socket.on('message', (data) => {
    const message = decodeMessage(data)

    if (message.type === 'request') handleIncoming(message)
    if (message.type === 'response') replyHandler.handleResponse(message.correlationId, message.result)
    if (message.type === 'error') replyHandler.handleError(message.correlationId, message)

    if (message.type === 'ping') socket.send(encodeMessage({type: 'pong', correlationId: message.correlationId}))
  })

  // send a request to the server
  const sendRequest = async (name, ...args) => {
    const request = replyHandler.createRequest()

    socket.send(encodeMessage({
      type: 'request',
      name,
      args,
      correlationId: request.correlationId
    }))

    return request.promise
  }

  // handle an incoming request from the server
  const handleIncoming = async ({name, args, correlationId}) => {
    const [err, context] = await clientEmitter.emit(name, args)[unwrap]

    if (err) {
      return socket.send(encodeMessage({
        ...error.decode(err),
        type: 'error',
        correlationId
      }))
    }

    const {result} = context
    socket.send(encodeMessage({
      type: 'response',
      correlationId,
      result
    }))
  }

  // set up interface
  return {
    on: clientEmitter.addHandler,
    send: sendRequest,
    close: () => socket.close(),
    throw: error.throw
  }
}

createClient.ErrorType = receivedError.Type
module.exports = createClient
