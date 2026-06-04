import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import path from 'path'
import { fileURLToPath } from 'url'
import { ensureMenuUploadDir } from '../utils/menuImageUpload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsRoot = path.join(__dirname, '..', '..', 'uploads')

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
const FRONTEND_ORIGINS = [FRONTEND_ORIGIN, 'http://localhost:5173'].filter(Boolean)

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('etag', false)

  app.use(helmet())
  app.use(
    cors({
      origin: FRONTEND_ORIGINS,
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(morgan('dev'))

  ensureMenuUploadDir()
  app.use('/api/uploads', (req, res, next) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    res.set('Access-Control-Allow-Origin', FRONTEND_ORIGINS[0] || '*')
    next()
  })
  app.use(
    '/api/uploads',
    express.static(uploadsRoot, { maxAge: '7d', fallthrough: false }),
  )

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  return app
}

export { FRONTEND_ORIGINS }
