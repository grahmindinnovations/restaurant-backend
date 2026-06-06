# Restaurant backend (`src/`)

## Folder layout

```
src/
├── server.js              ← entry: Firebase init + HTTP listen
├── app/
│   └── createApp.js       ← Express, CORS, helmet, JSON body
├── config/
│   └── routeRegistry.js   ← API map by station (documentation)
├── middleware/
│   ├── auth.js            ← Firebase Bearer token
│   └── roleAccess.js      ← email ↔ role (Firestore roles collection)
├── routes/
│   ├── index.js           ← **mount all routers here**
│   ├── auth/              ← GET /api/me, /api/roles/:id/access
│   ├── shared/            ← health, menu
│   ├── reception/         ← orders, tables, reports, notifications, expenses*
│   ├── kitchen/           ← kitchen config, finish order
│   ├── manager/           ← inventory
│   ├── employee/          ← staff HR APIsssss
│   └── admin/             ← admin dashboard APIs
├── services/
│   └── firebaseAdmin.js
├── utils/
│   ├── orderTotals.js     ← revenue / COGS math (reports)
│   └── firestoreHelpers.js← readOrders, readTables, readMenu, socket helpers
├── realtime/
│   ├── events.js
│   └── socket.js
└── scripts/
    ├── seedDemoData.js
    └── seedAuthUsers.js
```

\* Expenses live in `admin/admin.routes.js` today but are restricted to `reception` + `admin` roles.

## Add a new API

1. Create `routes/<domain>/my-feature.routes.js` with `export function createMyRouter(...)`.
2. Export it from `routes/<domain>/index.js`.
3. Mount in `routes/index.js` inside `registerApiRoutes`.
4. Document in `config/routeRegistry.js`.
5. Add `requireAnyRole(...)` on routes that need role checks (see `middleware/roleAccess.js`).

## Role rules

Same as frontend: Firestore collection `roles`, document id = `reception` | `kitchen` | `manager` | `employee` | `admin`, field `allowed_email` = user email.

## Dev

```bash
npm run dev          # stable — does not auto-restart (use for daily work)
npm run dev:watch    # auto-restart on file save (backend coding only)
npm run seed:auth    # demo users + roles.allowed_email
```

Run **one** backend on port 5180. Frontend (`npm run dev` in `restaurant-frontend`) proxies `/api` → `127.0.0.1:5180`.

Health: `GET http://localhost:5180/api/health`

### Demo logins (after `seed:auth`)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@example.com | Admin@12345 |
| Reception | reception@example.com | Reception@12345 |
| Kitchen | kitchen@example.com | Kitchen@12345 |

Assign your own email: `npm run assign-role -- you@email.com admin`

Or use **Admin → Staff → App access** in the UI (creates Firebase login + `users` profile).

### Staff vs app access

| | Team directory (`staff` collection) | App access (`users` + Firebase Auth) |
|--|--|--|
| Purpose | HR: name, job title (Chef), phone, salary | Who can **sign in** and which module they open |
| Example | Arjun — Chef | arjun@… — **kitchen** role → `/kitchen` |
| Admin UI | Staff → Team directory / Add team member | Staff → **App access** |
