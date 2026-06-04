import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../../services/firebaseAdmin.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireAnyRole } from '../../middleware/roleAccess.js'
import { EVENTS } from '../../realtime/events.js'
import {
  readOrders,
  readTables,
  tableIdFromOrder,
} from '../../utils/firestoreHelpers.js'

export function createOrdersRouter({ io }) {
  const router = Router()
  const stationRoles = requireAnyRole('reception', 'kitchen', 'admin')
  const receptionAdmin = requireAnyRole('reception', 'admin')
  const kitchenAdmin = requireAnyRole('kitchen', 'admin')

  router.get('/orders', requireAuth, stationRoles, async (req, res) => {
    try {
      const db = getDb()
      const status = req.query.status ? String(req.query.status) : null

      // Firestore requires a composite index for:
      //   where('status','==',X) + orderBy('createdAt','desc')
      // To keep local/dev friction low, avoid that composite index by doing:
      // - filtered query without orderBy
      // - sort in memory (safe enough for the current scale; add pagination later)
      const snap = status
        ? await db.collection('orders').where('status', '==', status).get()
        : await db.collection('orders').orderBy('createdAt', 'desc').get()

      const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

      if (status) {
        const toMs = (v) => {
          if (!v) return 0
          if (typeof v?.toMillis === 'function') return v.toMillis()
          if (typeof v?.toDate === 'function') return v.toDate().getTime()
          const dt = v instanceof Date ? v : new Date(v)
          return Number.isNaN(dt.getTime()) ? 0 : dt.getTime()
        }
        orders.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
      }

      res.json({ orders })
    } catch (e) {
      console.error('GET /orders failed:', e)
      res.status(500).json({ error: 'Failed to load orders' })
    }
  })

  router.post('/orders', requireAuth, receptionAdmin, async (req, res) => {
    const db = getDb()
    const body = req.body && typeof req.body === 'object' ? req.body : {}

    const id = body.id ? String(body.id) : String(Date.now()).slice(-6)
    const docRef = db.collection('orders').doc(id)

    const payload = {
      ...body,
      id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    await docRef.set(payload, { merge: true })
    res.json({ ok: true, id })

    io?.emit(EVENTS.ORDERS_UPDATE, await readOrders(db))
  })

  router.post('/orders/:id/cancel', requireAuth, receptionAdmin, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    const snap = await db.collection('orders').doc(id).get()
    if (!snap.exists) {
      return res.status(404).json({ error: 'Order not found' })
    }

    const order = snap.data() || {}
    const status = String(order.status || '').toLowerCase()
    if (status === 'cancelled') {
      return res.json({ ok: true, alreadyCancelled: true })
    }
    if (status === 'paid' || status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel a paid or completed order' })
    }

    const reason =
      req.body && typeof req.body.reason === 'string' ? req.body.reason.trim() : ''

    await db.collection('orders').doc(id).set(
      {
        status: 'cancelled',
        cancelReason: reason || null,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    const tableIdStr = tableIdFromOrder(order)
    if (tableIdStr && !tableIdStr.includes('/')) {
      const tableRef = db.collection('tables').doc(tableIdStr)
      const tableSnap = await tableRef.get()
      const tableData = tableSnap.exists ? tableSnap.data() || {} : {}
      if (String(tableData.currentOrderId || '') === id) {
        await tableRef.set(
          {
            status: 'available',
            currentOrderId: null,
            reservedBy: null,
            phone: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      }
    }

    res.json({ ok: true })
    io?.emit(EVENTS.ORDERS_UPDATE, await readOrders(db))
    if (tableIdStr) {
      io?.emit(EVENTS.TABLES_UPDATE, await readTables(db))
    }
  })

  router.post('/orders/:id/pay', requireAuth, receptionAdmin, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    await db.collection('orders').doc(id).set(
      {
        status: 'paid',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    res.json({ ok: true })
    io?.emit(EVENTS.ORDERS_UPDATE, await readOrders(db))
  })

  router.post('/orders/:id/deliver', requireAuth, kitchenAdmin, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    await db.collection('orders').doc(id).set(
      {
        status: 'delivered',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    res.json({ ok: true })
    io?.emit(EVENTS.ORDERS_UPDATE, await readOrders(db))
  })

  router.patch('/orders/:id/status', requireAuth, kitchenAdmin, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    const next = String(req.body?.status || '').trim()
    if (!next) return res.status(400).json({ error: 'Missing status' })

    await db.collection('orders').doc(id).set(
      {
        status: next,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    res.json({ ok: true })
    io?.emit(EVENTS.ORDERS_UPDATE, await readOrders(db))
  })

  return router
}

