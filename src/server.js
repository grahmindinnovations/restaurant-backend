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

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`)
})
