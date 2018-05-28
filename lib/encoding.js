// in case we need to optimize this part

const decodeMessage = buffer => JSON.parse(buffer.toString('utf-8'))
const encodeMessage = message => Buffer.from(JSON.stringify(message), 'utf-8')

module.exports = {
  encodeMessage,
  decodeMessage
}
