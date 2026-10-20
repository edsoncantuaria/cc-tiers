import { config } from './config.js'
import { createServer } from './server.js'

createServer().listen(config.port, () => {
  console.log(`shiftlite-api listening on :${config.port}`)
})
