import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../services/firebaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'
import { EVENTS } from '../realtime/events.js'

export function createMenuRouter({ io }) {
  const router = Router()

  router.get('/menu', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('menu_items').orderBy('name').get()
    const menu = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ menu })
  })

  router.post('/menu', requireAuth, async (req, res) => {
    const db = getDb()
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const payload = {
      name: String(body.name || '').trim(),
      category: String(body.category || 'Main Course').trim(),
      price: Number(body.price) || 0,
      image_url:
        body.image_url ||
        'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&q=80',
      is_active: true,
      daily_quantity: Number(body.daily_quantity) || 50,
      size: body.size || 'Regular',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }
    if (!payload.name) {
      return res.status(400).json({ error: 'Name is required' })
    }

    const ref = db.collection('menu_items').doc()
    await ref.set(payload)
    io?.emit(EVENTS.MENU_UPDATE, await readMenu(db))
    res.json({ ok: true, id: ref.id })
  })

  router.patch('/menu/:id', requireAuth, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    const patch = req.body && typeof req.body === 'object' ? req.body : {}

    await db.collection('menu_items').doc(id).set(
      {
        ...patch,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    res.json({ ok: true })
    io?.emit(EVENTS.MENU_UPDATE, await readMenu(db))
  })

  router.delete('/menu/:id', requireAuth, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    await db.collection('menu_items').doc(id).delete()
    res.json({ ok: true })
    io?.emit(EVENTS.MENU_UPDATE, await readMenu(db))
  })

  return router
}

async function readMenu(db) {
  const snap = await db.collection('menu_items').orderBy('name').get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

