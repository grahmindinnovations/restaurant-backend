import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../services/firebaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'
import { EVENTS } from '../realtime/events.js'

export function createOrdersRouter({ io }) {
  const router = Router()

  router.get('/orders', requireAuth, async (req, res) => {
    const db = getDb()
    const status = req.query.status ? String(req.query.status) : null

    let q = db.collection('orders').orderBy('createdAt', 'desc')
    if (status) q = q.where('status', '==', status)

    const snap = await q.get()
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ orders })
  })

  router.post('/orders', requireAuth, async (req, res) => {
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

  router.post('/orders/:id/pay', requireAuth, async (req, res) => {
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

  router.post('/orders/:id/deliver', requireAuth, async (req, res) => {
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

  router.patch('/orders/:id/status', requireAuth, async (req, res) => {
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

async function readOrders(db) {
  const snap = await db.collection('orders').orderBy('createdAt', 'desc').get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

