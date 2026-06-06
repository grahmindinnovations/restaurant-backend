import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { getAllowedRolesForEmail } from '../../middleware/roleAccess.js'

// Small in-memory cache to keep /api/me fast and reduce Firestore reads.
const ME_CACHE_TTL_MS = 30_000
const meCache = new Map()

export function createMeRouter() {
  const router = Router()

  router.get('/me', requireAuth, async (req, res) => {
    try {
      const uid = String(req.user?.uid || '')
      const email = String(req.user?.email || '')
        .trim()
        .toLowerCase()

      const cached = email ? meCache.get(email) : null
      if (cached && Date.now() - cached.ts < ME_CACHE_TTL_MS) {
        res.set('Cache-Control', 'no-store')
        return res.status(200).json(cached.payload)
      }

      const allowedRoles = await getAllowedRolesForEmail(email, uid)

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

