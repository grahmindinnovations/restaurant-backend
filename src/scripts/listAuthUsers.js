import 'dotenv/config'
import { initFirebaseAdmin, getAuth } from '../services/firebaseAdmin.js'

async function main() {
  initFirebaseAdmin()
  const auth = getAuth()
  const res = await auth.listUsers(50)
  for (const u of res.users) {
    console.log(`${u.email || '(no email)'}  uid=${u.uid}`)
  }
  console.log(`Total: ${res.users.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
