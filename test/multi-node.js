/* eslint-env mocha */
/* eslint-disable no-unused-expressions */

const WebSocket = require('ws')
const { expect } = require('chai')
const unwrap = require('async-unwrap')

const amqpSwarm = require('..')

const server = amqpSwarm.server()
const wss = new WebSocket.Server({ port: 29553 })
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

    // this will never succeed
    clients.ani.on('save padme', (ctx) => ctx.throw('rage', { killObi: false, killPadme: true }))
  })

  it('can send server requests', async () => {
    const result = await nodes.ani.send('sheev', 'power', 'unlimited')
    expect(result).to.equal('unlimited power')
  })

  it('can handle errors on server requests', async function () {
    this.timeout(5000)
    const [err, result] = await nodes.ani.send('windu', 'five reasons I should be master')[unwrap] // you can send to nodes that don't even exist

    expect(err).to.be.instanceof(amqpSwarm.server.ErrorType)

    expect(err.type).to.equal('protocol')
    expect(err.subtype).to.equal('timeout') // yeah, you won't succeed (what did you expect), but at least it's handled

    expect(result).to.be.null

    setImmediate(() => console.log('sorry for the timeout'))
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

  it('can handle errors on remote client requests', async () => {
    const [err, result] = await nodes.sheev.remoteClient.send('ani', 'save padme')[unwrap]

    expect(err).to.be.instanceof(amqpSwarm.client.ErrorType)
    expect(err.message).to.equal('rage')
    expect(err.type).to.equal('endpoint')
    expect(err.data.killObi).to.be.false
    expect(err.data.killPadme).to.be.true

    expect(result).to.be.null
  })

  // TODO add extra test cases for complex data to test serialization

  after(() => {
    clients.ani.close()
    clients.sheev.close()
    server.close()
    wss.close()
  })
})
