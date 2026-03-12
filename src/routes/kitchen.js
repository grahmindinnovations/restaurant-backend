import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../services/firebaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'
import { EVENTS } from '../realtime/events.js'

export function createKitchenRouter({ io }) {
  const router = Router()

  // Get kitchen config (settings/kitchen_config)
  router.get('/kitchen/config', requireAuth, async (req, res) => {
    const db = getDb()
    const ref = db.collection('settings').doc('kitchen_config')
    const snap = await ref.get()
    if (!snap.exists) {
      const initial = {
        status: 'online',
        opening_time: '10:00',
        closing_time: '23:00',
      }
      await ref.set(initial)
      return res.json(initial)
    }
    return res.json(snap.data() || {})
  })

  // Update kitchen config (status/schedule)
  router.patch('/kitchen/config', requireAuth, async (req, res) => {
    const db = getDb()
    const ref = db.collection('settings').doc('kitchen_config')
    const patch = req.body && typeof req.body === 'object' ? req.body : {}
    const allowed = {}
    if (patch.status !== undefined) allowed.status = String(patch.status || '').toLowerCase()
    if (patch.opening_time !== undefined) allowed.opening_time = String(patch.opening_time || '')
    if (patch.closing_time !== undefined) allowed.closing_time = String(patch.closing_time || '')

    await ref.set(
      {
        ...allowed,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    const snap = await ref.get()
    return res.json(snap.data() || {})
  })

  // Finish order: update stock, mark order completed, free table
  router.post('/kitchen/orders/:id/finish', requireAuth, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    const orderSnap = await db.collection('orders').doc(id).get()
    if (!orderSnap.exists) {
      return res.status(404).json({ error: 'Order not found' })
    }
    const order = orderSnap.data() || {}
    const status = String(order.status || '').toLowerCase()
    if (status === 'completed' || status === 'paid') {
      return res.json({ ok: true, alreadyCompleted: true })
    }

    const lines = Array.isArray(order.items) ? order.items : []
    if (lines.length > 0) {
      await db.runTransaction(async (tx) => {
        for (const line of lines) {
          const itemId = line?.id
          const qty = Number(line?.qty) || 0
          if (!itemId || qty <= 0) continue
          const ref = db.collection('menu_items').doc(String(itemId))
          const snap = await tx.get(ref)
          const data = snap.exists ? snap.data() || {} : {}
          const currentQty = Number(data.daily_quantity) || 0
          const nextQty = Math.max(0, currentQty - qty)
          const patch = { daily_quantity: nextQty }
          if (nextQty === 0) patch.available = false
          tx.set(ref, patch, { merge: true })
        }
      })
    }

    await db
      .collection('orders')
      .doc(id)
      .set(
        {
          status: 'completed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    const tableId = order.table || null
    if (tableId) {
      await db
        .collection('tables')
        .doc(String(tableId))
        .set(
          {
            status: 'available',
            currentOrderId: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
    }

    io?.emit(EVENTS.ORDERS_UPDATE, await readOrders(db))
    if (tableId) {
      io?.emit(EVENTS.TABLES_UPDATE, await readTables(db))
    }

    res.json({ ok: true })
  })

  return router
}

async function readOrders(db) {
  const snap = await db.collection('orders').orderBy('createdAt', 'desc').get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

async function readTables(db) {
  const snap = await db.collection('tables').get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

