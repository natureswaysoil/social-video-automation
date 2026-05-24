// @ts-nocheck
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import OpenAI from 'openai'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

const ROOT = process.cwd()
const PRODUCTS_FILE = path.resolve(ROOT, 'config/top-products.json')
const CREATIVE_FILE = path.resolve(ROOT, 'config/creative-profiles.json')
const STATE_FILE = path.resolve(ROOT, 'data/creative-test-state.json')

const SECRET_NAMES = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'DID_API_KEY',
  'DID_API_ENDPOINT',
  'DID_DEFAULT_AVATAR',
  'DID_DEFAULT_VOICE',
  'DID_VOICE_PROVIDER',
  'DID_AVATAR_DOG_OWNER',
  'DID_AVATAR_GARDENER',
  'DID_AVATAR_FARMER',
  'DID_AVATAR_HOMEOWNER',
  'DID_VOICE_DOG_OWNER',
  'DID_VOICE_GARDENER',
  'DID_VOICE_FARMER',
  'DID_VOICE_HOMEOWNER',
  'PEXELS_API_KEY',
  // Backward compatibility aliases
  'HEYGEN_API_KEY',
  'HEYGEN_API_ENDPOINT',
  'HEYGEN_DEFAULT_AVATAR',
  'HEYGEN_DEFAULT_VOICE',
  'HEYGEN_AVATAR_DOG_OWNER',
  'HEYGEN_AVATAR_GARDENER',
  'HEYGEN_AVATAR_FARMER',
  'HEYGEN_AVATAR_HOMEOWNER',
]

const DEFAULT_DID_AVATAR_BY_ROLE: Record<string, string> = {
  DOG_OWNER: 'v2_public_Amber@0zSz8kflCN',
  GARDENER: 'v2_public_Amber@0zSz8kflCN',
  HOMEOWNER: 'v2_public_Amber@0zSz8kflCN',
  FARMER: 'v2_public_Adam@0GLJgELXjc',
}

const DEFAULT_DID_VOICE_BY_ROLE: Record<string, string> = {
  DOG_OWNER: 'en-US-JennyNeural',
  GARDENER: 'en-US-AriaNeural',
  HOMEOWNER: 'en-US-AvaNeural',
  FARMER: 'en-US-GuyNeural',
}

const BROLL_BLOCKED_TERMS = [
  'ocean',
  'underwater',
  'reef',
  'beach',
  'marine',
  'scuba',
  'snorkel',
  'fish',
  'whale',
  'coral',
]

const STRICT_BROLL_QUERY_QA = String(process.env.STRICT_BROLL_QUERY_QA || 'true').toLowerCase() !== 'false'

function log(message: string, data?: any) {
  data === undefined ? console.log(message) : console.log(message, data)
}

function json(file: string, fallback: any) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback
  } catch {
    return fallback
  }
}

function good(value?: string) {
  return !!value && !/your_|your-|changeme|placeholder|paste_|replace_/i.test(value)
}

function variants(name: string) {
  const upper = name.replace(/[\s-]+/g, '_').toUpperCase()
  return [...new Set([upper, upper.toLowerCase().replace(/_/g, '-'), upper.toLowerCase()])]
}

function pickEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

function normalizeGeneratorEnv() {
  if (!good(process.env.DID_API_KEY) && good(process.env.HEYGEN_API_KEY)) process.env.DID_API_KEY = process.env.HEYGEN_API_KEY
  if (!good(process.env.DID_API_ENDPOINT) && good(process.env.HEYGEN_API_ENDPOINT)) process.env.DID_API_ENDPOINT = process.env.HEYGEN_API_ENDPOINT
  if (!good(process.env.DID_DEFAULT_AVATAR) && good(process.env.HEYGEN_DEFAULT_AVATAR)) process.env.DID_DEFAULT_AVATAR = process.env.HEYGEN_DEFAULT_AVATAR
  if (!good(process.env.DID_DEFAULT_VOICE) && good(process.env.HEYGEN_DEFAULT_VOICE)) process.env.DID_DEFAULT_VOICE = process.env.HEYGEN_DEFAULT_VOICE

  if (!good(process.env.DID_AVATAR_DOG_OWNER) && good(process.env.HEYGEN_AVATAR_DOG_OWNER)) process.env.DID_AVATAR_DOG_OWNER = process.env.HEYGEN_AVATAR_DOG_OWNER
  if (!good(process.env.DID_AVATAR_GARDENER) && good(process.env.HEYGEN_AVATAR_GARDENER)) process.env.DID_AVATAR_GARDENER = process.env.HEYGEN_AVATAR_GARDENER
  if (!good(process.env.DID_AVATAR_FARMER) && good(process.env.HEYGEN_AVATAR_FARMER)) process.env.DID_AVATAR_FARMER = process.env.HEYGEN_AVATAR_FARMER
  if (!good(process.env.DID_AVATAR_HOMEOWNER) && good(process.env.HEYGEN_AVATAR_HOMEOWNER)) process.env.DID_AVATAR_HOMEOWNER = process.env.HEYGEN_AVATAR_HOMEOWNER
}

