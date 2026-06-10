import 'dotenv/config'
import express from 'express'
import fs from 'fs'
import path from 'path'

const app = express()
const ROOT = process.cwd()
const PORT = Number(process.env.PORT || 8080)
const STATE_FILE = path.resolve(ROOT, process.env.ROTATION_STATE_FILE || 'data/rotation-state.json')
const PRODUCTS_FILE = path.resolve(ROOT, 'config/top-products.json')
const CREATIVE_FILE = path.resolve(ROOT, 'config/creative-profiles.json')

function fileStatus(file: string) {
  const full = path.resolve(ROOT, file)
  if (!fs.existsSync(full)) return { exists: false }
  const stat = fs.statSync(full)
  return { exists: true, bytes: stat.size, modifiedAt: stat.mtime.toISOString() }
}

function safeJson(file: string, fallback: any) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error: any) {
    return { error: error?.message || String(error) }
  }
}

function hasEnv(name: string) {
  const value = process.env[name]
  return !!value && !/your_|your-|changeme|placeholder|paste_|replace_/i.test(value)
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'social-video-automation',
    endpoints: ['/healthz', '/readyz', '/status']
  })
})

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

app.get('/readyz', (_req, res) => {
  const requiredFiles = ['config/top-products.json', 'config/creative-profiles.json']
  const files = requiredFiles.map((file) => ({ file, ...fileStatus(file) }))
  const missingFiles = files.filter((f) => !f.exists)
  const requiredEnv = ['OPENAI_API_KEY', 'PEXELS_API_KEY']
  const provider = String(process.env.VIDEO_PROVIDER || 'openai_tts').toLowerCase()
  const env = requiredEnv.map((name) => ({ name, present: hasEnv(name) }))
  const missingEnv = env.filter((e) => !e.present)
  const ok = missingFiles.length === 0 && missingEnv.length === 0
  res.status(ok ? 200 : 503).json({ ok, provider, files, env })
})

app.get('/status', (_req, res) => {
  const products = safeJson(PRODUCTS_FILE, { topProducts: [] })
  const creative = safeJson(CREATIVE_FILE, { defaults: {}, profiles: {} })
  const state = safeJson(STATE_FILE, { cursor: -1, variationByProduct: {} })
  res.json({
    ok: true,
    provider: process.env.VIDEO_PROVIDER || 'openai_tts',
    dryRun: String(process.env.DRY_RUN_LOG_ONLY || '').toLowerCase() === 'true',
    platforms: process.env.ENABLE_PLATFORMS || 'youtube,instagram',
    productCount: Array.isArray(products.topProducts) ? products.topProducts.length : 0,
    profileCount: creative?.profiles ? Object.keys(creative.profiles).length : 0,
    state
  })
})

app.listen(PORT, () => {
  console.log(`social-video-automation health server listening on ${PORT}`)
})
