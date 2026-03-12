import 'dotenv/config'
import admin from 'firebase-admin'
import { initFirebaseAdmin, getDb } from '../services/firebaseAdmin.js'

async function main() {
  console.log('Seeding demo data into Firestore...')
  initFirebaseAdmin()
  const db = getDb()

  const batch = db.batch()

  // --- Roles ---
  const roles = [
    { id: 'admin', title: 'Admin', allowed_email: null },
    { id: 'manager', title: 'Inventory Management System', allowed_email: null },
    { id: 'kitchen', title: 'Kitchen Chef', allowed_email: null },
    { id: 'reception', title: 'Reception', allowed_email: null },
    { id: 'employee', title: 'Staff Management System', allowed_email: null },
  ]

  for (const r of roles) {
    const ref = db.collection('roles').doc(r.id)
    batch.set(
      ref,
      {
        title: r.title,
        allowed_email: r.allowed_email ?? null,
      },
      { merge: true }
    )
  }

  // --- Tables T1–T10 ---
  for (let i = 1; i <= 10; i++) {
    const id = `T${i}`
    const ref = db.collection('tables').doc(id)
    batch.set(
      ref,
      {
        status: 'available',
        reservedBy: null,
        phone: null,
        currentOrderId: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  }

  // --- Menu items (simple demo set) ---
  const menuItems = [
    {
      name: 'Chicken Biryani',
      category: 'Main Course',
      price: 250,
      destination: 'kitchen',
      image_url:
        'https://images.unsplash.com/photo-1604908176997-1251883a3b55?w=600&q=80',
    },
    {
      name: 'Paneer Butter Masala',
      category: 'Main Course',
      price: 220,
      destination: 'kitchen',
      image_url:
        'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=600&q=80',
    },
    {
      name: 'Masala Dosa',
      category: 'Snacks',
      price: 120,
      destination: 'kitchen',
      image_url:
        'https://images.unsplash.com/photo-1603899122435-461b5dfbcd77?w=600&q=80',
    },
    {
      name: 'Cold Coffee',
      category: 'Drinks',
      price: 90,
      destination: 'kitchen',
      image_url:
        'https://images.unsplash.com/photo-1517705008128-361805f42e86?w=600&q=80',
    },
  ]

  for (const item of menuItems) {
    const ref = db.collection('menu_items').doc()
    batch.set(ref, {
      name: item.name,
      category: item.category,
      price: item.price,
      destination: item.destination,
      image_url: item.image_url,
      is_active: true,
      daily_quantity: 50,
      size: 'Regular',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  // --- Simple demo orders (optional) ---
  const now = admin.firestore.FieldValue.serverTimestamp()
  const ordersRef1 = db.collection('orders').doc('100001')
  batch.set(ordersRef1, {
    id: '100001',
    source: 'reception',
    destination: 'kitchen',
    type: 'dine-in',
    table: 'T1',
    status: 'billed',
    items: [
      { id: null, name: 'Chicken Biryani', qty: 2, price: 250 },
      { id: null, name: 'Cold Coffee', qty: 2, price: 90 },
    ],
    subTotal: 680,
    serviceCharge: 0,
    gst: 0,
    total: 680,
    createdAt: now,
    updatedAt: now,
  })

  const ordersRef2 = db.collection('orders').doc('100002')
  batch.set(ordersRef2, {
    id: '100002',
    source: 'reception',
    destination: 'kitchen',
    type: 'takeaway',
    table: null,
    status: 'kot',
    items: [
      { id: null, name: 'Paneer Butter Masala', qty: 1, price: 220 },
      { id: null, name: 'Masala Dosa', qty: 2, price: 120 },
    ],
    subTotal: 460,
    serviceCharge: 0,
    gst: 0,
    total: 460,
    createdAt: now,
    updatedAt: now,
  })

  await batch.commit()
  console.log('Seed completed.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

