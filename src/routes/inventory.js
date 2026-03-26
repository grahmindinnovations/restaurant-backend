import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../services/firebaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'

export function createInventoryRouter() {
  const router = Router()

  const toNumber = (value, fallback = 0) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  const safe = (fn) => {
    return async (req, res) => {
      try {
        await fn(req, res)
      } catch (e) {
        console.error('Inventory route failed:', e)
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }

  const toNonEmptyString = (value) => {
    const s = String(value ?? '').trim()
    return s ? s : null
  }

  const toDate = (raw) => {
    if (!raw) return null
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
    if (typeof raw === 'string' || typeof raw === 'number') {
      const d = new Date(raw)
      return Number.isNaN(d.getTime()) ? null : d
    }
    if (typeof raw === 'object' && typeof raw.toDate === 'function') {
      const d = raw.toDate()
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
    }
    return null
  }

  const inventoryProductsCol = () => getDb().collection('inventory_products')
  const inventorySuppliersCol = (db) => db.collection('inventory_suppliers')
  const legacySuppliersCol = (db) => db.collection('suppliers')

  const normalizeSupplier = (doc) => {
    const data = doc?.data ? doc.data() || {} : doc || {}
    const id = doc?.id ? doc.id : String(data.id || '')
    const name = data.name ?? data.supplierName ?? data.supplier_name ?? data.company ?? ''
    return {
      id: String(id),
      name: String(name || ''),
      phone: data.phone ? String(data.phone) : '',
      email: data.email ? String(data.email) : '',
      address: data.address ? String(data.address) : '',
      gst: data.gst ? String(data.gst) : '',
    }
  }

  const normalizeKey = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()

  const readSuppliers = async (db, col) => {
    try {
      const snap = await col.get()
      return snap.docs.map((d) => normalizeSupplier(d))
    } catch {
      return []
    }
  }

  const findSupplierName = async (db, supplierId) => {
    const id = String(supplierId || '').trim()
    if (!id) return ''

    try {
      const invSnap = await inventorySuppliersCol(db).doc(id).get()
      if (invSnap.exists) return String(invSnap.data()?.name || invSnap.data()?.supplierName || '') || ''
    } catch {}

    try {
      const legacySnap = await legacySuppliersCol(db).doc(id).get()
      if (legacySnap.exists) return String(legacySnap.data()?.name || legacySnap.data()?.supplierName || '') || ''
    } catch {}

    return ''
  }

  router.get('/inventory/dashboard', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const lowThreshold = Math.max(0, toNumber(req.query.lowThreshold, 10))

    const [productsSnap, inventorySuppliers, legacySuppliers, entriesSnap] = await Promise.all([
      inventoryProductsCol().get(),
      readSuppliers(db, inventorySuppliersCol(db)),
      readSuppliers(db, legacySuppliersCol(db)),
      db.collection('stock_entries').orderBy('createdAt', 'desc').limit(50).get().catch(() => null),
    ])

    let totalProducts = 0
    let lowStockItems = 0
    const byCategory = new Map()

    productsSnap.forEach((d) => {
      const data = d.data() || {}
      const category = String(data.category || 'General').trim() || 'General'
      const stock = Math.max(0, toNumber(data.stock, 0))
      const deleted = Boolean(data.is_deleted)

      if (!deleted) totalProducts += 1
      if (!deleted && stock > 0 && stock <= lowThreshold) lowStockItems += 1

      if (!byCategory.has(category)) {
        byCategory.set(category, { category, activeStock: 0, deletedStock: 0, totalStock: 0 })
      }
      const row = byCategory.get(category)
      row.totalStock += stock
      if (deleted) row.deletedStock += stock
      else row.activeStock += stock
    })

    const stockByCategory = Array.from(byCategory.values()).sort((a, b) =>
      String(a.category).localeCompare(String(b.category))
    )

    const recentEntries = entriesSnap?.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })) || []
    const recentStockEntries = recentEntries.length

    const recentActivity = []
    for (const e of recentEntries.slice(0, 6)) {
      const dt = toDate(e.createdAt) || toDate(e.date)
      const time = dt ? dt.toLocaleString() : ''
      const productName = String(e.product_name || e.productName || '').trim()
      const supplierName = String(e.supplier_name || e.supplierName || '').trim()
      const qty = toNumber(e.quantity, 0)
      recentActivity.push({
        id: String(e.id),
        type: 'stock',
        title: productName ? `Stock Entry: ${productName}` : 'Stock Entry',
        description: `${qty.toLocaleString()} units${supplierName ? ` • ${supplierName}` : ''}`,
        time,
      })
    }
    if (lowStockItems > 0) {
      recentActivity.unshift({
        id: 'low-stock-alert',
        type: 'alert',
        title: 'Low Stock Alert',
        description: `${lowStockItems.toLocaleString()} items are running low.`,
        time: '',
      })
    }

    const suppliersMerged = new Map()
    for (const s of [...inventorySuppliers, ...legacySuppliers]) {
      const key = `${normalizeKey(s.name)}|${normalizeKey(s.phone)}`
      if (!key || key === '|') continue
      if (!suppliersMerged.has(key)) suppliersMerged.set(key, s)
    }

    res.json({
      totalProducts,
      lowStockItems,
      totalSuppliers: suppliersMerged.size,
      recentStockEntries,
      stockByCategory,
      recentActivity,
    })
  }))

  router.get('/inventory/alerts', requireAuth, safe(async (req, res) => {
    const threshold = Math.max(0, toNumber(req.query.threshold, 10))
    const snap = await inventoryProductsCol().orderBy('name').limit(1000).get()
    const alerts = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((p) => !p.is_deleted)
      .map((p) => ({
        id: String(p.id),
        name: String(p.name || ''),
        remaining: Math.max(0, toNumber(p.stock, 0)),
        threshold,
        category: String(p.category || 'General'),
      }))
      .filter((a) => a.remaining > 0 && a.remaining <= threshold)
      .sort((a, b) => a.remaining - b.remaining)

    res.json({ alerts, threshold })
  }))

  router.get('/inventory/categories', requireAuth, safe(async (req, res) => {
    const snap = await inventoryProductsCol().orderBy('category').get()
    const set = new Set()
    snap.forEach((d) => {
      const data = d.data() || {}
      if (data.is_deleted) return
      const cat = String(data.category || '').trim()
      if (!cat) return
      set.add(cat)
    })
    res.json({ categories: Array.from(set).sort((a, b) => a.localeCompare(b)) })
  }))

  router.get('/inventory/products', requireAuth, safe(async (req, res) => {
    const deletedMode = String(req.query.deleted ?? 'exclude')
    const category = String(req.query.category ?? 'All')
    const search = String(req.query.search ?? '').trim().toLowerCase()

    const snap = await inventoryProductsCol().orderBy('name').limit(1000).get()
    const products = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((p) => {
        const isDeleted = Boolean(p.is_deleted)
        if (deletedMode === 'only' && !isDeleted) return false
        if (deletedMode === 'exclude' && isDeleted) return false
        if (category && category !== 'All' && String(p.category || 'General') !== category) return false
        if (!search) return true
        const n = String(p.name || '').toLowerCase()
        const c = String(p.category || '').toLowerCase()
        return n.includes(search) || c.includes(search)
      })
      .map((p) => ({
        id: p.id,
        name: String(p.name || ''),
        category: String(p.category || 'General'),
        stock: toNumber(p.stock, 0),
        unit_price: toNumber(p.unit_price ?? p.unitPrice, 0),
        is_deleted: Boolean(p.is_deleted),
      }))

    res.json({ products })
  }))

  router.patch('/inventory/products/:id', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    const patch = req.body && typeof req.body === 'object' ? req.body : {}

    const next = {}
    const name = toNonEmptyString(patch.name)
    if (name) next.name = name
    const category = toNonEmptyString(patch.category)
    if (category) next.category = category
    if (patch.stock !== undefined) next.stock = Math.max(0, toNumber(patch.stock, 0))
    if (patch.unitPrice !== undefined || patch.unit_price !== undefined) {
      next.unit_price = Math.max(0, toNumber(patch.unit_price ?? patch.unitPrice, 0))
    }

    await db.collection('inventory_products').doc(id).set(
      {
        ...next,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    res.json({ ok: true })
  }))

  router.delete('/inventory/products/:id', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    await db.collection('inventory_products').doc(id).set(
      {
        is_deleted: true,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    res.json({ ok: true })
  }))

  router.post('/inventory/products/:id/consume', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    const qty = toNumber(req.body?.quantity, 0)
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be > 0' })

    const ref = db.collection('inventory_products').doc(id)
    const nextStock = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const current = snap.exists ? toNumber(snap.data()?.stock, 0) : 0
      const next = Math.max(0, current - qty)
      tx.set(
        ref,
        {
          stock: next,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      return next
    })

    res.json({ ok: true, stock: nextStock })
  }))

  router.post('/inventory/stock-entries', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const body = req.body && typeof req.body === 'object' ? req.body : {}

    const supplierId = toNonEmptyString(body.supplierId)
    const productId = toNonEmptyString(body.productId)
    const productName = toNonEmptyString(body.productName)
    const quantity = toNumber(body.quantity, NaN)
    const purchasePrice = toNumber(body.purchasePrice, NaN)
    const dateStr = toNonEmptyString(body.date)

    if (!supplierId) return res.status(400).json({ error: 'supplierId is required' })
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'quantity must be > 0' })
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      return res.status(400).json({ error: 'purchasePrice must be >= 0' })
    }

    let resolvedProductId = productId
    let resolvedProductName = productName

    if (!resolvedProductId) {
      if (!resolvedProductName) return res.status(400).json({ error: 'productId or productName is required' })
      const ref = await db.collection('inventory_products').add({
        name: resolvedProductName,
        category: 'General',
        stock: 0,
        unit_price: 0,
        is_deleted: false,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      })
      resolvedProductId = ref.id
    }

    const supplierName = await findSupplierName(db, supplierId)

    const productRef = db.collection('inventory_products').doc(resolvedProductId)
    const productSnap = await productRef.get()
    if (!resolvedProductName) {
      resolvedProductName = productSnap.exists ? String(productSnap.data()?.name || '') : ''
    }

    const parsedDate = dateStr ? new Date(dateStr) : null
    const dateValue =
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? admin.firestore.Timestamp.fromDate(parsedDate)
        : admin.firestore.FieldValue.serverTimestamp()

    const entryRef = await db.collection('stock_entries').add({
      product_id: resolvedProductId,
      product_name: resolvedProductName || '',
      supplier_id: supplierId,
      supplier_name: supplierName || '',
      quantity,
      purchase_price: purchasePrice,
      date: dateValue,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    await productRef.set(
      {
        stock: admin.firestore.FieldValue.increment(quantity),
        is_deleted: false,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    res.json({ ok: true, id: entryRef.id })
  }))

  // List inventory items (backed by menu_items)
  router.get('/inventory/items', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const snap = await db.collection('menu_items').orderBy('name').get()
    const items = snap.docs.map((d) => {
      const data = d.data() || {}
      return {
        id: d.id,
        name: data.name || '',
        category: data.category || 'General',
        price: Number(data.price) || 0,
        daily_quantity: Number(data.daily_quantity) || 0,
        available: data.available ?? data.is_active ?? true,
        is_active: data.is_active ?? true,
        updated_at: data.updated_at || null,
      }
    })
    res.json({ items })
  }))

  // Simple summary: counts and low stock
  router.get('/inventory/summary', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const snap = await db.collection('menu_items').get()
    let totalItems = 0
    let lowStock = 0
    let outOfStock = 0
    const threshold = Number(req.query.lowThreshold ?? 20)

    snap.forEach((d) => {
      const data = d.data() || {}
      const qty = Number(data.daily_quantity) || 0
      totalItems += 1
      if (qty === 0) outOfStock += 1
      else if (qty > 0 && qty < threshold) lowStock += 1
    })

    res.json({ totalItems, lowStock, outOfStock, lowThreshold: threshold })
  }))

  // Update an inventory item (quantity/price/availability)
  router.patch('/inventory/items/:id', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const id = String(req.params.id)
    const patch = req.body && typeof req.body === 'object' ? req.body : {}

    const allowed = {}
    if (patch.daily_quantity !== undefined) {
      allowed.daily_quantity = Number(patch.daily_quantity) || 0
      if (allowed.daily_quantity === 0 && patch.available === undefined) {
        allowed.available = false
      }
    }
    if (patch.price !== undefined) {
      allowed.price = Number(patch.price) || 0
    }
    if (patch.available !== undefined) {
      allowed.available = Boolean(patch.available)
      if (allowed.available && allowed.daily_quantity === undefined) {
        allowed.is_active = true
      }
    }

    await db.collection('menu_items').doc(id).set(
      {
        ...allowed,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    res.json({ ok: true })
  }))

  router.get('/inventory/suppliers', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const [inv, legacy] = await Promise.all([
      readSuppliers(db, inventorySuppliersCol(db)),
      readSuppliers(db, legacySuppliersCol(db)),
    ])

    const byId = new Map()
    for (const s of legacy) {
      if (!s.id) continue
      byId.set(s.id, s)
    }
    for (const s of inv) {
      if (!s.id) continue
      byId.set(s.id, s)
    }

    const suppliers = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
    res.json({ suppliers })
  }))

  router.post('/inventory/suppliers', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const name = toNonEmptyString(body.name)
    if (!name) return res.status(400).json({ error: 'name is required' })

    const payload = {
      name,
      phone: toNonEmptyString(body.phone),
      email: toNonEmptyString(body.email),
      address: toNonEmptyString(body.address),
      gst: toNonEmptyString(body.gst),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    const ref = await inventorySuppliersCol(db).add(payload)
    res.json({ ok: true, id: ref.id })
  }))

  router.patch('/inventory/suppliers/:id', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const id = String(req.params.id || '')
    if (!id) return res.status(400).json({ error: 'Missing id' })

    const patch = req.body && typeof req.body === 'object' ? req.body : {}
    const allowed = {}
    if (patch.name !== undefined) allowed.name = String(patch.name || '').trim()
    if (patch.phone !== undefined) allowed.phone = patch.phone ? String(patch.phone).trim() : null
    if (patch.email !== undefined) allowed.email = patch.email ? String(patch.email).trim() : null
    if (patch.address !== undefined) allowed.address = patch.address ? String(patch.address).trim() : null
    if (patch.gst !== undefined) allowed.gst = patch.gst ? String(patch.gst).trim() : null

    if (allowed.name !== undefined && !allowed.name) {
      return res.status(400).json({ error: 'name is required' })
    }

    const invRef = inventorySuppliersCol(db).doc(id)
    const invSnap = await invRef.get().catch(() => null)
    const targetRef = invSnap?.exists ? invRef : legacySuppliersCol(db).doc(id)

    await targetRef.set(
      {
        ...allowed,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    res.json({ ok: true })
  }))

  router.delete('/inventory/suppliers/:id', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const id = String(req.params.id || '')
    if (!id) return res.status(400).json({ error: 'Missing id' })
    const invRef = inventorySuppliersCol(db).doc(id)
    const invSnap = await invRef.get().catch(() => null)
    const targetRef = invSnap?.exists ? invRef : legacySuppliersCol(db).doc(id)
    await targetRef.delete()
    res.json({ ok: true })
  }))

  router.get('/inventory/stock-entries', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const limit = Math.min(250, Math.max(1, toNumber(req.query.limit, 100)))
    const snap = await db.collection('stock_entries').orderBy('createdAt', 'desc').limit(limit).get()
    const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ entries })
  }))

  router.get('/inventory/low-stock', requireAuth, safe(async (req, res) => {
    const db = getDb()
    const threshold = Number(req.query.lowThreshold ?? 20)
    const snap = await db.collection('menu_items').get()
    const items = []
    snap.forEach((d) => {
      const data = d.data() || {}
      const qty = Number(data.daily_quantity) || 0
      if (qty > 0 && qty < threshold) {
        items.push({
          id: d.id,
          name: data.name || '',
          daily_quantity: qty,
          category: data.category || 'General',
        })
      }
    })
    res.json({ items, lowThreshold: threshold })
  }))

  return router
}
