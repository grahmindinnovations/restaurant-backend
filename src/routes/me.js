import { Router } from 'express'
import { getDb } from '../services/firebaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'

const KNOWN_ROLES = ['reception', 'kitchen', 'manager', 'employee', 'admin']

// Small in-memory cache to keep /api/me fast and reduce Firestore reads.
// Keyed by email; short TTL to avoid stale access.
const ME_CACHE_TTL_MS = 30_000
const meCache = new Map() // email -> { ts: number, payload: any }

async function isRoleAllowed(db, roleId, email) {
  try {
    const id = String(roleId || '').trim().toLowerCase()
    if (!id) return false

    const roleSnap = await db.collection('roles').doc(id).get()
    if (!roleSnap.exists) return false

    const allowedEmail = String(roleSnap.data()?.allowed_email || '')
      .trim()
      .toLowerCase()

    // If allowed_email is empty => open access for that role
    if (!allowedEmail) return true
    return allowedEmail === email
  } catch (e) {
    console.error('Role check failed:', e)
    return false
  }
}

export function createMeRouter() {
  const router = Router()

  router.get('/me', requireAuth, async (req, res) => {
    try {
      const db = getDb()
      const uid = String(req.user?.uid || '')
      const email = String(req.user?.email || '')
        .trim()
        .toLowerCase()

      const cached = email ? meCache.get(email) : null
      if (cached && Date.now() - cached.ts < ME_CACHE_TTL_MS) {
        res.set('Cache-Control', 'no-store')
        return res.status(200).json(cached.payload)
      }

      const checks = await Promise.all(
        KNOWN_ROLES.map(async (roleId) => ({
          roleId,
          allowed: await isRoleAllowed(db, roleId, email),
        }))
      )

      const allowedRoles = checks.filter((c) => c.allowed).map((c) => c.roleId)

      // Default role heuristic: prefer reception (POS) for single-station setups.
      const defaultRole =
        allowedRoles.includes('reception')
          ? 'reception'
          : allowedRoles[0] || null

      // Avoid 304/ETag caching weirdness for auth-dependent responses.
      res.set('Cache-Control', 'no-store')
      const payload = {
        ok: true,
        user: { uid: uid || null, email: email || null },
        allowedRoles,
        defaultRole,
      }
      if (email) {
        meCache.set(email, { ts: Date.now(), payload })
      }
      return res.status(200).json(payload)
    } catch (e) {
      console.error('GET /me failed:', e)
      return res.status(500).json({ error: 'Failed to load user profile' })
    }
  })

  return router
}

