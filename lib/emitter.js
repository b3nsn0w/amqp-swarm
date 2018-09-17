const error = require('./error')

function createEmitter (globalContext) {
  const handlers = {}

  const addHandler = (name, callback) => {
    if (!handlers[name]) handlers[name] = []
    handlers[name].push(callback)
  }

  const emit = async (name, args, customContext, passthrough = false) => {
    const currentHandlers = handlers[name] || []
    if (!currentHandlers.length && !passthrough) throw new error.Type(`No handler found for request '${name}'`, {requestName: name}, 'protocol', 'unhandled')

    const context = {result: null, throw: error.throw, ...globalContext, ...customContext}

    for (const handler of currentHandlers) {
      context.result = await handler(context, ...(Array.isArray(args) ? args : [args]))
    }

    return context
  }

  return {emit, addHandler}
}

module.exports = createEmitter
