import 'dotenv/config'
import http from 'http'

import { initFirebaseAdmin } from './services/firebaseAdmin.js'
import { createApp, FRONTEND_ORIGINS } from './app/createApp.js'
import { registerApiRoutes } from './routes/index.js'
import { createSocketServer } from './realtime/socket.js'

const PORT = Number(process.env.PORT || 5180)

initFirebaseAdmin()

const app = createApp()
const server = http.createServer(app)
const io = createSocketServer(server, { corsOrigin: FRONTEND_ORIGINS })

registerApiRoutes(app, { io })

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the other backend (netstat -ano | findstr :${PORT}) and run npm run dev once.`,
    )
    process.exit(1)
  }
  throw err
})

// In Docker/production nginx reaches the container via published ports — must bind 0.0.0.0, not loopback only.
const HOST =
  process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')

server.listen(PORT, HOST, () => {
  console.log(`Backend listening on http://${HOST}:${PORT}`)
})

let shuttingDown = false
function gracefulShutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received — closing server…`)
  server.close(() => {
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
