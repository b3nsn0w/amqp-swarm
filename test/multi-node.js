/* eslint-env mocha */
const WebSocket = require('ws')
const {expect} = require('chai')

const amqpSwarm = require('..')

const server = amqpSwarm.server()
const wss = new WebSocket.Server({port: 29553})
const nodes = {}

const checklists = new Map()
const isListComplete = list => !list.map(item => !nodes[item]).filter(a => a).length
const checklist = async (...list) => {
  if (isListComplete(list)) return

  return new Promise((resolve, reject) => checklists.set(list, resolve))
}
const checkChecklists = () => {
  checklists.forEach((resolve, list) => {
    if (!isListComplete(list)) return

    checklists.delete(list)
    resolve()
  })
}

wss.on('connection', async (ws, request) => {
  const nodeName = request.url.slice(1)
  nodes[nodeName] = await server.createNode(nodeName, ws)
  checkChecklists()
})

const clients = {
  ani: amqpSwarm.client('ws://localhost:29553/ani'),
  sheev: amqpSwarm.client('ws://localhost:29553/sheev')
}

describe('multi node', () => {
  before(async () => {
    await checklist('ani', 'sheev')

    nodes.sheev.on('power', (ctx, limit) => `${limit} power`)
    clients.ani.on('come to the dark side', (ctx) => 'yep')
    nodes.sheev.remoteClient.on('chancellor', (ctx) => {
      ctx.pass = false // note how there is no client-side handler
      return 'emperor'
    })

    // now we are editing an argument, but still keeping the client side
    nodes.ani.remoteClient.on('my new', (ctx, empire) => empire === 'republic' ? ['empire'] : [empire])
    clients.ani.on('my new', (ctx, empire) => `my new ${empire}`)
  })

  it('can send server requests', async () => {
    const result = await nodes.ani.send('sheev', 'power', 'unlimited')
    expect(result).to.equal('unlimited power')
  })

  it('can send remote client requests', async () => {
    const result = await nodes.sheev.remoteClient.send('ani', 'come to the dark side')
    expect(result).to.equal('yep')
  })

  it('can override remote client requests', async () => {
    const result = await nodes.ani.remoteClient.send('sheev', 'chancellor')
    expect(result).to.equal('emperor')
  })

  it('can edit remote client requests', async () => {
    const result = await nodes.sheev.remoteClient.send('ani', 'my new', 'republic')
    expect(result).to.equal('my new empire')
  })

  // TODO add extra test cases for complex data, failures (when we have error handling), etc.

  after(() => {
    clients.ani.close()
    clients.sheev.close()
    server.close()
    wss.close()
  })
})