async function loadSecrets() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'natureswaysoil-video'
  const client = new SecretManagerServiceClient()
  for (const name of SECRET_NAMES) {
    if (good(process.env[name])) continue
    for (const candidate of variants(name)) {
      try {
        const [version] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${candidate}/versions/latest` })
        const value = version.payload?.data?.toString().trim()
        if (value) {
          process.env[name] = value
          log(`Loaded secret: ${candidate}`)
          break
        }
      } catch (error: any) {
        if (Number(error?.code) === 5) continue
        log(`Could not load ${candidate}`, error?.message || error)
        break
      }
    }
  }
  normalizeGeneratorEnv()
}

function pickProduct() {
  const products = json(PRODUCTS_FILE, { topProducts: [] }).topProducts || []
  if (!products.length) throw new Error('No products found')
  const state = json(STATE_FILE, { cursor: -1 })
  state.cursor = (Number(state.cursor || -1) + 1) % products.length
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  return products[state.cursor]
}

function creativeFor(product: any) {
  const raw = json(CREATIVE_FILE, { defaults: {}, profiles: {} })
  return { ...(raw.defaults || {}), ...((raw.profiles || {})[product.id] || {}) }
}

function fallbackScenes(product: any, creative: any) {
  const scenes = creative.scenes?.length ? creative.scenes : [
    { name: 'problem', seconds: 7, brollQueries: product.brollQueries || [product.category] },
    { name: 'mechanism', seconds: 8, brollQueries: product.brollQueries || [product.category] },
    { name: 'application', seconds: 8, brollQueries: ['watering lawn', 'gardening application'] },
    { name: 'cta', seconds: 7, brollQueries: product.brollQueries || [product.category] },
  ]
  const hook = creative.hooks?.[0] || `${product.name} supports healthier soil and stronger-looking growth.`
  const text = [hook, product.description, 'Use it as part of your regular soil or lawn care routine according to label directions.', creative.cta || "Shop direct at Nature's Way Soil."]
  return scenes.slice(0, 4).map((s: any, i: number) => ({ name: s.name, seconds: s.seconds || 7, voiceover: text[i], brollQuery: (s.brollQueries || product.brollQueries || [product.category])[0] }))
}

function parseJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    try { return JSON.parse(m[0]) } catch { return null }
  }
}

async function generateScenes(product: any, creative: any) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const plan = (creative.scenes || []).map((s: any) => `${s.name}: ${(s.brollQueries || []).join(' | ')}`).join('\n')
  const prompt = `Create a 30 second vertical ad for Nature's Way Soil. Product: ${product.name}. Description: ${product.description}. Audience: ${creative.audience}. Angle: ${creative.angle}. Tone: ${creative.tone}. Scene plan: ${plan}. Return only JSON: {"fullVoiceover":"...","scenes":[{"name":"...","seconds":7,"voiceover":"...","brollQuery":"..."}]}. Use 4 scenes. Be honest, no guaranteed results, end with a website CTA.`
  const response = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.75, max_tokens: 650 })
  const parsed = parseJson(response.choices[0]?.message?.content || '')
  const scenes = parsed?.scenes?.length ? parsed.scenes.slice(0, 4) : fallbackScenes(product, creative)
  return { fullVoiceover: parsed?.fullVoiceover || scenes.map((s: any) => s.voiceover).join(' '), scenes }
}

function productBrollAnchor(product: any): string {
  const text = `${product.name} ${product.category} ${(product.keywords || []).join(' ')}`.toLowerCase()
  if (/pasture|hay|horse|cattle|farm|field/.test(text)) return 'pasture grass field'
  if (/dog|urine|pet|lawn/.test(text)) return 'backyard lawn grass'
  if (/compost|biochar|worm|raised bed|container/.test(text)) return 'garden soil compost'
  return 'lawn and garden soil'
}

