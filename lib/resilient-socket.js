// external modules
const {EventEmitter} = require('events')
const WebSocket = global.WebSocket || require('ws')

// internal modules
const {encodeMessage, decodeMessage} = require('./encoding')
const replyHandler = require('./reply-handler')

function createResilientSocket (url, timeout = 1000) {
  let currentSocket = null
  let isInitialized = false
  let leaveClosed = false

  const nextInitListeners = []
  const nextInit = () => new Promise((resolve, reject) => nextInitListeners.push(resolve))
  const triggerNextInit = () => {
    let callback
    while ((callback = nextInitListeners.shift())) callback()
  }

  const emitter = new EventEmitter()
  const messageQueue = []

  const reopen = async (socket) => {
    if (socket && socket !== currentSocket) return // socket has been reopened already

    if (currentSocket) currentSocket.close()
    isInitialized = false

    currentSocket = new WebSocket(url)
    if (!currentSocket.on) currentSocket.on = currentSocket.addEventListener
    await socketOpen(currentSocket)

    attachListeners(currentSocket)

    await nextInit()
    startPinging(currentSocket)

    isInitialized = true

    let next
    while ((next = messageQueue.pop())) currentSocket.send(next)
  }

  const socketOpen = (socket) => new Promise((resolve, reject) => {
    socket.on('open', resolve)
  })

  const isOpen = () => isInitialized && currentSocket.readyState === currentSocket.OPEN

  const attachListeners = (socket) => {
    socket.on('message', (data) => {
      const message = decodeMessage(data)

      if (message.type === 'init') triggerNextInit()
      if (message.type === 'close') close()

      if (message.type === 'ping') socket.send(encodeMessage({type: 'pong', correlationId: message.correlationId}))
      if (message.type === 'pong') replyHandler.handleResponse(message.correlationId)

      emitter.emit('message', data)
    })
  }

  const startPinging = (socket) => {
    if (leaveClosed) return
    if (socket.readyState !== socket.OPEN) return reopen(socket)

    const request = replyHandler.createRequest()

    socket.send(encodeMessage({type: 'ping', correlationId: request.correlationId}))
    request.promise.catch(() => {
      reopen()
    })

    setTimeout(() => startPinging(socket), 1000)
  }

  const send = (message) => {
    if (isOpen()) return currentSocket.send(message)
    else messageQueue.push(message)
  }

  const close = () => {
    leaveClosed = true
    currentSocket.close()

    emitter.emit('close')
  }

  reopen()

  emitter.send = send
  emitter.close = close
  return emitter
}

module.exports = createResilientSocket
