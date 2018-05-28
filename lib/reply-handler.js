const uuid = require('uuid')

const expectedAnswers = {}

class TimeoutError extends Error {}

function createRequest (timeout = 2000) {
  const correlationId = uuid.v4()
  let timeoutId = null

  const promise = new Promise((resolve, reject) => {
    expectedAnswers[correlationId] = (result) => {
      delete expectedAnswers[correlationId]
      if (timeoutId) clearTimeout(timeoutId)
      resolve(result)
    }

    if (timeout) {
      timeoutId = setTimeout(() => {
        delete expectedAnswers[correlationId]
        reject(new TimeoutError('request timed out'))
      }, timeout)
    }
  })

  return {correlationId, promise}
}

function handleResponse (correlationId, result) {
  if (expectedAnswers[correlationId]) expectedAnswers[correlationId](result)
}

module.exports = {
  createRequest,
  handleResponse,
  TimeoutError
}
