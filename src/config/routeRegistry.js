/**
 * API route map by station (domain).
 * Mount order is defined in routes/index.js — reception before admin where paths overlap.
 */

export const API_DOMAINS = {
  shared: {
    label: 'Shared',
    description: 'Health check and menu (all authenticated stations)',
    endpoints: ['GET /api/health', 'GET|POST|PATCH|DELETE /api/menu', 'POST /api/menu/backfill-cost-prices'],
  },
  auth: {
    label: 'Auth',
    description: 'Login profile and role access checks',
    endpoints: ['GET /api/me', 'GET /api/roles/:roleId/access'],
  },
  reception: {
    label: 'Reception counter',
    roles: ['reception', 'admin'],
    endpoints: [
      'GET|POST /api/orders',
      'POST /api/orders/:id/pay|cancel',
      'GET|PATCH /api/tables',
      'GET /api/reports/summary',
      'GET|POST|DELETE /api/expenses',
      'GET /api/notifications?role=reception',
    ],
  },
  kitchen: {
    label: 'Kitchen',
    roles: ['kitchen', 'admin'],
    endpoints: [
      'GET|PATCH /api/kitchen/config',
      'POST /api/kitchen/orders/:id/finish',
      'GET /api/notifications?role=kitchen',
    ],
  },
  manager: {
    label: 'Manager / inventory',
    roles: ['manager', 'admin'],
    endpoints: ['GET|PATCH /api/inventory/*'],
  },
  employee: {
    label: 'Employee / HR',
    roles: ['employee', 'admin'],
    endpoints: ['GET|POST|PATCH /api/staff/*'],
  },
  admin: {
    label: 'Admin',
    roles: ['admin'],
    endpoints: ['GET /api/admin/*', 'admin dashboard APIs'],
  },
}
