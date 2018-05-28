const amqpSwarm = require('../..')
// alternative: const amqpSwarmClient = require('amqp-swarm/client')

const client = amqpSwarm.client('ws://localhost:29552')
client.send('hello there', 'reposti')
  .then(response => console.log(response))
  .then(client.close)