function sanitizeBrollQuery(rawQuery: string, product: any): string {
  const input = String(rawQuery || '').trim().toLowerCase()
  if (!input) return productBrollAnchor(product)

  let query = input
  for (const term of BROLL_BLOCKED_TERMS) {
    query = query.replace(new RegExp(`\\b${term}\\b`, 'gi'), ' ')
  }
  query = query.replace(/\s+/g, ' ').trim()

  const anchor = productBrollAnchor(product)
  const hasLandContext = /lawn|garden|soil|yard|grass|root|compost|pasture|field|plant|fertilizer|spray|watering/.test(query)
  if (!hasLandContext) query = `${query} ${anchor}`.trim()
  if (query.length < 8) query = anchor
  return query
}

function queryTokenSet(value: string): Set<string> {
  return new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  )
}

function querySimilarity(a: string, b: string): number {
  const left = queryTokenSet(a)
  const right = queryTokenSet(b)
  if (!left.size && !right.size) return 1
  if (!left.size || !right.size) return 0
  let overlap = 0
  for (const token of left) {
    if (right.has(token)) overlap++
  }
  return overlap / Math.max(left.size, right.size)
}

async function findPexelsBackgroundImage(queries: string[], product: any): Promise<string> {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) return ''
  const inputOptions = queries.length ? queries : ['healthy soil close up']
  const options = inputOptions
    .map((originalQuery) => {
      const sanitizedQuery = sanitizeBrollQuery(originalQuery, product)
      if (STRICT_BROLL_QUERY_QA) {
        const similarity = querySimilarity(originalQuery, sanitizedQuery)
        if (String(originalQuery || '').trim() && similarity < 0.35) {
          throw new Error(`B-roll QA rejected query for ${product.id}: "${originalQuery}" -> "${sanitizedQuery}"`)
        }
      }
      return sanitizedQuery
    })
    .filter(Boolean)

  for (const query of options.slice(0, 3)) {
    const photos = await axios.get('https://api.pexels.com/v1/search', {
      headers: { Authorization: apiKey },
      params: { query, orientation: 'portrait', per_page: 12 },
      timeout: 30000,
    })
    const items = Array.isArray(photos.data?.photos) ? photos.data.photos : []
    const photo = items.find((item: any) => Number(item?.height || 0) > Number(item?.width || 0)) || items[0]
    const imageUrl = photo?.src?.portrait || photo?.src?.large2x || photo?.src?.large || photo?.src?.original || ''
    if (imageUrl) {
      log('B-roll scene picked', { query, pexelsPhotoId: photo?.id, selected: true })
      return imageUrl
    }
  }
  return ''
}

