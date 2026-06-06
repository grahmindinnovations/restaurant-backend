import { getDb } from '../services/firebaseAdmin.js'

export const KNOWN_ROLES = ['reception', 'kitchen', 'manager', 'employee', 'admin']

export async function isRoleAllowed(db, roleId, email) {
  try {
    const id = String(roleId || '').trim().toLowerCase()
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!id || !normalizedEmail) return false

    const roleSnap = await db.collection('roles').doc(id).get()
    if (!roleSnap.exists) return false

    const allowedEmail = String(roleSnap.data()?.allowed_email || '')
      .trim()
      .toLowerCase()

    if (!allowedEmail) return true
    return allowedEmail === normalizedEmail
  } catch (e) {
    console.error('Role check failed:', e)
    return false
  }
}

export async function getAllowedRolesForEmail(email, uid = null) {
  const db = getDb()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) return []

  const allowed = new Set()

  const checks = await Promise.all(
    KNOWN_ROLES.map(async (roleId) => ({
      roleId,
      ok: await isRoleAllowed(db, roleId, normalizedEmail),
    })),
  )
  checks.filter((c) => c.ok).forEach((c) => allowed.add(c.roleId))

  try {
    const userSnaps = await db.collection('users').where('email', '==', normalizedEmail).limit(10).get()
    userSnaps.forEach((doc) => {
      const data = doc.data() || {}
      if (String(data.status || 'active').toLowerCase() === 'disabled') return
      const profileRole = String(data.role || '').toLowerCase()
      if (KNOWN_ROLES.includes(profileRole)) allowed.add(profileRole)
    })
  } catch (e) {
    console.error('users-by-email role lookup failed:', e)
  }

  const uidStr = String(uid || '').trim()
  if (uidStr) {
    try {
      const userSnap = await db.collection('users').doc(uidStr).get()
      if (userSnap.exists) {
        const data = userSnap.data() || {}
        if (String(data.status || 'active').toLowerCase() !== 'disabled') {
          const profileRole = String(data.role || '').toLowerCase()
          if (KNOWN_ROLES.includes(profileRole)) allowed.add(profileRole)
        }
      }
      const adminSnap = await db.collection('admins').doc(uidStr).get()
      if (adminSnap.exists) {
        const adminEmail = String(adminSnap.data()?.email || '').trim().toLowerCase()
        if (!adminEmail || adminEmail === normalizedEmail) allowed.add('admin')
      }
    } catch (e) {
      console.error('Profile role lookup failed:', e)
    }
  }

  return Array.from(allowed)
}

export function requireAdminRole() {
  return async (req, res, next) => {
    try {
      const email = String(req.user?.email || '').trim().toLowerCase()
      const uid = String(req.user?.uid || '')
      const roles = await getAllowedRolesForEmail(email, uid)
      if (!roles.includes('admin')) {
        return res.status(403).json({ error: 'Admin access required' })
      }
      return next()
    } catch (e) {
      console.error('requireAdminRole failed:', e)
      return res.status(500).json({ error: 'Admin check failed' })
    }
  }
}

export function requireAnyRole(...roleIds) {
  const allowed = roleIds.map((r) => String(r).toLowerCase())

  return async (req, res, next) => {
    try {
      const email = String(req.user?.email || '').trim().toLowerCase()
      if (!email) return res.status(403).json({ error: 'Forbidden' })

      const db = getDb()
      for (const roleId of allowed) {
        if (await isRoleAllowed(db, roleId, email)) return next()
      }
      return res.status(403).json({ error: 'Forbidden: role not allowed' })
    } catch (e) {
      console.error('requireAnyRole failed:', e)
      return res.status(500).json({ error: 'Role check failed' })
    }
  }
}
