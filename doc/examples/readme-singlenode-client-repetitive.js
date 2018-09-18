const amqpSwarm = require('../..')
// alternative: const amqpSwarmClient = require('amqp-swarm/client')

const client = amqpSwarm.client('ws://localhost:29552')

const names = ['kenobi', 'skywalker', 'yoda', 'windu', 'mundi']
const getName = () => names[Math.floor(Math.random() * names.length)]

setInterval(async () => {
  console.log(await client.send('hello there', getName()))
}, 1000)
