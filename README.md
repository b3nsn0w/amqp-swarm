amqp-swarm is a communication library between server-defined virtual nodes, designed for a twelve-factor cloud environment.

# Installation

```
npm install --save amqp-swarm
```

# Overview

amqp-swarm defines a client and a node. The node is not a physical server but rather a server-side representation of the client. There is a 1:1 mapping between clients and nodes.

Data exchange happens on a request-response basis. Three separate forms of requests are defined, client requets, server requests, and remote client requests.

![Fig 1: Single node structure](doc/single-node.svg?sanitize=true)

Note: the arrows only illustrate the request, responses flow through the same path in reverse (e.g. a client can respond to a remote client request directly).

- **Client Request**: Communication between the client and its node.
- **Server Request**: Communication between nodes
- **Remote Client Request**: Communication between a node and a client attached to a different node

The "swarm" is logically the library, and physically an AMQP server or cluster. It is used to transmit server and remote client requests.

![Fig 2: Multi node structure](doc/multi-node.svg?sanitize=true)

Remote client requests are passed through the recipient node, which allows it to edit the request.

This allows for reduced assumptions and twelve factor compilance:

 - Nodes are not required to reside on the same server
 - The swarm is not required to be a single server
 - The only requirement is a URL for the AMQP service
 - Code can easily be structured on a stateless, per-node basis
 - The client-node connection is a single ongoing socket (usually websocket)
 - Nodes can be disconnected and reconnect to any other server arbitrarily

Note that amqp-swarm does not store any state, it's merely a communication library. If you require state and resistance against dropped connections, the recommended way to store state is a cache service such as Redis. You can supply the node ID, which can be shared between Redis and amqp-swarm. Duplicate nodes don't break the protocol, although you are recommended to drop old connections since all nodes with the same ID receive the same requests.

# Alpha notice

amqp-swarm is currently in alpha and has not reached version 1.0.0 yet. Here is a list of available and planned features:

- [x] Server-client communication
- [x] Server-server communication
- [x] Error handling
- [x] Server-side ping
- [ ] Pattern matching for request handlers
- [ ] Connection deduplication
- [x] Full documentation
- [ ] Examples
- [x] Custom socket support

"Examples" refers to multi-node examples, apart from that, the initial docs are mostly done. Test coverage is also a bit lacking at the moment.

# Usage

Example on the server:

```javascript
const amqpSwarm = require('amqp-swarm')
const WebSocket = require('ws')

const server = amqpSwarm.server('amqp://localhost')
const wss = new WebSocket.Server({port: 80})

wss.on('connection', async (ws, request) => {
  const node = await server.createNode(request.url, ws)

  node.client.on('hello there', (ctx, who) => `general ${who}`)
})
```

And on the client:

```javascript
const amqpSwarm = require('amqp-swarm')
// alternative: const amqpSwarmClient = require('amqp-swarm/client')

const client = amqpSwarm.client('ws://localhost')
client.send('hello there', 'reposti')
  .then(response => console.log(response))
  .then(client.close)
```

This demonstrates a simple client request, but it does have a client, a node, and it actually does cover most of the API. If we take a look at what happened here:

 - a server was created by calling `amqpSwarm.server()`
 - a supporting websocket server was used
 - a node was created using `server.createNode()`
 - the node registered a listener using `node.client.on()`
 - a client was created by calling `amqpSwarm.client()`
 - a request was sent over using `client.send()`
 - the client was closed

The API separates three concepts: client, server, and node. Clients and servers are created directly, while nodes are created using a server.

## Request handling

amqp-swarm uses a uniform request handler function over all APIs:

```javascript
async (ctx, ...args) => result
```

`ctx`, or context for long, is used to pass request-wide extra variables. By default, `ctx.result` refers to the current result, which is `null` by default, but it's useful if multiple request handlers are set to the same event, in which case they are ran sequentially, in the order they are added. The return value of the last one ran is always set to `ctx.result`, and the final value of that property (the return value of the last listener) is then returned.

`args` is the arguments sent by the send function, which can take these two forms:

```javascript
async (name, ...args) => result // for client requests
async (node, name, ...args) => result // for server or remote client requests
```

`name` is the string that identifies the event. Currently, pattern matching is not implemented, but the use of `*` is reversed for future implementation. `args` is the list of arguments passed, and in case it's relevant, `node` is the ID of the node the request is sent to.

