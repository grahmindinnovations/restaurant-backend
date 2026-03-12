import { Router } from 'express'
import { getDb } from '../services/firebaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'
import { EVENTS } from '../realtime/events.js'

export function createTablesRouter({ io }) {
  const router = Router()

  router.get('/tables', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('tables').get()
    const tables = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ tables })
  })

  router.patch('/tables/:id', requireAuth, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    const patch = req.body && typeof req.body === 'object' ? req.body : {}

    await db.collection('tables').doc(id).set(
      {
        ...patch,
        updatedAt: new Date(),
      },
      { merge: true }
    )

    res.json({ ok: true })
    io?.emit(EVENTS.TABLES_UPDATE, await readTables(db))
  })

  return router
}

async function readTables(db) {
  const snap = await db.collection('tables').get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

