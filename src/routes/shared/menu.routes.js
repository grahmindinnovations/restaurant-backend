import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../../services/firebaseAdmin.js'
import { requireAuth } from '../../middleware/auth.js'
import { EVENTS } from '../../realtime/events.js'
import { readMenu } from '../../utils/firestoreHelpers.js'
import { menuImageUpload, publicMenuImageUrl } from '../../utils/menuImageUpload.js'

export function createMenuRouter({ io }) {
  const router = Router()

  router.post('/menu/upload-image', requireAuth, (req, res) => {
    menuImageUpload.single('image')(req, res, (err) => {
      if (err) {
        const msg = err.message || 'Upload failed'
        return res.status(400).json({ error: msg })
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' })
      }
      const url = publicMenuImageUrl(req, req.file.filename)
      return res.json({ ok: true, url })
    })
  })

  router.get('/menu', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('menu_items').orderBy('name').get()
    const menu = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ menu })
  })

  router.post('/menu', requireAuth, async (req, res) => {
    const db = getDb()
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const sellPrice = Number(body.price) || 0
    const rawCost = body.cost_price !== undefined ? Number(body.cost_price) : NaN
    const costPrice = Number.isFinite(rawCost)
      ? Math.max(0, rawCost)
      : sellPrice > 0
        ? Math.round(sellPrice * 0.4)
        : 0

    const payload = {
      name: String(body.name || '').trim(),
      category: String(body.category || 'Main Course').trim(),
      price: sellPrice,
      cost_price: costPrice,
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
    const allowed = { ...patch }
    if (patch.price !== undefined) allowed.price = Number(patch.price) || 0
    if (patch.cost_price !== undefined) {
      allowed.cost_price = Math.max(0, Number(patch.cost_price) || 0)
    }
    if (patch.daily_quantity !== undefined) {
      allowed.daily_quantity = Number(patch.daily_quantity) || 0
    }
    if (patch.available !== undefined) {
      allowed.available = Boolean(patch.available)
      if (patch.is_active === undefined) {
        allowed.is_active = allowed.available
      }
    }
    if (patch.is_active !== undefined) {
      allowed.is_active = Boolean(patch.is_active)
      if (patch.available === undefined) {
        allowed.available = allowed.is_active
      }
    }
    if (patch.name !== undefined) allowed.name = String(patch.name || '').trim()
    if (patch.category !== undefined) allowed.category = String(patch.category || 'General').trim()
    if (patch.image_url !== undefined) {
      allowed.image_url = patch.image_url ? String(patch.image_url).trim() : null
    }

    await db.collection('menu_items').doc(id).set(
      {
        ...allowed,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    res.json({ ok: true })
    io?.emit(EVENTS.MENU_UPDATE, await readMenu(db))
  })

  router.post('/menu/backfill-cost-prices', requireAuth, async (req, res) => {
    const db = getDb()
    const ratio = Math.min(1, Math.max(0, Number(req.body?.ratio ?? 0.4) || 0.4))
    const snap = await db.collection('menu_items').get()
    let updated = 0

    const batch = db.batch()
    snap.docs.forEach((d) => {
      const data = d.data() || {}
      const existing = Number(data.cost_price) || 0
      const price = Number(data.price) || 0
      if (existing > 0 || price <= 0) return
      batch.set(
        d.ref,
        {
          cost_price: Math.round(price * ratio),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      updated += 1
    })
    if (updated > 0) await batch.commit()
    io?.emit(EVENTS.MENU_UPDATE, await readMenu(db))
    res.json({ ok: true, updated, ratio })
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

