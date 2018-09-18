const allowedTypes = ['endpoint', 'protocol']

class AmqpSwarmReceivedError extends Error {
  constructor (message, data = null, type = 'endpoint', subtype = null) {
    super()
    if (Error.captureStackTrace) Error.captureStackTrace(this, AmqpSwarmReceivedError)

    this.message = message
    this.data = data

    this.type = ~allowedTypes.indexOf(type) ? type : 'protocol'
    this.subtype = subtype
  }
}

AmqpSwarmReceivedError.prototype.name = 'AmqpSwarmReceivedError'

module.exports = {
  Type: AmqpSwarmReceivedError,
  decode (passed) {
    const { message, data, errorType, errorSubtype } = passed
    return new AmqpSwarmReceivedError(message, data, errorType, errorSubtype || null)
  }
}
