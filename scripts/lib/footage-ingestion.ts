// @ts-nocheck
import fs from 'fs'
import path from 'path'
import { ensureDir, safeFileName } from './video-utils'

const ROOT = process.cwd()
const FOOTAGE_DIR = path.resolve(ROOT, process.env.FOOTAGE_DIR || 'footage')
const INDEX_FILE = path.resolve(ROOT, process.env.FOOTAGE_INDEX || 'data/footage-index.json')

export function scanFootage() {
  ensureDir(FOOTAGE_DIR)
  const files = fs.readdirSync(FOOTAGE_DIR)
    .filter((file) => /\.(mp4|mov|mkv|webm)$/i.test(file))
    .map((file) => {
      const full = path.resolve(FOOTAGE_DIR, file)
      const stat = fs.statSync(full)
      return {
        file,
        full,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString()
      }
    })

  const payload = {
    updatedAt: new Date().toISOString(),
    files
  }

  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true })
  fs.writeFileSync(INDEX_FILE, JSON.stringify(payload, null, 2), 'utf8')

  return payload
}

export function pickFootage(product: any) {
  const payload = fs.existsSync(INDEX_FILE)
    ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    : scanFootage()

  const files = payload.files || []
  if (!files.length) return null

  const keywords = `${product.name} ${product.category} ${(product.keywords || []).join(' ')}`.toLowerCase()

  const ranked = files
    .map((item: any) => {
      const name = item.file.toLowerCase()
      let score = 0
      if (/lawn|grass|yard/.test(name) && /lawn|grass|yard/.test(keywords)) score += 5
      if (/pasture|field|hay/.test(name) && /pasture|field|hay/.test(keywords)) score += 5
      if (/spray|sprayer|hose/.test(name)) score += 4
      if (/before|after/.test(name)) score += 6
      return { ...item, score }
    })
    .sort((a: any, b: any) => b.score - a.score)

  return ranked[0] || files[0]
}

export function recommendedFootageChecklist() {
  return [
    'spraying lawn footage',
    'dry grass before footage',
    'green lawn after footage',
    'close-up soil footage',
    'hose-end sprayer footage',
    'pasture field drone footage',
    'root-zone closeups',
    'walking application footage'
  ]
}
