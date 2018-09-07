// in case we need to optimize this part

const decodeMessage = data => {
  const buffer = (global.MessageEvent && data instanceof global.MessageEvent) ? Buffer.from(data.data) : data // for browser socket support
  return JSON.parse(buffer.toString('utf-8'))
}
const encodeMessage = message => Buffer.from(JSON.stringify(message), 'utf-8')

module.exports = {
  encodeMessage,
  decodeMessage
}