Both `args` and `result` need to be JSON stringifiable.

# Error handling

If a request handler throws an error, amqp-swarm rejects the promise on the sender with its own error type. Normally, the error message is transported, but with the library's own error type extra data can be passed too.

Example:

```javascript
// server
node.client.on('promote-master', () => {
  throw new Error('take a seat')
})
```

```javascript
// client
client.send('promote-master')
  .catch(err => {
    // err is an AmqpSwarmReceivedError with the following properties:
    // type: 'endpoint'
    // message: 'take a seat'
    // data: null
  })
```

The received error (available on `server.ErrorType` and `client.ErrorType`) has four properties:

 - `type`: either `endpoint` or `protocol`
   - `endpoint` means the error was thrown by the handler
   - `protocol` occurs when the message wasn't transported either before or after it reached the handler
 - `subtype`: the specific error in case the type was `protocol`:
    - `timeout`: no response was received and the request timed out
    - `unhandled`: no handler was available on the recipient
   
   with type `endpoint` the subtype is always `null`
 - `message`: error message string, as usual
 - `data`: custom data passed by either the handler (`endpoint`) or the library (`protocol`)

Custom data can be passed with the `ctx.throw(message, data)` function:

```javascript
// server
node.client.on('promote-master', (ctx) => {
  ctx.throw('take a seat', {council: true, master: false})
})
```

```javascript
// client
client.send('promote-master')
  .catch(err => {
    console.warn(err)
    if (err.data.council && !err.data.master) {
      console.error('how can you be on the council and not be a master?')
    }
  })
```

Alternatively, `ctx.throw()` is aliased on `node.throw()` and `client.throw()`

# API Reference

## Client

The client is, as the name suggets, a client side implementation.

### `amqpSwarm.client(url, customSocket)`