function normalizeRole(input: string): string {
  const value = String(input || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (['DOG', 'PET', 'DOG_OWNER', 'PET_OWNER'].includes(value)) return 'DOG_OWNER'
  if (['FARM', 'FARMER', 'PASTURE', 'RANCH', 'AG'].includes(value)) return 'FARMER'
  if (['GARDEN', 'GARDENER', 'COMPOST', 'SOIL'].includes(value)) return 'GARDENER'
  return value || 'HOMEOWNER'
}

function inferAvatarRole(product: any, creative: any): string {
  if (creative.didAvatarRole) return normalizeRole(creative.didAvatarRole)
  const byProductId: Record<string, string> = {
    NWS_014: 'DOG_OWNER',
    NWS_011: 'GARDENER',
    NWS_013: 'GARDENER',
    NWS_021: 'FARMER',
    NWS_018: 'HOMEOWNER',
  }
  if (byProductId[product.id]) return byProductId[product.id]

  const text = `${product.name} ${product.category} ${(product.keywords || []).join(' ')}`.toLowerCase()
  if (/dog|pet|urine/.test(text)) return 'DOG_OWNER'
  if (/pasture|hay|horse|cattle|farm|field/.test(text)) return 'FARMER'
  if (/compost|biochar|garden|worm|raised bed|soil/.test(text)) return 'GARDENER'
  return 'HOMEOWNER'
}

function isLikelyDidAvatarId(value: string): boolean {
  const v = String(value || '').trim()
  if (!v) return false
  return /^v2_/.test(v) || /^public_/.test(v) || /^pr_/.test(v) || /^avt_/.test(v) || v.includes('@')
}

function resolveDidAvatar(product: any, creative: any) {
  const role = inferAvatarRole(product, creative)
  const roleAvatar = pickEnv([`DID_AVATAR_${role}`, `DID_${role}_AVATAR`])
  const roleVoice = pickEnv([`DID_VOICE_${role}`, `DID_${role}_VOICE`])

  const explicitAvatar = String(creative.didAvatarId || '').trim()
  const explicitVoice = String(creative.didVoiceId || '').trim()
  const legacyAvatar = String(creative.avatarId || '').trim()
  const legacyVoice = String(creative.voiceId || '').trim()

  const avatarId = explicitAvatar
    || roleAvatar
    || (isLikelyDidAvatarId(legacyAvatar) ? legacyAvatar : '')
    || pickEnv(['DID_DEFAULT_AVATAR'])
    || DEFAULT_DID_AVATAR_BY_ROLE[role]
    || DEFAULT_DID_AVATAR_BY_ROLE.HOMEOWNER

  const voiceId = explicitVoice
    || roleVoice
    || legacyVoice
    || pickEnv(['DID_DEFAULT_VOICE'])
    || DEFAULT_DID_VOICE_BY_ROLE[role]
    || DEFAULT_DID_VOICE_BY_ROLE.HOMEOWNER

  return { avatarId, voiceId, role }
}

function didAuthorization(apiKey: string): string {
  const value = String(apiKey || '').trim()
  if (/^(basic|bearer)\s+/i.test(value)) return value
  return `Basic ${value}`
}

async function createDidClip(product: any, creative: any, generated: any) {
  const endpoint = (pickEnv(['DID_API_ENDPOINT']) || 'https://api.d-id.com').replace(/\/$/, '')
  const apiKey = pickEnv(['DID_API_KEY'])
  if (!apiKey) throw new Error('Missing DID_API_KEY')

  const avatar = resolveDidAvatar(product, creative)
  const voiceProvider = pickEnv(['DID_VOICE_PROVIDER']) || 'microsoft'
  const queries = generated.scenes.flatMap((scene: any) => scene.brollQueries?.length ? scene.brollQueries : [scene.brollQuery || product.category])
  const backgroundImageUrl = await findPexelsBackgroundImage(queries, product)

  const body: any = {
    presenter_id: avatar.avatarId,
    script: {
      type: 'text',
      input: generated.fullVoiceover,
      subtitles: false,
      provider: { type: voiceProvider, voice_id: avatar.voiceId },
    },
    config: { result_format: 'mp4', output_resolution: Number(process.env.DID_OUTPUT_RESOLUTION || 1080) },
    name: product.name,
  }

  if (backgroundImageUrl) body.background = { source_url: backgroundImageUrl }
  else body.background = { color: '#0a3d0a' }

  const res = await axios.post(`${endpoint}/clips`, body, {
    headers: { Authorization: didAuthorization(apiKey), 'Content-Type': 'application/json' },
    timeout: 120000,
  })
  const clipId = res.data?.id || res.data?.data?.id
  log('DiD creative video job created', { clipId, product: product.name, avatar: avatar.avatarId, voice: avatar.voiceId, role: avatar.role, hasBackground: !!backgroundImageUrl })
  return clipId
}

async function poll(clipId: string) {
  const endpoint = (pickEnv(['DID_API_ENDPOINT']) || 'https://api.d-id.com').replace(/\/$/, '')
  const apiKey = pickEnv(['DID_API_KEY'])
  if (!apiKey) throw new Error('Missing DID_API_KEY')
  const timeoutMs = Number(process.env.DID_POLL_TIMEOUT_MS || 1200000)
  const intervalMs = Number(process.env.DID_POLL_INTERVAL_MS || 15000)
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const res = await axios.get(`${endpoint}/clips/${clipId}`, {
      headers: { Authorization: didAuthorization(apiKey) },
      timeout: 60000,
    })
    const data = res.data || {}
    const status = String(data?.status || '').toLowerCase()
    log('DiD status', { clipId, status })
    if (status === 'done' && data?.result_url) return data.result_url
    if (status === 'error' || status === 'rejected') throw new Error(data?.error?.description || data?.error || 'DiD failed')
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('Timed out waiting for DiD')
}

async function main() {
  await loadSecrets()
  normalizeGeneratorEnv()

  const product = pickProduct()
  const creative = creativeFor(product)
  const avatar = resolveDidAvatar(product, creative)
  log('Creative product selected', { product: product.name, id: product.id, angle: creative.angle, avatar: avatar.avatarId, role: avatar.role })

  const generated = await generateScenes(product, creative)
  log('Generated scene plan', generated.scenes.map((s: any) => ({ name: s.name, query: s.brollQuery, text: s.voiceover })))

  const clipId = await createDidClip(product, creative, generated)
  const videoUrl = await poll(clipId)
  log('Finished creative video URL', { videoUrl })
}

main().catch((error) => {
  console.error('Creative test failed:', error?.message || error)
  process.exit(1)
})