const amqpSwarm = require('../..')
const WebSocket = require('ws')

const server = amqpSwarm.server('amqp://localhost')
const wss = new WebSocket.Server({port: 29552})
// port 80 likely requires root, may be occupied,
// and it's generally not a good idea to use that for testing

wss.on('connection', async (ws, request) => {
  const node = await server.createNode(request.url, ws)

  node.client.on('hello there', (ctx, who) => {
    console.log(`${who} has the high ground`)
    return `general ${who}`
  })
})
