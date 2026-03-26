import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../services/firebaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'

export function createStaffRouter() {
  const router = Router()

  const pad2 = (n) => {
    const x = Number(n)
    return x < 10 ? `0${x}` : String(x)
  }

  const toDateKey = (raw) => {
    if (!raw) return null
    const d = raw instanceof Date ? raw : new Date(raw)
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  }

  const toMinutes = (val) => {
    const m = String(val || '').match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const h = Number(m[1])
    const mm = Number(m[2])
    if (!Number.isFinite(h) || !Number.isFinite(mm)) return null
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
    return h * 60 + mm
  }

  const lateMinutes = (checkIn, shiftStart) => {
    const cin = toMinutes(checkIn)
    const ss = toMinutes(shiftStart)
    if (cin == null || ss == null) return 0
    return Math.max(0, cin - ss)
  }

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

  router.get('/staff/attendance', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('staff_attendance').orderBy('date', 'desc').limit(50).get()
    const records = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ records })
  })

  router.get('/staff/payroll', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('staff_payroll').orderBy('month', 'desc').limit(50).get()
    const records = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ records })
  })

  router.get('/staff/roles', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('staff_roles').get()
    const roles = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ roles })
  })

  router.post('/staff/roles', requireAuth, async (req, res) => {
    const db = getDb()
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const name = String(body.name || '').trim()
    if (!name) return res.status(400).json({ error: 'name is required' })

    const rawPerms = Array.isArray(body.permissions) ? body.permissions : []
    const permissions = Array.from(
      new Set(rawPerms.map((p) => String(p || '').trim()).filter(Boolean))
    )

    const ref = await db.collection('staff_roles').add({
      name,
      permissions,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    res.json({ ok: true, id: ref.id })
  })

  router.patch('/staff/roles/:id', requireAuth, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: 'Missing id' })

    const patch = req.body && typeof req.body === 'object' ? req.body : {}
    const allowed = {}

    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim()
      if (!name) return res.status(400).json({ error: 'name is required' })
      allowed.name = name
    }

    if (patch.permissions !== undefined) {
      const rawPerms = Array.isArray(patch.permissions) ? patch.permissions : []
      allowed.permissions = Array.from(
        new Set(rawPerms.map((p) => String(p || '').trim()).filter(Boolean))
      )
    }

    await db.collection('staff_roles').doc(id).set(
      {
        ...allowed,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    res.json({ ok: true })
  })

  router.delete('/staff/roles/:id', requireAuth, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: 'Missing id' })
    await db.collection('staff_roles').doc(id).delete()
    res.json({ ok: true })
  })

  router.get('/staff/shifts', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('staff_shifts').orderBy('startTime', 'desc').limit(100).get()
    const shifts = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ shifts })
  })

  router.get('/attendance', requireAuth, async (req, res) => {
    const db = getDb()
    const date = toDateKey(req.query.date)
    if (!date) return res.status(400).json({ error: 'Invalid or missing date (YYYY-MM-DD)' })

    const snap = await db.collection('staff_attendance').where('date', '==', date).get()
    const records = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ records })
  })

  router.post('/attendance/mark', requireAuth, async (req, res) => {
    const db = getDb()
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const staffId = String(body.staffId || '').trim()
    const date = toDateKey(body.date)
    if (!staffId) return res.status(400).json({ error: 'staffId is required' })
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' })

    const shiftStart = String(body.shiftStart || '10:00')
    const shiftEnd = String(body.shiftEnd || '18:00')

    const rawAction = String(body.action || '').trim().toLowerCase()
    const action = rawAction.replace(/[\s-]+/g, '_')
    const status = body.status != null ? String(body.status || '').trim() : null
    const time = body.time != null ? String(body.time || '').trim() : null

    const docId = `${staffId}_${date}`
    const ref = db.collection('staff_attendance').doc(docId)
    const snap = await ref.get()
    const prev = snap.exists ? snap.data() || {} : {}

    const patch = {
      staff_id: staffId,
      date,
      shift_start: shiftStart,
      shift_end: shiftEnd,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    if (action === 'checkin' || action === 'check_in' || action === 'in') {
      patch.check_in = time || prev.check_in || null
      patch.status = 'Present'
      patch.late_minutes = lateMinutes(patch.check_in, shiftStart)
    } else if (action === 'checkout' || action === 'check_out' || action === 'out') {
      patch.check_out = time || prev.check_out || null
      patch.status = String(prev.status || 'Present')
      patch.late_minutes = prev.late_minutes ?? lateMinutes(String(prev.check_in || ''), shiftStart)
    } else if (status) {
      patch.status = status
      patch.late_minutes = prev.late_minutes ?? lateMinutes(String(prev.check_in || ''), shiftStart)
    } else {
      return res.status(400).json({ error: 'Provide action=check_in|check_out (or checkin|checkout) or status' })
    }

    if (!snap.exists) {
      patch.createdAt = admin.firestore.FieldValue.serverTimestamp()
    }

    await ref.set(patch, { merge: true })
    const saved = await ref.get()
    res.json({ ok: true, record: { id: saved.id, ...(saved.data() || {}) } })
  })

  return router
}

