import { Router } from 'express'
import admin from 'firebase-admin'
import { getDb } from '../../services/firebaseAdmin.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireAnyRole } from '../../middleware/roleAccess.js'
import { isRevenueOrder, orderLineTotal, toMillis } from '../../utils/orderTotals.js'

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

  router.get('/admin/notifications', requireAuth, async (req, res) => {
    const db = getDb()

    const [inventorySummarySnap, staffSnap, ordersSnap] = await Promise.all([
      db.collection('menu_items').get(),
      db.collection('staff').get(),
      db.collection('orders').where('status', 'in', ['payment_failed', 'failed']).get().catch(() => null),
    ])

    let lowStockCount = 0
    let lowStockItems = []
    inventorySummarySnap.forEach((d) => {
      const data = d.data() || {}
      const qty = Number(data.daily_quantity) || 0
      if (qty > 0 && qty < 20) {
        lowStockCount += 1
        lowStockItems.push({ id: d.id, name: data.name || d.id, qty })
      }
    })

    const inactiveStaff = staffSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => String(s.status || '').toLowerCase() !== 'active')

    const paymentFailures =
      ordersSnap?.docs.map((d) => ({ id: d.id, ...d.data() })) || []

    const notifications = []

    notifications.push({
      id: 'low-stock',
      type: 'inventory',
      title: 'Low Stock Alert',
      message:
        lowStockCount > 0
          ? `${lowStockCount} items are running low in inventory.`
          : 'No low stock items detected.',
      severity: lowStockCount > 0 ? 'warning' : 'info',
      meta: { items: lowStockItems.slice(0, 5) },
    })

    notifications.push({
      id: 'staff-absence',
      type: 'staff',
      title: 'Staff Absence Alert',
      message:
        inactiveStaff.length > 0
          ? `${inactiveStaff.length} staff members are marked inactive.`
          : 'All staff are currently active.',
      severity: inactiveStaff.length > 0 ? 'warning' : 'info',
      meta: { staff: inactiveStaff.slice(0, 5) },
    })

    notifications.push({
      id: 'payment-failure',
      type: 'billing',
      title: 'Payment Failure Alert',
      message:
        paymentFailures.length > 0
          ? `${paymentFailures.length} orders have payment issues.`
          : 'No recent payment failures detected.',
      severity: paymentFailures.length > 0 ? 'critical' : 'info',
      meta: { orders: paymentFailures.slice(0, 5) },
    })

    notifications.push({
      id: 'system-updates',
      type: 'system',
      title: 'System Updates',
      message: 'System running normally. No pending updates.',
      severity: 'info',
      meta: {},
    })

    res.json({ notifications })
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
    res.json({ ok: true, id: ref.id })
  })

  router.delete('/expenses/:id', requireAuth, receptionAdmin, async (req, res) => {
    const db = getDb()
    const id = String(req.params.id || '')
    if (!id) return res.status(400).json({ error: 'Missing id' })
    await db.collection('expenses').doc(id).delete()
    res.json({ ok: true })
  })

  return router
}
