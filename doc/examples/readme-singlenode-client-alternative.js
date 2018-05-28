const amqpSwarmClient = require('../../client')

const client = amqpSwarmClient('ws://localhost:29552')
client.send('hello there', 'reposti')
  .then(response => console.log(response))
  .then(client.close)
