/**
 * Mount all API routers on the Express app.
 * Domain layout matches frontend auth ACCESS_AREAS — see config/routeRegistry.js
 */
import { healthRouter, createMenuRouter } from './shared/index.js'
import { createMeRouter, createRolesRouter } from './auth/index.js'
import {
  createOrdersRouter,
  createTablesRouter,
  createReportsRouter,
  createNotificationsRouter,
} from './reception/index.js'
import { createKitchenRouter } from './kitchen/index.js'
import { createInventoryRouter } from './manager/index.js'
import { createStaffRouter } from './employee/index.js'
import { createAdminRouter } from './admin/index.js'
import { createGuestRouter } from './guest/guest.routes.js'

export function registerApiRoutes(app, { io }) {
  // Shared
  app.use('/api', healthRouter)
  app.use('/api', createMenuRouter({ io }))
  app.use('/api', createGuestRouter({ io }))

  // Auth (any logged-in user)
  app.use('/api', createRolesRouter())
  app.use('/api', createMeRouter())

  // Reception counter
  app.use('/api', createNotificationsRouter())
  app.use('/api', createReportsRouter())
  app.use('/api', createOrdersRouter({ io }))
  app.use('/api', createTablesRouter({ io }))

  // Kitchen
  app.use('/api', createKitchenRouter({ io }))

  // Manager / inventory
  app.use('/api', createInventoryRouter({ io }))

  // Employee / HR
  app.use('/api', createStaffRouter())

  // Admin (includes /api/expenses for reception reports)
  app.use('/api', createAdminRouter())
}
