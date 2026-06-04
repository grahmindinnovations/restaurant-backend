export function toMillis(value) {
  if (!value) return null
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const dt = value instanceof Date ? value : new Date(value)
  const ms = dt.getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Revenue = collected / completed meals only (not open KOT or unpaid bills). */
export function isRevenueOrder(status) {
  const s = String(status || '').toLowerCase()
  return s === 'paid' || s === 'completed'
}

export function orderLineTotal(order) {
  const bill = order?.bill
  if (bill && Number.isFinite(Number(bill.total))) {
    return Math.round(Number(bill.total))
  }
  if (Number.isFinite(Number(order?.total))) {
    return Math.round(Number(order.total))
  }
  const items = Array.isArray(order?.items) ? order.items : []
  const sub = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0)
  const gst = Number(bill?.gst) || 0
  const service = Number(bill?.serviceCharge) || 0
  return Math.round(sub + gst + service)
}

export function periodStart(period) {
  const key = String(period || 'all').toLowerCase()
  const now = new Date()
  if (key === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }
  if (key === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }
  return null
}
