import admin from 'firebase-admin'

export function actorFromReq(req) {
  return {
    uid: String(req.user?.uid || '') || null,
    email: String(req.user?.email || '').trim().toLowerCase() || null,
  }
}

export async function writeActivityLog(db, { action, category = 'admin', actor, detail = null, targetId = null }) {
  try {
    await db.collection('activity_logs').add({
      action: String(action || 'unknown'),
      category: String(category || 'admin'),
      actor: {
        uid: actor?.uid || null,
        email: actor?.email || null,
      },
      detail: detail ? String(detail) : null,
      targetId: targetId ? String(targetId) : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (e) {
    console.error('writeActivityLog failed:', e)
  }
}
