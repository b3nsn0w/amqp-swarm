// external modules
const uuid = require('uuid')

// internal modules
const receivedError = require('./received-error')

const expectedAnswers = {}

function createRequest (timeout = 1000) {
  const correlationId = uuid.v4()
  let timeoutId = null

  const promise = new Promise((resolve, reject) => {
    expectedAnswers[correlationId] = {
      resolve: (result) => {
        delete expectedAnswers[correlationId]
        if (timeoutId) clearTimeout(timeoutId)
        resolve(result)
      },
      reject: (error) => {
        delete expectedAnswers[correlationId]
        if (timeoutId) clearTimeout(timeoutId)
        reject(receivedError.decode(error))
      }
    }

    if (timeout) {
      timeoutId = setTimeout(() => {
        delete expectedAnswers[correlationId]
        reject(new receivedError.Type('Request timed out', null, 'protocol', 'timeout'))
      }, timeout)
    }
  })

  return { correlationId, promise }
}

function handleResponse (correlationId, result) {
  if (expectedAnswers[correlationId]) expectedAnswers[correlationId].resolve(result)
}

function handleError (correlationId, error) {
  if (expectedAnswers[correlationId]) expectedAnswers[correlationId].reject(error)
}

module.exports = {
  createRequest,
  handleResponse,
  handleError
}
