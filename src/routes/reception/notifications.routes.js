import { Router } from 'express'
import { getDb } from '../../services/firebaseAdmin.js'
import { requireAuth } from '../../middleware/auth.js'
import { isRoleAllowed, requireAnyRole } from '../../middleware/roleAccess.js'

export function createNotificationsRouter() {
  const router = Router()

  router.get(
    '/notifications',
    requireAuth,
    requireAnyRole('reception', 'kitchen', 'admin'),
    async (req, res) => {
    try {
      const db = getDb()
      const email = String(req.user?.email || '').trim().toLowerCase()
      const role = String(req.query.role || 'reception').toLowerCase()

      if (role !== 'reception' && !(await isRoleAllowed(db, role, email))) {
        return res.status(403).json({ error: 'Forbidden for this notification context' })
      }

      const [kotSnap, billedSnap, menuSnap] = await Promise.all([
        db.collection('orders').where('status', '==', 'kot').get(),
        db.collection('orders').where('status', '==', 'billed').get(),
        db.collection('menu_items').get(),
      ])

      const kotCount = kotSnap.size
      const billedCount = billedSnap.size
      let lowStockCount = 0
      menuSnap.forEach((d) => {
        const data = d.data() || {}
        const qty = Number(data.daily_quantity) || 0
        if (qty > 0 && qty < 20) lowStockCount += 1
      })

      const notifications = []

      if (role === 'kitchen') {
        if (kotCount > 0) {
          notifications.push({
            id: 'kitchen-kot',
            title: 'KOT queue',
            message: `${kotCount} order${kotCount === 1 ? '' : 's'} waiting`,
            severity: 'warning',
            href: '/kitchen',
          })
        }
      } else if (role === 'reception') {
        if (kotCount > 0) {
          notifications.push({
            id: 'kitchen-kot-info',
            title: 'Kitchen queue',
            message: `${kotCount} order${kotCount === 1 ? '' : 's'} with kitchen (KOT)`,
            severity: 'warning',
            href: null,
          })
        }
        if (billedCount > 0) {
          notifications.push({
            id: 'billing-pending',
            title: 'Bills to collect',
            message: `${billedCount} bill${billedCount === 1 ? '' : 's'} not paid yet`,
            severity: 'warning',
            href: '/billing',
          })
        }
        if (lowStockCount > 0) {
          notifications.push({
            id: 'low-stock',
            title: 'Low stock',
            message: `${lowStockCount} menu item${lowStockCount === 1 ? '' : 's'} running low`,
            severity: 'warning',
            href: '/pos',
          })
        }
      }

      if (notifications.length === 0) {
        notifications.push({
          id: 'all-clear',
          title: 'All clear',
          message: 'No pending alerts for your station.',
          severity: 'info',
          href: null,
        })
      }

      const alertCount = notifications.filter((n) => n.severity !== 'info').length
      res.json({ notifications, alertCount, role })
    } catch (e) {
      console.error('GET /notifications failed:', e)
      res.status(500).json({ error: 'Failed to load notifications' })
    }
  },
  )

  return router
}
