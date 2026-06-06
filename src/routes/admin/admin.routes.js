import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../../services/firebaseAdmin.js'
import { requireAuth } from '../../middleware/auth.js'
import { getAllowedRolesForEmail, requireAdminRole, requireAnyRole } from '../../middleware/roleAccess.js'
import { getAuth } from '../../services/firebaseAdmin.js'
import { isRevenueOrder, orderLineTotal, toMillis } from '../../utils/orderTotals.js'
import { actorFromReq, writeActivityLog } from '../../utils/activityLog.js'
import { getRestaurantSettings, normalizeRestaurantSettings } from '../../utils/restaurantSettings.js'

function settingsUpdatedAt(snap) {
  if (!snap?.exists) return null
  const raw = snap.data()?.updatedAt
  if (raw && typeof raw.toMillis === 'function') {
    return new Date(raw.toMillis()).toISOString()
  }
  return null
}

export function createAdminRouter() {
  const router = Router()
  const receptionAdmin = requireAnyRole('reception', 'admin')

  const toNumber = (value, fallback = 0) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  const toNonEmptyString = (value) => {
    const s = String(value ?? '').trim()
    return s ? s : null
  }

  const adminOnly = [requireAuth, requireAdminRole()]

  router.get('/admin/access-users', adminOnly, async (req, res) => {
    try {
      const db = getDb()
      const auth = getAuth()
      const norm = (v) => String(v || '').trim().toLowerCase()

      const [usersSnap, rolesSnap, authList] = await Promise.all([
        db.collection('users').get(),
        db.collection('roles').get(),
        auth.listUsers(1000),
      ])

      const roleSlots = {}
      rolesSnap.forEach((d) => {
        const data = d.data() || {}
        roleSlots[d.id] = {
          title: data.title || d.id,
          allowed_email: data.allowed_email || null,
        }
      })

      const byEmail = new Map()

      const upsert = (email, patch) => {
        const key = norm(email)
        if (!key) return
        const prev = byEmail.get(key) || {
          uid: null,
          email: key,
          name: key.split('@')[0],
          roles: [],
          status: 'active',
        }
        const roles = new Set(prev.roles)
        for (const r of patch.roles || []) {
          const id = String(r || '').trim().toLowerCase()
          if (id) roles.add(id)
        }
        byEmail.set(key, {
          ...prev,
          ...patch,
          email: key,
          roles: Array.from(roles).sort(),
        })
      }

      usersSnap.forEach((d) => {
        const data = d.data() || {}
        const email = norm(data.email)
        if (!email) return
        upsert(email, {
          uid: d.id,
          name: data.name || email.split('@')[0],
          roles: data.role ? [data.role] : [],
          status: String(data.status || 'active').toLowerCase(),
        })
      })

      rolesSnap.forEach((d) => {
        const slotEmail = norm(d.data()?.allowed_email)
        if (!slotEmail) return
        upsert(slotEmail, { roles: [d.id] })
      })

      for (const record of authList.users) {
        const email = norm(record.email)
        if (!email) continue
        const allowed = await getAllowedRolesForEmail(email, record.uid)
        if (allowed.length === 0 && !byEmail.has(email)) continue
        upsert(email, {
          uid: record.uid,
          name: record.displayName || email.split('@')[0],
          roles: allowed,
          status: record.disabled ? 'disabled' : byEmail.get(email)?.status || 'active',
        })
      }

      const users = Array.from(byEmail.values()).sort((a, b) =>
        (a.email || '').localeCompare(b.email || ''),
      )

      res.json({ users, roleSlots })
    } catch (e) {
      console.error('GET /admin/access-users failed:', e)
      res.status(500).json({ error: 'Failed to load access users' })
    }
  })

  router.post('/admin/access-users', adminOnly, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      const name = String(body.name || '').trim() || email.split('@')[0]
      const role = String(body.role || '').trim().toLowerCase()
      const KNOWN = ['admin', 'reception', 'kitchen', 'manager', 'employee']

      if (!email) return res.status(400).json({ error: 'Email is required' })
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' })
      }
      if (!KNOWN.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${KNOWN.join(', ')}` })
      }

      const auth = getAuth()
      const db = getDb()

      let userRecord
      try {
        userRecord = await auth.createUser({
          email,
          password,
          displayName: name,
          emailVerified: false,
          disabled: false,
        })
      } catch (err) {
        if (err?.code === 'auth/email-already-exists') {
          userRecord = await auth.getUserByEmail(email)
          await auth.updateUser(userRecord.uid, { password, displayName: name, disabled: false })
        } else {
          throw err
        }
      }

      const uid = userRecord.uid
      await db.collection('users').doc(uid).set(
        {
          email,
          name,
          role,
          status: 'active',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      await writeActivityLog(db, {
        action: 'access_user_created',
        category: 'access',
        actor: actorFromReq(req),
        detail: `Created app access for ${email} (${role})`,
        targetId: uid,
      })

      res.json({ ok: true, uid, email, role })
    } catch (e) {
      console.error('POST /admin/access-users failed:', e)
      res.status(500).json({ error: e?.message || 'Failed to create access user' })
    }
  })

  router.patch('/admin/access-users/:uid', adminOnly, async (req, res) => {
    try {
      const uid = String(req.params.uid || '').trim()
      if (!uid) return res.status(400).json({ error: 'Missing uid' })

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const db = getDb()
      const auth = getAuth()
      const patch = {}

      if (body.role !== undefined) {
        const role = String(body.role || '').trim().toLowerCase()
        const KNOWN = ['admin', 'reception', 'kitchen', 'manager', 'employee']
        if (!KNOWN.includes(role)) {
          return res.status(400).json({ error: 'Invalid role' })
        }
        patch.role = role
      }
      if (body.name !== undefined) patch.name = String(body.name || '').trim()
      if (body.status !== undefined) {
        const status = String(body.status || '').trim().toLowerCase()
        patch.status = status
        await auth.updateUser(uid, { disabled: status === 'disabled' })
      }

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = admin.firestore.FieldValue.serverTimestamp()
        await db.collection('users').doc(uid).set(patch, { merge: true })
        await writeActivityLog(db, {
          action: 'access_user_updated',
          category: 'access',
          actor: actorFromReq(req),
          detail: `Updated user ${uid}: ${Object.keys(patch).join(', ')}`,
          targetId: uid,
        })
      }

      res.json({ ok: true })
    } catch (e) {
      console.error('PATCH /admin/access-users failed:', e)
      res.status(500).json({ error: 'Failed to update user' })
    }
  })

  router.get('/admin/me', requireAuth, async (req, res) => {
    const db = getDb()
    const uid = String(req.user?.uid || '')
    const email = String(req.user?.email || '').trim().toLowerCase()
    if (!uid) return res.status(400).json({ error: 'Missing uid on token' })

    // 1) Primary source: users collection (new admin profile model)
    let usersRef = db.collection('users').doc(uid)
    let userSnap = await usersRef.get()
    let data = userSnap.exists ? (userSnap.data() || {}) : null

    // 2) Fallback: legacy admins collection (what you described in step 7)
    if (!data) {
      const adminsRef = db.collection('admins').doc(uid)
      const adminSnap = await adminsRef.get()
      if (adminSnap.exists) {
        const adminData = adminSnap.data() || {}
        const adminEmail = String(adminData.email || '').trim().toLowerCase()
        if (!email || (adminEmail && adminEmail !== email)) {
          return res.status(403).json({ error: 'User profile not found' })
        }
        data = {
          name:
            adminData.name ||
            req.user?.name ||
            req.user?.displayName ||
            (email ? email.split('@')[0] : 'Admin'),
          email: email || adminEmail,
          role: String(adminData.role || 'admin'),
          status: adminData.status || 'active',
          createdAt: adminData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }
        await usersRef.set(data, { merge: true })
        userSnap = await usersRef.get()
      }
    }

    // 3) Fallback: roles collection (existing role-based access config)
    if (!data) {
      if (!email) {
        return res.status(403).json({ error: 'User profile not found' })
      }

      const roleDoc = await db.collection('roles').doc('admin').get()
      const roleData = roleDoc.exists ? roleDoc.data() || {} : {}
      const allowedEmail = String(roleData.allowed_email || '').trim().toLowerCase()

      if (!allowedEmail || allowedEmail !== email) {
        return res.status(403).json({ error: 'User profile not found' })
      }

      data = {
        name: req.user?.name || req.user?.displayName || email.split('@')[0] || 'Admin',
        email,
        role: 'admin',
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
      await usersRef.set(data, { merge: true })
      userSnap = await usersRef.get()
    }

    if (!data) {
      return res.status(403).json({ error: 'User profile not found' })
    }

    const role = String(data.role || '').toLowerCase()
    if (role !== 'admin') {
      return res.status(403).json({ error: 'Not an admin user' })
    }

    return res.json({
      ok: true,
      user: {
        id: userSnap.id,
        name: data.name || null,
        email: data.email || req.user.email || null,
        role,
        status: data.status || 'active',
      },
    })
  })

  router.get('/admin/metrics', requireAuth, async (req, res) => {
    const db = getDb()

    const [ordersSnap, menuSnap, staffSnap, expensesSnap] = await Promise.all([
      db.collection('orders').get(),
      db.collection('menu_items').get(),
      db.collection('staff').get(),
      db.collection('expenses').get().catch(() => null),
    ])

    const now = new Date()
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const normName = (s) => String(s || '').trim().toLowerCase()
    const costByMenuItemId = new Map()
    const costByMenuItemName = new Map()
    menuSnap.forEach((d) => {
      const data = d.data() || {}
      const cost = toNumber(data.cost_price, 0)
      costByMenuItemId.set(d.id, cost)
      const nameKey = normName(data.name)
      if (nameKey && cost > 0) costByMenuItemName.set(nameKey, cost)
    })

    let totalRevenue = 0
    let todaySales = 0
    let monthlySales = 0
    let totalOrders = 0
    let activeOrders = 0
    let cogs = 0

    const dailySalesMap = new Map()
    const monthlyRevenueMap = new Map()
    const productPerformanceMap = new Map()
    const staffProductivityMap = new Map()

    ordersSnap.forEach((d) => {
      const data = { id: d.id, ...d.data() }
      const status = String(data.status || '').toLowerCase()
      if (status === 'draft') return

      const items = Array.isArray(data.items) ? data.items : []
      const createdMs = toMillis(data.createdAt || data.updatedAt)
      const dt = createdMs != null ? new Date(createdMs) : null

      totalOrders += 1
      const isActive = !isRevenueOrder(status) && status !== 'cancelled'
      if (isActive) activeOrders += 1

      if (!isRevenueOrder(status)) return

      const total = orderLineTotal(data)

      if (dt) {
        const dayKey = dt.toISOString().slice(0, 10)
        const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`

        totalRevenue += total
        dailySalesMap.set(dayKey, (dailySalesMap.get(dayKey) || 0) + total)
        monthlyRevenueMap.set(monthKey, (monthlyRevenueMap.get(monthKey) || 0) + total)
        if (dt >= startToday) todaySales += total
        if (dt >= startMonth) monthlySales += total
      }

      items.forEach((item) => {
        const name = String(item.name || 'Unknown')
        productPerformanceMap.set(name, (productPerformanceMap.get(name) || 0) + (Number(item.qty) || 0))
        const qty = toNumber(item.qty, 0)
        if (qty <= 0) return
        const id = item?.id ? String(item.id) : ''
        let unitCost = id ? (costByMenuItemId.get(id) ?? 0) : 0
        if (unitCost <= 0) unitCost = costByMenuItemName.get(normName(item.name)) ?? 0
        cogs += qty * unitCost
      })

      const staffId = data.staffId || data.createdBy || null
      if (staffId) {
        staffProductivityMap.set(staffId, (staffProductivityMap.get(staffId) || 0) + 1)
      }
    })

    let expenseSummary = 0
    expensesSnap?.forEach((d) => {
      const data = d.data() || {}
      expenseSummary += Math.max(0, toNumber(data.amount, 0))
    })

    const netProfit = Math.round(totalRevenue - cogs - expenseSummary)

    const kpis = {
      totalRevenue: Math.round(totalRevenue),
      netProfit,
      totalOrders,
      activeOrders,
      todaySales: Math.round(todaySales),
      monthlySales: Math.round(monthlySales),
      expenseSummary: Math.round(expenseSummary),
      staffCount: staffSnap.size,
      menuItemCount: menuSnap.size,
    }

    const dailySales = Array.from(dailySalesMap.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-14)
      .map(([date, value]) => ({ date, value }))

    const monthlyRevenue = Array.from(monthlyRevenueMap.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-12)
      .map(([month, value]) => ({ month, value }))

    const productPerformance = Array.from(productPerformanceMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, quantity]) => ({ name, quantity }))

    const staffProductivity = Array.from(staffProductivityMap.entries())
      .map(([staffId, orders]) => {
        const staffDoc = staffSnap.docs.find((d) => d.id === staffId)
        const staffName = staffDoc?.data()?.name || staffId
        return { staffId, staffName, orders }
      })
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 8)

    res.json({
      kpis,
      charts: {
        dailySales,
        monthlyRevenue,
        productPerformance,
        staffProductivity,
      },
    })
  })

  router.get('/admin/search', requireAuth, async (req, res) => {
    const db = getDb()
    const q = String(req.query.q || '').trim().toLowerCase()
    const scope = String(req.query.scope || 'all').toLowerCase()

    if (!q) {
      return res.json({ results: { staff: [], inventory: [], invoices: [], suppliers: [] } })
    }

    const results = {
      staff: [],
      inventory: [],
      invoices: [],
      suppliers: [],
    }

    const should = (value) => String(value || '').toLowerCase().includes(q)

    if (scope === 'all' || scope === 'staff') {
      const snap = await db.collection('staff').get()
      results.staff = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => should(s.name) || should(s.email) || should(s.phone))
        .slice(0, 10)
    }

    if (scope === 'all' || scope === 'inventory') {
      const snap = await db.collection('menu_items').get()
      results.inventory = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((i) => should(i.name) || should(i.category))
        .slice(0, 10)
    }

    if (scope === 'all' || scope === 'invoice') {
      const snap = await db.collection('orders').get()
      results.invoices = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((o) => should(o.id) || should(o.table) || should(o.customerName))
        .slice(0, 10)
    }

    if (scope === 'all' || scope === 'supplier') {
      const snap = await db.collection('suppliers').get()
      results.suppliers = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => should(s.name) || should(s.email) || should(s.phone))
        .slice(0, 10)
    }

    res.json({ results })
  })

  router.get('/settings', requireAuth, async (req, res) => {
    try {
      const db = getDb()
      const settings = await getRestaurantSettings(db)
      res.json({ settings })
    } catch (e) {
      console.error('GET /settings failed:', e)
      res.status(500).json({ error: 'Failed to load settings' })
    }
  })

  router.get('/admin/settings', adminOnly, async (req, res) => {
    try {
      const db = getDb()
      const [restaurantSnap, kitchenSnap] = await Promise.all([
        db.collection('settings').doc('restaurant').get(),
        db.collection('settings').doc('kitchen_config').get(),
      ])
      const settings = normalizeRestaurantSettings(restaurantSnap.exists ? restaurantSnap.data() : {})
      const kitchenData = kitchenSnap.exists ? kitchenSnap.data() || {} : {}
      res.json({
        settings,
        kitchen: {
          status: String(kitchenData.status || 'online').toLowerCase(),
          opening_time: kitchenData.opening_time || '10:00',
          closing_time: kitchenData.closing_time || '23:00',
        },
        updatedAt: settingsUpdatedAt(restaurantSnap),
      })
    } catch (e) {
      console.error('GET /admin/settings failed:', e)
      res.status(500).json({ error: 'Failed to load settings' })
    }
  })

  router.patch('/admin/settings', adminOnly, async (req, res) => {
    try {
      const db = getDb()
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const patch = {}

      const stringFields = [
        'restaurantName',
        'tagline',
        'phone',
        'email',
        'address',
        'city',
        'gstin',
        'currency',
        'receiptFooter',
      ]
      for (const key of stringFields) {
        if (body[key] !== undefined) patch[key] = String(body[key] ?? '').trim()
      }
      if (body.lowStockThreshold !== undefined) {
        patch.lowStockThreshold = Math.max(1, toNumber(body.lowStockThreshold, 20))
      }
      if (body.gstPercent !== undefined) {
        patch.gstPercent = Math.max(0, Math.min(100, toNumber(body.gstPercent, 5)))
      }
      if (body.serviceChargeAmount !== undefined) {
        patch.serviceChargeAmount = Math.max(0, toNumber(body.serviceChargeAmount, 150))
      }
      if (body.gstEnabled !== undefined) patch.gstEnabled = Boolean(body.gstEnabled)
      if (body.serviceChargeEnabled !== undefined) {
        patch.serviceChargeEnabled = Boolean(body.serviceChargeEnabled)
      }
      if (body.serviceChargeDineInOnly !== undefined) {
        patch.serviceChargeDineInOnly = Boolean(body.serviceChargeDineInOnly)
      }
      if (body.showGstOnReceipt !== undefined) {
        patch.showGstOnReceipt = Boolean(body.showGstOnReceipt)
      }

      const ref = db.collection('settings').doc('restaurant')
      if (Object.keys(patch).length > 0) {
        await ref.set(
          {
            ...patch,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        await writeActivityLog(db, {
          action: 'settings_updated',
          category: 'settings',
          actor: actorFromReq(req),
          detail: `Updated: ${Object.keys(patch).join(', ')}`,
        })
      }

      if (body.kitchen && typeof body.kitchen === 'object') {
        const kitchenPatch = {}
        if (body.kitchen.status !== undefined) {
          kitchenPatch.status = String(body.kitchen.status || 'online').toLowerCase()
        }
        if (body.kitchen.opening_time !== undefined) {
          kitchenPatch.opening_time = String(body.kitchen.opening_time || '')
        }
        if (body.kitchen.closing_time !== undefined) {
          kitchenPatch.closing_time = String(body.kitchen.closing_time || '')
        }
        if (Object.keys(kitchenPatch).length > 0) {
          await db.collection('settings').doc('kitchen_config').set(
            {
              ...kitchenPatch,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
        }
      }

      const [restaurantSnap, kitchenSnap] = await Promise.all([
        ref.get(),
        db.collection('settings').doc('kitchen_config').get(),
      ])
      const kitchenData = kitchenSnap.exists ? kitchenSnap.data() || {} : {}
      res.json({
        ok: true,
        settings: normalizeRestaurantSettings(restaurantSnap.data() || {}),
        kitchen: {
          status: String(kitchenData.status || 'online').toLowerCase(),
          opening_time: kitchenData.opening_time || '10:00',
          closing_time: kitchenData.closing_time || '23:00',
        },
        updatedAt: settingsUpdatedAt(restaurantSnap),
      })
    } catch (e) {
      console.error('PATCH /admin/settings failed:', e)
      res.status(500).json({ error: 'Failed to save settings' })
    }
  })

  router.get('/admin/logs', adminOnly, async (req, res) => {
    try {
      const db = getDb()
      const limit = Math.min(200, Math.max(1, toNumber(req.query.limit, 100)))
      const snap = await db
        .collection('activity_logs')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get()
        .catch(async () => {
          const fallback = await db.collection('activity_logs').limit(limit).get()
          return fallback
        })

      const logs = snap.docs.map((d) => {
        const data = d.data() || {}
        const ms = toMillis(data.createdAt)
        return {
          id: d.id,
          action: data.action || 'unknown',
          category: data.category || 'admin',
          actor: data.actor || {},
          detail: data.detail || null,
          targetId: data.targetId || null,
          createdAt: ms != null ? new Date(ms).toISOString() : null,
        }
      })

      res.json({ logs })
    } catch (e) {
      console.error('GET /admin/logs failed:', e)
      res.status(500).json({ error: 'Failed to load logs' })
    }
  })

  router.get('/admin/notifications', requireAuth, async (req, res) => {
    try {
      const db = getDb()

      const [menuSnap, staffSnap, ordersSnap, usersSnap, settingsSnap, kitchenSnap] = await Promise.all([
        db.collection('menu_items').get(),
        db.collection('staff').get(),
        db.collection('orders').get(),
        db.collection('users').get(),
        db.collection('settings').doc('restaurant').get(),
        db.collection('settings').doc('kitchen_config').get(),
      ])

      const settingsData = settingsSnap.exists ? settingsSnap.data() || {} : {}
      const lowStockThreshold = Math.max(1, toNumber(settingsData.lowStockThreshold, 20))
      const kitchenData = kitchenSnap.exists ? kitchenSnap.data() || {} : {}
      const kitchenOffline = String(kitchenData.status || 'online').toLowerCase() === 'offline'

      const lowStockItems = []
      const outOfStockItems = []
      const unavailableItems = []

      menuSnap.forEach((d) => {
        const data = d.data() || {}
        const qty = Number(data.daily_quantity) || 0
        const available = data.available !== false && data.is_active !== false
        const row = {
          id: d.id,
          name: data.name || d.id,
          qty,
          category: data.category || 'General',
        }
        if (qty === 0) outOfStockItems.push(row)
        else if (qty > 0 && qty < lowStockThreshold) lowStockItems.push(row)
        if (!available) unavailableItems.push(row)
      })

      const inactiveStaff = staffSnap.docs
        .map((d) => {
          const data = d.data() || {}
          return {
            id: d.id,
            name: data.name || d.id,
            role: data.role || data.designation || '—',
            status: String(data.status || 'unknown').toLowerCase(),
          }
        })
        .filter((s) => ['inactive', 'disabled', 'terminated', 'on_leave'].includes(s.status))

      const disabledUsers = usersSnap.docs
        .map((d) => {
          const data = d.data() || {}
          return {
            id: d.id,
            email: data.email || d.id,
            role: data.role || '—',
            status: String(data.status || 'active').toLowerCase(),
          }
        })
        .filter((u) => u.status === 'disabled')

      const orderRow = (o) => ({
        id: o.id,
        table: o.table || o.tableName || o.table_id || '—',
        status: String(o.status || '').toLowerCase(),
        total: Math.round(orderLineTotal(o)),
        type: o.type || o.orderType || '—',
      })

      const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const kotOrders = orders
        .filter((o) => String(o.status || '').toLowerCase() === 'kot')
        .map(orderRow)
      const unpaidBills = orders
        .filter((o) => String(o.status || '').toLowerCase() === 'billed')
        .map(orderRow)
      const paymentFailures = orders
        .filter((o) => ['payment_failed', 'failed'].includes(String(o.status || '').toLowerCase()))
        .map(orderRow)

      const pushAlert = (alert) => {
        notifications.push({
          href: alert.href || null,
          count: alert.count ?? 0,
          ...alert,
        })
      }

      const notifications = []

      if (outOfStockItems.length > 0) {
        pushAlert({
          id: 'out-of-stock',
          type: 'inventory',
          title: 'Out of stock',
          message: `${outOfStockItems.length} menu item${outOfStockItems.length === 1 ? '' : 's'} at zero quantity.`,
          severity: 'critical',
          href: '/admin/inventory',
          count: outOfStockItems.length,
          rows: outOfStockItems.slice(0, 8).map((i) => ({
            id: i.id,
            label: i.name,
            sub: i.category,
            value: '0 left',
          })),
        })
      }

      if (lowStockItems.length > 0) {
        pushAlert({
          id: 'low-stock',
          type: 'inventory',
          title: 'Low stock',
          message: `${lowStockItems.length} item${lowStockItems.length === 1 ? '' : 's'} below ${lowStockThreshold} units.`,
          severity: 'warning',
          href: '/admin/inventory',
          count: lowStockItems.length,
          rows: lowStockItems.slice(0, 8).map((i) => ({
            id: i.id,
            label: i.name,
            sub: i.category,
            value: `${i.qty} left`,
          })),
        })
      }

      if (unavailableItems.length > 0) {
        pushAlert({
          id: 'unavailable-menu',
          type: 'inventory',
          title: 'Unavailable on menu',
          message: `${unavailableItems.length} item${unavailableItems.length === 1 ? '' : 's'} hidden from POS.`,
          severity: 'warning',
          href: '/admin/inventory',
          count: unavailableItems.length,
          rows: unavailableItems.slice(0, 8).map((i) => ({
            id: i.id,
            label: i.name,
            sub: i.category,
            value: i.qty === 0 ? 'Out of stock' : 'Off menu',
          })),
        })
      }

      if (kotOrders.length > 0) {
        pushAlert({
          id: 'kitchen-kot',
          type: 'kitchen',
          title: 'Kitchen queue',
          message: `${kotOrders.length} order${kotOrders.length === 1 ? '' : 's'} waiting in kitchen (KOT).`,
          severity: 'warning',
          href: '/kitchen',
          count: kotOrders.length,
          rows: kotOrders.slice(0, 8).map((o) => ({
            id: o.id,
            label: `Order ${o.id.slice(0, 8)}`,
            sub: `Table ${o.table} · ${o.type}`,
            value: `₹${o.total}`,
          })),
        })
      }

      if (kitchenOffline) {
        pushAlert({
          id: 'kitchen-offline',
          type: 'kitchen',
          title: 'Kitchen offline',
          message: 'Kitchen display is marked offline in settings.',
          severity: 'warning',
          href: '/admin/settings',
          count: 1,
          rows: [
            {
              id: 'kitchen-status',
              label: 'Kitchen status',
              sub: 'Update in Settings',
              value: 'Offline',
            },
          ],
        })
      }

      if (unpaidBills.length > 0) {
        pushAlert({
          id: 'unpaid-bills',
          type: 'billing',
          title: 'Unpaid bills',
          message: `${unpaidBills.length} bill${unpaidBills.length === 1 ? '' : 's'} waiting for payment.`,
          severity: 'warning',
          href: '/billing',
          count: unpaidBills.length,
          rows: unpaidBills.slice(0, 8).map((o) => ({
            id: o.id,
            label: `Bill ${o.id.slice(0, 8)}`,
            sub: `Table ${o.table}`,
            value: `₹${o.total}`,
          })),
        })
      }

      if (paymentFailures.length > 0) {
        pushAlert({
          id: 'payment-failure',
          type: 'billing',
          title: 'Payment failed',
          message: `${paymentFailures.length} order${paymentFailures.length === 1 ? '' : 's'} with payment issues.`,
          severity: 'critical',
          href: '/billing',
          count: paymentFailures.length,
          rows: paymentFailures.slice(0, 8).map((o) => ({
            id: o.id,
            label: `Order ${o.id.slice(0, 8)}`,
            sub: `Table ${o.table}`,
            value: o.status,
          })),
        })
      }

      if (inactiveStaff.length > 0) {
        pushAlert({
          id: 'inactive-staff',
          type: 'staff',
          title: 'Inactive staff',
          message: `${inactiveStaff.length} team member${inactiveStaff.length === 1 ? '' : 's'} not active.`,
          severity: 'warning',
          href: '/admin/staff',
          count: inactiveStaff.length,
          rows: inactiveStaff.slice(0, 8).map((s) => ({
            id: s.id,
            label: s.name,
            sub: s.role,
            value: s.status,
          })),
        })
      }

      if (disabledUsers.length > 0) {
        pushAlert({
          id: 'disabled-access',
          type: 'access',
          title: 'Disabled logins',
          message: `${disabledUsers.length} app user${disabledUsers.length === 1 ? '' : 's'} cannot sign in.`,
          severity: 'warning',
          href: '/admin/staff',
          count: disabledUsers.length,
          rows: disabledUsers.slice(0, 8).map((u) => ({
            id: u.id,
            label: u.email,
            sub: u.role,
            value: 'Disabled',
          })),
        })
      }

      const severityRank = { critical: 0, warning: 1, info: 2 }
      notifications.sort(
        (a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9),
      )

      const summary = {
        critical: notifications.filter((n) => n.severity === 'critical').length,
        warning: notifications.filter((n) => n.severity === 'warning').length,
        total: notifications.length,
      }

      res.json({
        notifications,
        alertCount: summary.total,
        summary,
        lowStockThreshold,
        generatedAt: new Date().toISOString(),
      })
    } catch (e) {
      console.error('GET /admin/notifications failed:', e)
      res.status(500).json({ error: 'Failed to load notifications' })
    }
  })

  router.get('/admin/integrations', requireAuth, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('integration_settings').get()
    const map = new Map()

    snap.forEach((d) => {
      const data = d.data() || {}
      map.set(d.id, {
        id: d.id,
        enabled: Boolean(data.enabled),
        updatedAt: data.updatedAt || null,
      })
    })

    const ensure = (id) => {
      if (!map.has(id)) {
        map.set(id, { id, enabled: false, updatedAt: null })
      }
    }
    ensure('pos')
    ensure('kds')
    ensure('payments')

    res.json({ integrations: Array.from(map.values()) })
  })

  router.patch('/admin/integrations/:id', requireAuth, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id || '').toLowerCase()
    if (!['pos', 'kds', 'payments'].includes(id)) {
      return res.status(400).json({ error: 'Invalid integration id' })
    }
    const enabled = Boolean(req.body?.enabled)
    await db.collection('integration_settings').doc(id).set(
      {
        enabled,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    res.json({ ok: true, id, enabled })
  })

  router.get('/expenses', requireAuth, receptionAdmin, async (req, res) => {
    const db = getDb()
    const snap = await db.collection('expenses').orderBy('createdAt', 'desc').limit(200).get()
    const expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ expenses })
  })

  router.post('/expenses', requireAuth, receptionAdmin, async (req, res) => {
    const db = getDb()
    const category = toNonEmptyString(req.body?.category) || 'General'
    const amount = toNumber(req.body?.amount, NaN)
    const note = toNonEmptyString(req.body?.note)
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be > 0' })
    }

    const ref = await db.collection('expenses').add({
      category,
      amount,
      note: note || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    await writeActivityLog(db, {
      action: 'expense_added',
      category: 'finance',
      actor: actorFromReq(req),
      detail: `Added expense ${category}: ₹${amount}`,
      targetId: ref.id,
    })

    res.json({ ok: true, id: ref.id })
  })

  router.delete('/expenses/:id', requireAuth, receptionAdmin, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id || '')
    if (!id) return res.status(400).json({ error: 'Missing id' })
    await db.collection('expenses').doc(id).delete()

    await writeActivityLog(db, {
      action: 'expense_deleted',
      category: 'finance',
      actor: actorFromReq(req),
      detail: `Deleted expense ${id}`,
      targetId: id,
    })

    res.json({ ok: true })
  })

  return router
}
