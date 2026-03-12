import 'dotenv/config'
import http from 'http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'

import { initFirebaseAdmin } from './services/firebaseAdmin.js'
import { createSocketServer } from './realtime/socket.js'

import { healthRouter } from './routes/health.js'
import { createMenuRouter } from './routes/menu.js'
import { createOrdersRouter } from './routes/orders.js'
import { createTablesRouter } from './routes/tables.js'
import { createRolesRouter } from './routes/roles.js'
import { createInventoryRouter } from './routes/inventory.js'
import { createStaffRouter } from './routes/staff.js'
import { createKitchenRouter } from './routes/kitchen.js'

const PORT = Number(process.env.PORT || 5180)
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

initFirebaseAdmin()

const app = express()
app.disable('x-powered-by')

app.use(helmet())
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  })
)
app.use(express.json({ limit: '1mb' }))
app.use(morgan('dev'))

app.use('/api', healthRouter)

const server = http.createServer(app)
const io = createSocketServer(server, { corsOrigin: FRONTEND_ORIGIN })

app.use('/api', createRolesRouter())
app.use('/api', createMenuRouter({ io }))
app.use('/api', createOrdersRouter({ io }))
app.use('/api', createTablesRouter({ io }))
app.use('/api', createInventoryRouter())
app.use('/api', createStaffRouter())
app.use('/api', createKitchenRouter({ io }))

server.listen(PORT, () => {
  // Keep output minimal; still useful for local dev
  console.log(`Backend listening on http://localhost:${PORT}`)
})

