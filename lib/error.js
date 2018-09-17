const receivedError = require('./received-error')

class AmqpSwarmError extends Error {
  constructor (message = '', data = null, type = 'endpoint', subtype = null) {
    super()

    if (Error.captureStackTrace) Error.captureStackTrace(this, AmqpSwarmError)

    this.message = message
    this.data = data
    this.type = type
    this.subtype = subtype
  }
}

AmqpSwarmError.prototype.name = 'AmqpSwarmError'

module.exports = {
  Type: AmqpSwarmError,
  throw (message, data) {
    throw new AmqpSwarmError(message, data)
  },
  decode (error) {
    const ownError = (error instanceof AmqpSwarmError || error instanceof receivedError.Type)

    return {
      errorType: ownError ? error.type : 'endpoint',
      errorSubtype: ownError ? error.subtype : null,
      message: error.message || '',
      data: ownError ? error.data : null
    }
  }
}