This method creates a client and returns its interface. The two properties are:

 - `url`: A websocket url where the server is exposed. If provided, the client will automatically handle the connection, pinging, and reconnection on its own.
 - `customSocket`: used if the url is null, can be used to transmit the connection through a custom socket. Refer to the [protocol guide](#protocol-guide) for the requirements and features.

The returned interface has three properties:

#### `client.on(name, handler)`

Handles an incoming request.

 - `name`: a string, identifying the request to be handled
 - `handler`: a request handler function, [as defined above](#request-handling)

#### `client.send(name, ...args)`

Sends a request to the server.

 - `name`: a string, identifying the request
 - `...args`: a list of arguments passed to the server

#### `client.throw(message, data)`

Thows an `AmqpSwarmError` that can carry custom data through a handler.

#### `client.close()`

Closes the connection.

## Server

The server is the per-process part of the server-side implementation, it's responsible for connecting to the AMQP service and keeping track of its nodes.

### `amqpSwarm.server(url, socketOptions, prefix)`

Creates a server instance.

 - `url`: The URL through which the AMQP service can be accessed. Defaults to `amqp://localhost`
 - `socketOptions`: Socket settings passed to [amqplib](https://github.com/squaremo/amqp.node), defaults to `{}`
 - `prefix`: A prefix to AMQP exchanges and channels used in the swarm. Defaults to `amqp-swarm`.

The resulting server instance only has two methods:

#### `server.close()`

Closes the connection and all of the server's nodes.

#### `server.createNode(id, socket)`

Creates a node, the server-side representation of the client.

 - `id`: The node ID, an arbitrary string. Automatically generated if omitted.
 - `socket`: The socket through which the node communicates with the client. WebSocket implementations are usually compatible ([ws](https://github.com/websockets/ws) has been tested), refer to the [protocol guide](#protocol-guide) for instructions on how to use custom sockets.

The returned value is the node interface.

#### `server.connected`

A promise that gets resolved when the server connects to AMQP

#### `server.events`

Event emitter interface for miscellaneous server events. Currently supported events:

  - `open`: fired when the AMQP interface is connected
  - `close`: fired when the server is closed

## Node

The node is the per-client part of the server-side implementation, it handles the actual communication with the client.

#### `node.<span></span>id`

The node ID, useful if it was autogenerated.

#### `node.on(name, handler)`

Handles an incoming server request.

 - `name`: a string, identifying the request to be handled
 - `handler`: a request handler function, [as defined above](#request-handling)

#### `node.send(node, name, ...args)`

Sends a server request to an arbitrary node in the swarm.

 - `node`: the ID of the target node
 - `name`: a string, identifying the request
 - `...args`: a list of arguments passed to the server

#### `node.client.on(name, handler)`

Handles an incoming client request.

 - `name`: a string, identifying the request to be handled
 - `handler`: a request handler function, [as defined above](#request-handling)

#### `node.client.send(node, name, ...args)`

Sends a request to the attached client.

 - `name`: a string, identifying the request
 - `...args`: a list of arguments passed to the server

#### `node.remoteClient.on(name, handler)`

Handles an incoming remote client request.

 - `name`: a string, identifying the request to be handled
 - `handler`: a request handler function, [as defined above](#request-handling)

Remote client handlers have an additional `ctx.pass` parameter, defaulting to `true`, and `ctx.result` is prefilled with `args`. If `ctx.pass` is true, the result of the last listener will be passed to the client as `args`. If false, the result will be sent back directly to the requesting node.

#### `node.remoteClient.send(node, name, ...args)`

Sends a remote client request to an arbitrary node in the swarm.

 - `node`: the ID of the target node
 - `name`: a string, identifying the request
 - `...args`: a list of arguments passed to the server

#### `node.throw(message, data)`

Thows an `AmqpSwarmError` that can carry custom data through a handler.

#### `node.close()`

Closes the connection.

#### `node.isOpen`

Open state of the node, starts from true and becomes false when the node has closed

#### `node.events`

Event emitter interface for miscellaneous node events. Currently supported events:

 - `close`: fired when the node closes

## Context

The context object is passed to every request handler. It has the following properties:

#### `context.result`

The result of the last handler, useful if you chain multiple handlers to a request. On remote client requests, this contains the arguments passed to the client.

#### `context.throw(message, data)`

Thows an `AmqpSwarmError` that can carry custom data through a handler.

#### `context.sender`

Contains the ID of the sender node. Only on server and remote client requests.

#### `context.pass`

Only on remote client requests, controls if the request will be passed to the client or not. Defaults to `true`.

# Protocol Guide

The connection between the client and the node can run through a custom socket. Here's what you need to know to build one:

  - Messages are UTF-8-encoded JSON strings, passed to and expected from the socket as NodeJS buffers.
  - Sockets need to implement three methods and two events:
    - `socket.send(buffer)`: sends the buffer to the other side
    - `socket.close()`: closes the socket
    - `socket.on(name, listener)`: attaches an event listener for the following events:
      - `message`: a buffer has been received from the other side. The first parameter passed to the listener must be the buffer.
      - `close`: the socket has been closed from the other side
  - JSON-messages always have a `type` field, anything else is arbitrary and up to the specific type
  - You have to wait until you receive `{type: 'init'}` from the server before sending messages
  - Request-response pairs use a `correlationId` field which identifies which response is for which request
  - The server side implements the `ping` and `pong` message types, which can be used by a client-side socket implementation
    - you can send `{type: 'ping', correlationId: 'foo'}` requests, for which the server replies with `{type: 'pong', correlationId: 'foo'}`
  - The following message types are in use currently on the server-client interface:
    - `init`
    - `request`
    - `response`
    - `error`
    - `ping`
    - `pong`
  - On a `ping` request your client must reply with a `pong` using the same `correlationId`
  - You are free to implement your own request types, but it is strongly advised to prefix them with `x-`. Updates introducing new request types not prefixed with `x-` are regarded as a minor-level changes, but they could break your library if you don't follow this convention.

Here are some example messages:

```
< {type: 'init'}
> {type: 'ping', correlationId: 'foo'}
> {type: 'ping', correlationId: 'bar'}
< {type: 'pong', correlationId: 'foo'}
< {type: 'pong', correlationId: 'bar'}
> {
    type: 'request',
    name: 'what about',
    args: ['attack', {by: 'droids', on: 'wookies'}]
    correlationId: '53f55691-e6a9-4440-a3cc-38981f54124d'
  }
< {
    type: 'response',
    correlationId: '53f55691-e6a9-4440-a3cc-38981f54124d',
    result: 'go, i will. good relations with the wookies, i have'
  }
```

# Contributing

Pull requests are welcome. As always, be respectful towards each other and maybe run or create tests, as appropriate. It's on `npm test`, as usual.

amqp-swarm is available under the MIT license.