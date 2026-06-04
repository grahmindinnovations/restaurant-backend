import { Router } from 'express'
import { getDb } from '../../services/firebaseAdmin.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireAnyRole } from '../../middleware/roleAccess.js'
import { EVENTS } from '../../realtime/events.js'
import { readTables } from '../../utils/firestoreHelpers.js'

export function createTablesRouter({ io }) {
  const router = Router()
  const receptionAdmin = requireAnyRole('reception', 'admin')

  router.get('/tables', requireAuth, receptionAdmin, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('tables').get()
    const tables = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ tables })
  })

  router.patch('/tables/:id', requireAuth, receptionAdmin, async (req, res) => {
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

