import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../services/firebaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'

export function createStaffRouter() {
  const router = Router()

  // List staff members
  router.get('/staff', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('staff').orderBy('name').get()
    const staff = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ staff })
  })

  // Create a staff member
  router.post('/staff', requireAuth, async (req, res) => {
    const db = getDb()
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const payload = {
      name: String(body.name || '').trim(),
      role: String(body.role || 'Employee').trim(),
      email: body.email ? String(body.email).trim() : null,
      phone: body.phone ? String(body.phone).trim() : null,
      status: String(body.status || 'active').trim(),
      salary: Number(body.salary) || 0,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }
    if (!payload.name) {
      return res.status(400).json({ error: 'Name is required' })
    }
    const ref = db.collection('staff').doc()
    await ref.set(payload)
    res.json({ ok: true, id: ref.id })
  })

  // Update a staff member
  router.patch('/staff/:id', requireAuth, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    const patch = req.body && typeof req.body === 'object' ? req.body : {}
    const allowed = {}
    if (patch.name !== undefined) allowed.name = String(patch.name || '').trim()
    if (patch.role !== undefined) allowed.role = String(patch.role || '').trim()
    if (patch.email !== undefined) allowed.email = patch.email ? String(patch.email).trim() : null
    if (patch.phone !== undefined) allowed.phone = patch.phone ? String(patch.phone).trim() : null
    if (patch.status !== undefined) allowed.status = String(patch.status || '').trim()
    if (patch.salary !== undefined) allowed.salary = Number(patch.salary) || 0

    await db.collection('staff').doc(id).set(
      {
        ...allowed,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    res.json({ ok: true })
  })

  return router
}

