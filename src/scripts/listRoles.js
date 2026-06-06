import 'dotenv/config'
import { initFirebaseAdmin, getDb } from '../services/firebaseAdmin.js'
import { getAllowedRolesForEmail } from '../middleware/roleAccess.js'

async function main() {
  initFirebaseAdmin()
  const db = getDb()
  const snap = await db.collection('roles').get()
  console.log('roles collection:')
  if (snap.empty) {
    console.log('  (empty)')
  } else {
    snap.forEach((d) => {
      const data = d.data() || {}
      console.log(`  ${d.id}: allowed_email=${data.allowed_email ?? '(null)'}`)
    })
  }

  const testEmails = [
    'admin@example.com',
    'reception@example.com',
    'kitchen@example.com',
  ]
  for (const email of testEmails) {
    const roles = await getAllowedRolesForEmail(email)
    console.log(`${email} -> [${roles.join(', ')}]`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
