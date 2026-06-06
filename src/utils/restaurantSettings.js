const toNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export const DEFAULT_RESTAURANT_SETTINGS = {
  restaurantName: '',
  tagline: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  gstin: '',
  currency: 'INR',
  gstPercent: 5,
  gstEnabled: true,
  serviceChargeEnabled: true,
  serviceChargeAmount: 150,
  serviceChargeDineInOnly: true,
  lowStockThreshold: 20,
  receiptFooter: 'Thank you. Visit again!',
  showGstOnReceipt: true,
}

export function normalizeRestaurantSettings(data = {}) {
  const src = data && typeof data === 'object' ? data : {}
  return {
    restaurantName: String(src.restaurantName ?? src.name ?? '').trim(),
    tagline: String(src.tagline ?? '').trim(),
    phone: String(src.phone ?? '').trim(),
    email: String(src.email ?? '').trim(),
    address: String(src.address ?? '').trim(),
    city: String(src.city ?? '').trim(),
    gstin: String(src.gstin ?? '').trim(),
    currency: String(src.currency ?? 'INR').trim() || 'INR',
    gstPercent: Math.max(0, Math.min(100, toNumber(src.gstPercent, DEFAULT_RESTAURANT_SETTINGS.gstPercent))),
    gstEnabled: src.gstEnabled !== false,
    serviceChargeEnabled: src.serviceChargeEnabled !== false,
    serviceChargeAmount: Math.max(0, toNumber(src.serviceChargeAmount, DEFAULT_RESTAURANT_SETTINGS.serviceChargeAmount)),
    serviceChargeDineInOnly: src.serviceChargeDineInOnly !== false,
    lowStockThreshold: Math.max(1, toNumber(src.lowStockThreshold, DEFAULT_RESTAURANT_SETTINGS.lowStockThreshold)),
    receiptFooter: String(src.receiptFooter ?? DEFAULT_RESTAURANT_SETTINGS.receiptFooter).trim()
      || DEFAULT_RESTAURANT_SETTINGS.receiptFooter,
    showGstOnReceipt: src.showGstOnReceipt !== false,
  }
}

export async function getRestaurantSettings(db) {
  const snap = await db.collection('settings').doc('restaurant').get()
  return normalizeRestaurantSettings(snap.exists ? snap.data() : {})
}
