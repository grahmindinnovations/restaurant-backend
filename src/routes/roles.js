import { Router } from 'express'
import { getDb } from '../services/firebaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'

export function createRolesRouter() {
  const router = Router()

  router.get('/roles/:roleId/access', requireAuth, async (req, res) => {
    const roleId = String(req.params.roleId || '').trim().toLowerCase()
    const userEmail = String(req.user?.email || '').trim().toLowerCase()

    if (!roleId) return res.status(400).json({ error: 'Missing roleId' })
    if (!userEmail) return res.status(400).json({ error: 'No email on user token' })

    const db = getDb()
    const docRef = db.collection('roles').doc(roleId)
    const snap = await docRef.get()

    if (!snap.exists) {
      return res.status(404).json({ allowed: false, error: `Role '${roleId}' not configured` })
    }

    const data = snap.data() || {}
    const allowedEmail = String(data.allowed_email || '').trim().toLowerCase()
    if (!allowedEmail) return res.json({ allowed: true })

    const allowed = userEmail === allowedEmail
    return res.json({ allowed })
  })

  return router
}

