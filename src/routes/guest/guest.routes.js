import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../../services/firebaseAdmin.js'
import { EVENTS } from '../../realtime/events.js'
import { readOrders, readTables } from '../../utils/firestoreHelpers.js'

const GUEST_STAGES = ['placed', 'received', 'preparing', 'ready', 'served', 'bill_ready', 'paid']

function calcBill(items) {
  const sub = items.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 1), 0)
  const gst = Math.round(sub * 0.05)
  const service = Math.round(sub * 0.05)
  return { subTotal: sub, gst, serviceCharge: service, total: sub + gst + service }
}

async function sendEbillStub(order, phone) {
  console.log(`[e-bill] WhatsApp stub → ${phone} · Order #${order.id} · ₹${order.total}`)
  return { sent: true, channel: 'whatsapp_stub' }
}

export function createGuestRouter({ io }) {
  const router = Router()

  router.get('/guest/tables/:tableId/menu', async (req, res) => {
    try {
      const db = getDb()
      const snap = await db.collection('menu_items').get()
      const menu = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.available !== false)
      res.json({ tableId: req.params.tableId, menu })
    } catch (e) {
      console.error('guest menu failed:', e)
      res.status(500).json({ error: 'Failed to load menu' })
    }
  })

  router.post('/guest/tables/:tableId/orders', async (req, res) => {
    try {
      const db = getDb()
      const tableId = String(req.params.tableId)
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const items = Array.isArray(body.items) ? body.items : []
      if (items.length === 0) return res.status(400).json({ error: 'No items' })

      const guestPhone = String(body.guestPhone || body.phone || '').trim()
      const id = String(Date.now()).slice(-6)
      const bill = calcBill(items)

      const order = {
        id,
        source: 'guest',
        type: 'dine-in',
        table: tableId,
        tableId,
        status: 'kot',
        guestLifecycle: 'placed',
        items,
        guestPhone: guestPhone || null,
        ...bill,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }

      await db.collection('orders').doc(id).set(order)
      await db.collection('tables').doc(tableId).set(
        {
          status: 'occupied',
          currentOrderId: id,
          phone: guestPhone || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      io?.emit(EVENTS.ORDERS_UPDATE, await readOrders(db))
      io?.emit(EVENTS.TABLES_UPDATE, await readTables(db))

      res.json({ ok: true, orderId: id, order: { ...order, createdAt: new Date().toISOString() } })
    } catch (e) {
      console.error('guest order failed:', e)
      res.status(500).json({ error: 'Failed to place order' })
    }
  })

  router.get('/guest/orders/:orderId/track', async (req, res) => {
    try {
      const db = getDb()
      const snap = await db.collection('orders').doc(String(req.params.orderId)).get()
      if (!snap.exists) return res.status(404).json({ error: 'Order not found' })
      const order = { id: snap.id, ...snap.data() }
      res.json({
        orderId: order.id,
        table: order.table || order.tableId,
        items: order.items || [],
        guestLifecycle: order.guestLifecycle || 'placed',
        status: order.status,
        estimatedMinutes: order.estimatedMinutes || null,
        estimatedReadyAt: order.estimatedReadyAt || null,
        total: order.total,
        ebillSent: Boolean(order.ebillSentAt),
        guestPhone: order.guestPhone,
      })
    } catch (e) {
      res.status(500).json({ error: 'Track failed' })
    }
  })

  router.post('/guest/orders/:orderId/pay', async (req, res) => {
    try {
      const db = getDb()
      const id = String(req.params.orderId)
      const snap = await db.collection('orders').doc(id).get()
      if (!snap.exists) return res.status(404).json({ error: 'Order not found' })

      const phone = String(req.body?.guestPhone || req.body?.phone || snap.data()?.guestPhone || '').trim()
      const patch = {
        status: 'paid',
        guestLifecycle: 'paid',
        guestPhone: phone || null,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }

      await db.collection('orders').doc(id).set(patch, { merge: true })
      const order = { id, ...snap.data(), ...patch, guestPhone: phone }

      const ebill = await sendEbillStub(order, phone)
      if (ebill.sent) {
        await db.collection('orders').doc(id).set(
          { ebillSentAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true },
        )
      }

      const tableId = String(order.tableId || order.table || '')
      if (tableId) {
        await db.collection('tables').doc(tableId).set(
          {
            status: 'available',
            currentOrderId: null,
            paymentStatus: 'paid',
            lastPaidAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      }

      io?.emit(EVENTS.ORDERS_UPDATE, await readOrders(db))
      io?.emit(EVENTS.TABLES_UPDATE, await readTables(db))

      res.json({ ok: true, ebillSent: ebill.sent, message: `E-bill sent to WhatsApp ${phone}` })
    } catch (e) {
      console.error('guest pay failed:', e)
      res.status(500).json({ error: 'Payment failed' })
    }
  })

  router.patch('/guest/orders/:orderId/lifecycle', async (req, res) => {
    try {
      const db = getDb()
      const id = String(req.params.orderId)
      const next = String(req.body?.guestLifecycle || '').trim()
      if (!GUEST_STAGES.includes(next)) {
        return res.status(400).json({ error: 'Invalid guestLifecycle' })
      }

      const patch = {
        guestLifecycle: next,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }

      const mins = Number(req.body?.estimatedMinutes)
      if (Number.isFinite(mins) && mins > 0) {
        patch.estimatedMinutes = mins
        patch.estimatedReadyAt = new Date(Date.now() + mins * 60 * 1000).toISOString()
      }

      if (next === 'preparing') patch.status = 'kot'
      if (next === 'ready') patch.status = 'kot'
      if (next === 'served') {
        patch.status = 'billed'
        patch.guestLifecycle = 'bill_ready'
        const snap = await db.collection('orders').doc(id).get()
        const items = snap.exists ? snap.data()?.items || [] : []
        Object.assign(patch, calcBill(items))
      }

      await db.collection('orders').doc(id).set(patch, { merge: true })
      io?.emit(EVENTS.ORDERS_UPDATE, await readOrders(db))
      res.json({ ok: true, guestLifecycle: patch.guestLifecycle })
    } catch (e) {
      res.status(500).json({ error: 'Update failed' })
    }
  })

  return router
}
