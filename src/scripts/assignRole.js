import 'dotenv/config'
import { initFirebaseAdmin, getAuth, getDb } from '../services/firebaseAdmin.js'

const email = String(process.argv[2] || '').trim().toLowerCase()
const roleId = String(process.argv[3] || 'admin').trim().toLowerCase()
const KNOWN = ['admin', 'reception', 'kitchen', 'manager', 'employee']

async function main() {
  if (!email) {
    console.error('Usage: npm run assign-role -- <email> [role]')
    console.error('Example: npm run assign-role -- you@gmail.com admin')
    process.exit(1)
  }
  if (!KNOWN.includes(roleId)) {
    console.error(`Unknown role "${roleId}". Use one of: ${KNOWN.join(', ')}`)
    process.exit(1)
  }

  initFirebaseAdmin()
  const auth = getAuth()
  const db = getDb()

  let uid = null
  try {
    const record = await auth.getUserByEmail(email)
    uid = record.uid
    console.log(`Found Firebase user ${email} (uid=${uid})`)
  } catch (e) {
    if (e?.code === 'auth/user-not-found') {
      console.error(`No Firebase Auth user for ${email}. Create the user in Firebase Console first, or use seed:auth demo accounts.`)
      process.exit(1)
    }
    throw e
  }

  await db.collection('roles').doc(roleId).set({ allowed_email: email }, { merge: true })
  await db
    .collection('users')
    .doc(uid)
    .set(
      {
        email,
        role: roleId,
        status: 'active',
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    )

  console.log(`Assigned ${email} -> role "${roleId}" (roles/${roleId}.allowed_email updated)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
