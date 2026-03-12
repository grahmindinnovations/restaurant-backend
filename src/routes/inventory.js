import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../services/firebaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'

export function createInventoryRouter() {
  const router = Router()

  // List inventory items (backed by menu_items)
  router.get('/inventory/items', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('menu_items').orderBy('name').get()
    const items = snap.docs.map((d) => {
      const data = d.data() || {}
      return {
        id: d.id,
        name: data.name || '',
        category: data.category || 'General',
        price: Number(data.price) || 0,
        daily_quantity: Number(data.daily_quantity) || 0,
        available: data.available ?? data.is_active ?? true,
        is_active: data.is_active ?? true,
        updated_at: data.updated_at || null,
      }
    })
    res.json({ items })
  })

  // Simple summary: counts and low stock
  router.get('/inventory/summary', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('menu_items').get()
    let totalItems = 0
    let lowStock = 0
    let outOfStock = 0
    const threshold = Number(req.query.lowThreshold ?? 20)

    snap.forEach((d) => {
      const data = d.data() || {}
      const qty = Number(data.daily_quantity) || 0
      totalItems += 1
      if (qty === 0) outOfStock += 1
      else if (qty > 0 && qty < threshold) lowStock += 1
    })

    res.json({ totalItems, lowStock, outOfStock, lowThreshold: threshold })
  })

  // Update an inventory item (quantity/price/availability)
  router.patch('/inventory/items/:id', requireAuth, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    const patch = req.body && typeof req.body === 'object' ? req.body : {}

    const allowed = {}
    if (patch.daily_quantity !== undefined) {
      allowed.daily_quantity = Number(patch.daily_quantity) || 0
      if (allowed.daily_quantity === 0 && patch.available === undefined) {
        allowed.available = false
      }
    }
    if (patch.price !== undefined) {
      allowed.price = Number(patch.price) || 0
    }
    if (patch.available !== undefined) {
      allowed.available = Boolean(patch.available)
      if (allowed.available && allowed.daily_quantity === undefined) {
        allowed.is_active = true
      }
    }

    await db.collection('menu_items').doc(id).set(
      {
        ...allowed,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    res.json({ ok: true })
  })

  return router
}

