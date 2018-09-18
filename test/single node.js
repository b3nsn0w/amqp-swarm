/* eslint-env mocha */
/* eslint-disable no-unused-expressions */

const WebSocket = require('ws')
const { expect } = require('chai')
const unwrap = require('async-unwrap')

const amqpSwarm = require('..')

const server = amqpSwarm.server()
const wss = new WebSocket.Server({ port: 29552 })
const client = amqpSwarm.client('ws://localhost:29552/test')

const node = new Promise((resolve, reject) => {
  wss.on('connection', async (ws, request) => {
    resolve(server.createNode(request.url, ws))
  })
})

describe('single node', () => {
  before(async () => {
    const awaitedNode = await node
    awaitedNode.client.on('hello there', (ctx, jediMaster) => {
      if (jediMaster === 'anakin') awaitedNode.throw('take a seat', { council: true, master: false })
      return `general ${jediMaster}`
    })
    client.on('is that legal?', () => 'i will make it legal')
    client.on('stormtrooper', () => { throw new TypeError('clone') })
  })

  it('can send a request from the client', async () => {
    const result = await client.send('hello there', 'kenobi')
    expect(result).to.equal('general kenobi')
  })

  it('can handle an error on the client', async () => {
    const [err, result] = await client.send('hello there', 'anakin')[unwrap]

    expect(err).to.be.instanceof(amqpSwarm.client.ErrorType)

    expect(err.message).to.equal('take a seat')
    expect(err.data.council).to.be.true
    expect(err.data.master).to.be.false
    expect(err.type).to.equal('endpoint')

    expect(result).to.be.null
  })

  it('can send a request from the server', async () => {
    const result = await (await node).client.send('is that legal?')
    expect(result).to.equal('i will make it legal')
  })

  it('can handle an error on the server', async () => {
    const [err, result] = await (await node).client.send('kamino')[unwrap]

    expect(err).to.be.instanceof(amqpSwarm.server.ErrorType)

    expect(err.type).to.equal('protocol')
    expect(err.subtype).to.equal('unhandled')
    expect(err.data.requestName).to.equal('kamino')

    expect(result).to.be.null
  })

  it('is compatible with native errors too', async () => {
    const [err, result] = await (await node).client.send('stormtrooper')[unwrap]

    expect(err).to.be.instanceof(amqpSwarm.server.ErrorType)

    expect(err.type).to.equal('endpoint')
    expect(err.message).to.equal('clone')

    expect(result).to.be.null
  })

  // TODO add extra test cases for complex data to test serialization

  after(() => {
    client.close()
    server.close()
    wss.close()
  })
})
