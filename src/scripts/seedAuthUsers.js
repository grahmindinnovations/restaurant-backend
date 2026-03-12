import 'dotenv/config'
import admin from 'firebase-admin'
import { initFirebaseAdmin, getAuth, getDb } from '../services/firebaseAdmin.js'

async function main() {
  console.log('Seeding demo auth users...')
  initFirebaseAdmin()
  const auth = getAuth()
  const db = getDb()

  const users = [
    {
      roleId: 'admin',
      email: 'admin@example.com',
      password: 'Admin@12345',
      displayName: 'Demo Admin',
    },
    {
      roleId: 'manager',
      email: 'manager@example.com',
      password: 'Manager@12345',
      displayName: 'Demo Inventory Manager',
    },
    {
      roleId: 'kitchen',
      email: 'kitchen@example.com',
      password: 'Kitchen@12345',
      displayName: 'Demo Kitchen Chef',
    },
    {
      roleId: 'reception',
      email: 'reception@example.com',
      password: 'Reception@12345',
      displayName: 'Demo Reception',
    },
    {
      roleId: 'employee',
      email: 'staff@example.com',
      password: 'Staff@12345',
      displayName: 'Demo Staff',
    },
  ]

  for (const u of users) {
    let userRecord
    try {
      userRecord = await auth.createUser({
        email: u.email,
        password: u.password,
        displayName: u.displayName,
        emailVerified: false,
        disabled: false,
      })
      console.log(`Created user ${u.email} (uid=${userRecord.uid})`)
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        userRecord = await auth.getUserByEmail(u.email)
        console.log(`User ${u.email} already exists (uid=${userRecord.uid})`)
      } else {
        console.error(`Failed to create user ${u.email}:`, err.message)
        continue
      }
    }

    // Update Firestore roles.allowed_email for the mapped role
    if (u.roleId) {
      await db
        .collection('roles')
        .doc(u.roleId)
        .set(
          {
            allowed_email: u.email,
          },
          { merge: true }
        )
      console.log(`Updated role '${u.roleId}' allowed_email -> ${u.email}`)
    }
  }

  console.log('Auth users seed completed.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

