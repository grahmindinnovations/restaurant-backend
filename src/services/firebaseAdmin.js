import admin from 'firebase-admin'

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON (must be valid JSON).')
  }
}

let app = null

export function initFirebaseAdmin() {
  if (app) return app

  const hasDefaultCreds = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  const svcAccount = loadServiceAccount()

  if (!hasDefaultCreds && !svcAccount) {
    throw new Error(
      'Firebase Admin is not configured. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON.'
    )
  }

  app = admin.initializeApp(
    svcAccount
      ? { credential: admin.credential.cert(svcAccount) }
      : { credential: admin.credential.applicationDefault() }
  )

  return app
}

export function getAuth() {
  if (!app) initFirebaseAdmin()
  return admin.auth()
}

export function getDb() {
  if (!app) initFirebaseAdmin()
  return admin.firestore()
}

