import { EVENTS } from '../realtime/events.js'

export async function readOrders(db) {
  try {
    const snap = await db.collection('orders').orderBy('createdAt', 'desc').get()
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch {
    const snap = await db.collection('orders').get()
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }
}

export async function readTables(db) {
  const snap = await db.collection('tables').get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function readMenu(db) {
  const snap = await db.collection('menu_items').orderBy('name').get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export function tableIdFromOrder(order) {
  const rawTable = order?.table ?? null
  const tableId =
    rawTable && typeof rawTable === 'object' ? rawTable.id || null : rawTable
  const tableIdStr = tableId ? String(tableId).trim() : ''
  return tableIdStr && !tableIdStr.includes('/') ? tableIdStr : null
}

export function emitOrdersUpdate(io, db) {
  return readOrders(db).then((orders) => io?.emit(EVENTS.ORDERS_UPDATE, orders))
}

export function emitTablesUpdate(io, db) {
  return readTables(db).then((tables) => io?.emit(EVENTS.TABLES_UPDATE, tables))
}

export function emitMenuUpdate(io, db) {
  return readMenu(db).then((menu) => io?.emit(EVENTS.MENU_UPDATE, menu))
}
