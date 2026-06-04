import { Router } from 'express'
import { getDb } from '../../services/firebaseAdmin.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireAnyRole } from '../../middleware/roleAccess.js'
import {
  isRevenueOrder,
  orderLineTotal,
  periodStart,
  toMillis,
} from '../../utils/orderTotals.js'

export function createReportsRouter() {
  const router = Router()

  const toNumber = (value, fallback = 0) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  const receptionAdmin = requireAnyRole('reception', 'admin')

  router.get('/reports/summary', requireAuth, receptionAdmin, async (req, res) => {
    try {
      const db = getDb()
      const period = String(req.query.period || 'all').toLowerCase()
      const start = periodStart(period)
      const startMs = start ? start.getTime() : null

      const [ordersSnap, menuSnap, expensesSnap] = await Promise.all([
        db.collection('orders').get(),
        db.collection('menu_items').get(),
        db.collection('expenses').get().catch(() => null),
      ])

      const costByMenuItemId = new Map()
      const costByMenuItemName = new Map()
      const normName = (s) => String(s || '').trim().toLowerCase()

      menuSnap.forEach((d) => {
        const data = d.data() || {}
        const cost = toNumber(data.cost_price, 0)
        costByMenuItemId.set(d.id, cost)
        const nameKey = normName(data.name)
        if (nameKey && cost > 0) costByMenuItemName.set(nameKey, cost)
      })

      let ordersCount = 0
      let revenue = 0
      let cogs = 0

      ordersSnap.forEach((d) => {
        const data = { id: d.id, ...d.data() }
        const status = String(data.status || '').toLowerCase()
        if (!isRevenueOrder(status)) return

        const createdMs = toMillis(data.createdAt || data.updatedAt)
        if (startMs != null) {
          if (createdMs == null || createdMs < startMs) return
        }

        const lines = Array.isArray(data.items) ? data.items : []
        const orderTotal = orderLineTotal(data)
        ordersCount += 1
        revenue += orderTotal

        for (const line of lines) {
          const qty = toNumber(line?.qty, 0)
          if (qty <= 0) continue
          const id = line?.id ? String(line.id) : ''
          let unitCost = id ? (costByMenuItemId.get(id) ?? 0) : 0
          if (unitCost <= 0) {
            unitCost = costByMenuItemName.get(normName(line?.name)) ?? 0
          }
          cogs += qty * unitCost
        }
      })

      let expenses = 0
      expensesSnap?.forEach((d) => {
        const data = d.data() || {}
        const createdMs = toMillis(data.createdAt || data.updatedAt)
        if (startMs != null) {
          if (createdMs == null || createdMs < startMs) return
        }
        expenses += Math.max(0, toNumber(data.amount, 0))
      })

      const net = revenue - cogs - expenses

      res.json({
        period,
        sales: { ordersCount, revenue: Math.round(revenue) },
        costs: { cogs: Math.round(cogs), expenses: Math.round(expenses) },
        profit: { gross: Math.round(revenue), net: Math.round(net) },
      })
    } catch (e) {
      console.error('GET /reports/summary failed:', e)
      res.status(500).json({ error: 'Failed to load report summary' })
    }
  })

  return router
}
