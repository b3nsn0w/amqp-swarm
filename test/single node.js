/* eslint-env mocha */
const WebSocket = require('ws')
const {expect} = require('chai')

const amqpSwarm = require('..')

const server = amqpSwarm.server()
const wss = new WebSocket.Server({port: 29552})
const client = amqpSwarm.client('ws://localhost:29552/test')

const node = new Promise((resolve, reject) => {
  wss.on('connection', async (ws, request) => {
    resolve(server.createNode(request.url, ws))
  })
})

describe('single node', () => {
  before(async () => {
    ;(await node).client.on('hello there', (ctx, jediMaster) => `general ${jediMaster}`) // don't even think about passing "anakin" here
    client.on('is that legal?', () => 'i will make it legal')
  })

  it('can send a request from the client', async () => {
    const result = await client.send('hello there', 'reposti')
    expect(result).to.equal('general reposti')
  })

  it('can send a request from the server', async () => {
    const result = await (await node).client.send('is that legal?')
    expect(result).to.equal('i will make it legal')
  })

  // TODO add extra test cases for complex data, failures (when we have error handling), etc.

  after(() => {
    client.close()
    server.close()
    wss.close()
  })
})
