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

export async function getAllowedRolesForEmail(email) {
  const db = getDb()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) return []

  const checks = await Promise.all(
    KNOWN_ROLES.map(async (roleId) => ({
      roleId,
      allowed: await isRoleAllowed(db, roleId, normalizedEmail),
    })),
  )
  return checks.filter((c) => c.allowed).map((c) => c.roleId)
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
