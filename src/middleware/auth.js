import { getAuth } from '../services/firebaseAdmin.js'



function parseBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization
  if (!h) return null
  const m = String(h).match(/^Bearer\s+(.+)$/i)
  return m ? m[1] : null
}

export async function requireAuth(req, res, next) {
  const token = parseBearerToken(req)
  if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' })

  try {
    const decoded = await getAuth().verifyIdToken(token)
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      claims: decoded,
    }
    return next()
  } catch (e) {
    return res.status(401).json({ error: 'Invalid/expired token' })
  }
}

