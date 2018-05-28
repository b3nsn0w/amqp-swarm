function createEmitter (globalContext) {
  const handlers = {}

  const addHandler = (name, callback) => {
    if (!handlers[name]) handlers[name] = []
    handlers[name].push(callback)
  }

  const emit = async (name, args, customContext) => {
    const currentHandlers = handlers[name] || []
    const context = {result: null, ...globalContext, ...customContext}

    for (const handler of currentHandlers) {
      context.result = await handler(context, ...(Array.isArray(args) ? args : [args]))
    }

    return context
  }

  return {emit, addHandler}
}

module.exports = createEmitter
