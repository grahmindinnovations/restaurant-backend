import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'

const MENU_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'menu')
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export function ensureMenuUploadDir() {
  fs.mkdirSync(MENU_UPLOAD_DIR, { recursive: true })
}

/** Relative path in dev (Vite proxies /api). Set PUBLIC_API_URL in production when API is on another host. */
export function publicMenuImageUrl(_req, filename) {
  const rel = `/api/uploads/menu/${filename}`
  const base = String(process.env.PUBLIC_API_URL || '').replace(/\/$/, '')
  if (base) return `${base}${rel}`
  return rel
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    ensureMenuUploadDir()
    cb(null, MENU_UPLOAD_DIR)
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase()
    const safeExt = ALLOWED_EXT.has(ext) ? ext : '.jpg'
    cb(null, `${crypto.randomUUID()}${safeExt}`)
  },
})

export const menuImageUpload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = /^image\/(jpeg|png|webp)$/i.test(file.mimetype || '')
    cb(ok ? null : new Error('Only JPEG, PNG, or WebP images are allowed'), ok)
  },
})
