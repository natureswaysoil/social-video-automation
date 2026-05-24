// @ts-nocheck
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import OpenAI from 'openai'
import { google } from 'googleapis'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

type Product = {
  id: string
  name: string
  description: string
  category: string
  websiteUrl: string
  keywords?: string[]
  brollQueries?: string[]
  productImageUrl?: string
}

type State = {
  cursor: number
  variationByProduct: Record<string, number>
  lastRunAt?: string
}

type CreativeScene = {
  name: string
  seconds?: number
  voiceover?: string
  brollQueries?: string[]
  brollQuery?: string
  useProductImage?: boolean
}

type CreativeProfile = {
  avatarId?: string
  voiceId?: string
  didAvatarId?: string
  didVoiceId?: string
  didAvatarRole?: string
  avatarScale?: number
  avatarOffsetY?: number
  audience?: string
  angle?: string
  tone?: string
  cta?: string
  hooks?: string[]
  scenes?: CreativeScene[]
}

type CreativeProfilesFile = {
  defaults?: CreativeProfile
  profiles?: Record<string, CreativeProfile>
}

type DidAvatarSelection = {
  avatarId: string
  voiceId: string
  role: string
}

const ROOT = process.cwd()
const CONFIG_PATH = path.resolve(ROOT, 'config/top-products.json')
const STATE_PATH = path.resolve(ROOT, process.env.ROTATION_STATE_FILE || 'data/rotation-state.json')
const CREATIVE_PATH = path.resolve(ROOT, 'config/creative-profiles.json')
const WINNING_SEQUENCE_PATH = path.resolve(ROOT, 'config/may6-winning-sequence.json')
const PRODUCT_IMAGES_PATH = path.resolve(ROOT, 'config/product-images.json')
const DEFAULT_STATE: State = { cursor: -1, variationByProduct: {} }

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
  'DID_POLL_TIMEOUT_MS',
  'DID_POLL_INTERVAL_MS',
  'PEXELS_API_KEY',
  'YT_CLIENT_ID',
  'YT_CLIENT_SECRET',
  'YT_REFRESH_TOKEN',
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  'YOUTUBE_REFRESH_TOKEN',
  'INSTAGRAM_ACCESS_TOKEN',
  'INSTAGRAM_IG_ID',
  'INSTAGRAM_USER_ID',
  'INSTAGRAM_ACCOUNT_ID',
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
  if (data === undefined) console.log(message)
  else console.log(message, data)
}

function hasValue(name: string): boolean {
  const value = process.env[name]
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  const placeholders = [
    'your-',
    'your_',
    'yourreal',
    'your_real',
    'paste_',
    'replace_',
    'changeme',
    'placeholder',
    'example_',
    'dummy_',
  ]
  return normalized !== '' && !placeholders.some((token) => normalized.includes(token))
}

function pickEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

function secretCandidates(name: string): string[] {
  const upper = name.trim().replace(/[\s-]+/g, '_').toUpperCase()
  const lowerHyphen = upper.toLowerCase().replace(/_/g, '-')
  const lowerUnderscore = upper.toLowerCase()
  return [...new Set([upper, lowerHyphen, name, name.replace(/_/g, '-'), lowerUnderscore])]
}

function normalizeGeneratorEnv() {
  if (!hasValue('DID_API_KEY') && hasValue('HEYGEN_API_KEY')) process.env.DID_API_KEY = process.env.HEYGEN_API_KEY
  if (!hasValue('DID_API_ENDPOINT') && hasValue('HEYGEN_API_ENDPOINT')) process.env.DID_API_ENDPOINT = process.env.HEYGEN_API_ENDPOINT
  if (!hasValue('DID_DEFAULT_AVATAR') && hasValue('HEYGEN_DEFAULT_AVATAR')) process.env.DID_DEFAULT_AVATAR = process.env.HEYGEN_DEFAULT_AVATAR
  if (!hasValue('DID_DEFAULT_VOICE') && hasValue('HEYGEN_DEFAULT_VOICE')) process.env.DID_DEFAULT_VOICE = process.env.HEYGEN_DEFAULT_VOICE

  if (!hasValue('DID_AVATAR_DOG_OWNER') && hasValue('HEYGEN_AVATAR_DOG_OWNER')) process.env.DID_AVATAR_DOG_OWNER = process.env.HEYGEN_AVATAR_DOG_OWNER
  if (!hasValue('DID_AVATAR_GARDENER') && hasValue('HEYGEN_AVATAR_GARDENER')) process.env.DID_AVATAR_GARDENER = process.env.HEYGEN_AVATAR_GARDENER
  if (!hasValue('DID_AVATAR_FARMER') && hasValue('HEYGEN_AVATAR_FARMER')) process.env.DID_AVATAR_FARMER = process.env.HEYGEN_AVATAR_FARMER
  if (!hasValue('DID_AVATAR_HOMEOWNER') && hasValue('HEYGEN_AVATAR_HOMEOWNER')) process.env.DID_AVATAR_HOMEOWNER = process.env.HEYGEN_AVATAR_HOMEOWNER
}

async function loadSecrets() {
  const useSecretManager = String(process.env.USE_SECRET_MANAGER || 'true').toLowerCase() !== 'false'
  if (!useSecretManager) {
    normalizeGeneratorEnv()
    return
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'natureswaysoil-video'
  const client = new SecretManagerServiceClient()

  for (const secretName of SECRET_NAMES) {
    if (hasValue(secretName)) continue
    for (const candidate of secretCandidates(secretName)) {
      try {
        const [version] = await client.accessSecretVersion({
          name: `projects/${projectId}/secrets/${candidate}/versions/latest`,
        })
        const value = version.payload?.data?.toString().trim()
        if (value) {
          process.env[secretName] = value
          process.env[candidate] = value
          log(`Loaded secret: ${candidate}${candidate === secretName ? '' : ` -> ${secretName}`}`)
          break
        }
      } catch (error: any) {
        if (Number(error?.code) === 5 || String(error?.message || '').includes('NOT_FOUND')) continue
        log(`Could not load secret ${candidate}: ${error?.message || error}`)
        break
      }
    }
  }

  normalizeGeneratorEnv()
}

function loadProducts(): Product[] {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const products = Array.isArray(raw.topProducts) ? raw.topProducts : []
  const imageMap = loadProductImageMap()
  return products
    .slice(0, Number(process.env.SEED_PRODUCT_LIMIT || 5))
    .map((product: Product) => ({
      ...product,
      productImageUrl: product.productImageUrl || imageMap[product.id] || '',
    }))
}

function loadProductImageMap(): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(PRODUCT_IMAGES_PATH, 'utf8'))
    const byProductId = raw?.byProductId || {}
    const out: Record<string, string> = {}
    for (const key of Object.keys(byProductId)) {
      const value = String(byProductId[key] || '').trim()
      if (value) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function loadCreativeProfiles(): CreativeProfilesFile {
  try {
    return JSON.parse(fs.readFileSync(CREATIVE_PATH, 'utf8'))
  } catch {
    return { defaults: {}, profiles: {} }
  }
}

function loadWinningSequence() {
  try {
    return JSON.parse(fs.readFileSync(WINNING_SEQUENCE_PATH, 'utf8'))
  } catch {
    return { defaultSequence: [] }
  }
}

function readState(): State {
  try {
    if (!fs.existsSync(STATE_PATH)) return { ...DEFAULT_STATE }
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    return {
      cursor: typeof parsed.cursor === 'number' ? parsed.cursor : -1,
      variationByProduct: parsed.variationByProduct || {},
      lastRunAt: parsed.lastRunAt,
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

function writeState(state: State) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
}

function pickProduct(products: Product[]) {
  const state = readState()
  const nextCursor = (state.cursor + 1) % products.length
  const product = products[nextCursor]
  const variationCount = Number(process.env.VARIATIONS_PER_PRODUCT || 5)
  const lastVariation = state.variationByProduct[product.id]
  const variationIndex = typeof lastVariation === 'number' ? (lastVariation + 1) % variationCount : 0

  state.cursor = nextCursor
  state.variationByProduct[product.id] = variationIndex
  state.lastRunAt = new Date().toISOString()
  writeState(state)

  return { product, variationIndex, variationCount }
}

function productCreativeProfile(product: Product): CreativeProfile {
  const creative = loadCreativeProfiles()
  return {
    ...(creative.defaults || {}),
    ...((creative.profiles || {})[product.id] || {}),
  }
}

function fallbackScenes(product: Product, profile: CreativeProfile): CreativeScene[] {
  const winning = loadWinningSequence()
  const defaultSequence = Array.isArray(winning.defaultSequence) ? winning.defaultSequence : []
  const fromWinning = defaultSequence.map((scene: any, index: number) => ({
    name: String(scene?.name || `scene-${index + 1}`),
    seconds: Number(scene?.durationSeconds || 6),
    brollQueries: Array.isArray(scene?.exampleVisuals) ? scene.exampleVisuals : (product.brollQueries || [product.category]),
    useProductImage: index === 1 || index === 4,
  }))

  if (profile.scenes?.length) {
    return profile.scenes.slice(0, 5).map((scene, index) => ({
      ...scene,
      useProductImage: scene.useProductImage ?? (index === 1 || index === 4),
    }))
  }

  if (fromWinning.length) return fromWinning.slice(0, 5)

  return [
    { name: 'problem', seconds: 5, brollQueries: product.brollQueries || [product.category] },
    { name: 'product hero', seconds: 5, brollQueries: product.brollQueries || [product.name], useProductImage: true },
    { name: 'application', seconds: 6, brollQueries: ['watering lawn', 'garden application'] },
    { name: 'soil benefit', seconds: 6, brollQueries: ['healthy roots', 'rich soil close up'] },
    { name: 'result', seconds: 6, brollQueries: product.brollQueries || [product.category] },
  ]
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function chooseHook(profile: CreativeProfile, variationIndex: number): string {
  const hooks = profile.hooks || []
  if (!hooks.length) return ''
  return hooks[variationIndex % hooks.length] || ''
}

async function generateScenePlan(product: Product, profile: CreativeProfile, variationIndex: number, variationCount: number): Promise<{ fullVoiceover: string, scenes: CreativeScene[] }> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const baseScenes = fallbackScenes(product, profile)
  const scenePrompt = baseScenes
    .map((scene, index) => `${index + 1}. ${scene.name} (${scene.seconds || 6}s) :: ${(scene.brollQueries || [scene.brollQuery || product.category]).join(' | ')}`)
    .join('\n')
  const preferredHook = chooseHook(profile, variationIndex)

  const prompt = `Create a high-retention 25-35 second vertical product video script and scene plan for Nature's Way Soil.

Product: ${product.name}
Description: ${product.description}
Category: ${product.category}
Website: ${product.websiteUrl}
Variation: ${variationIndex + 1} of ${variationCount}; use a fresh opening hook.
Audience: ${profile.audience || 'home and land owners'}
Angle: ${profile.angle || 'soil-first product explanation'}
Tone: ${profile.tone || 'plainspoken and practical'}
Preferred opening hook: ${preferredHook || 'none'}
Target scene flow:\n${scenePrompt}

Rules:
- Keep it honest and compliant.
- Do not guarantee results.
- Do not claim pesticide, disease cure, or instant fix.
- Sound natural, direct, and helpful.
- Keep each scene visual-focused and avoid static talking-head feel.
- Scene 2 should be product-hero oriented.
- End with a direct website call to action.
- Return only JSON in this exact shape:
  {"fullVoiceover":"...","scenes":[{"name":"...","seconds":6,"voiceover":"...","brollQuery":"..."}]}
- Provide exactly 5 scenes.`

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 700,
  })

  const parsed = parseJson(response.choices[0]?.message?.content?.trim() || '')
  if (parsed?.scenes?.length) {
    const scenes = parsed.scenes.slice(0, 5).map((scene: any, index: number) => ({
      name: String(scene?.name || baseScenes[index]?.name || `scene-${index + 1}`),
      seconds: Number(scene?.seconds || baseScenes[index]?.seconds || 6),
      voiceover: String(scene?.voiceover || '').trim(),
      brollQueries: [String(scene?.brollQuery || baseScenes[index]?.brollQuery || (baseScenes[index]?.brollQueries || product.brollQueries || [product.category])[0] || product.category)],
      useProductImage: index === 1 || index === 4,
    }))
    return {
      fullVoiceover: String(parsed?.fullVoiceover || scenes.map((scene: CreativeScene) => scene.voiceover || '').join(' ').trim() || product.description),
      scenes,
    }
  }

  const fallback = baseScenes.map((scene, index) => ({
    ...scene,
    voiceover: index === 0 && preferredHook
      ? `${preferredHook} ${product.description}`
      : product.description,
  }))
  return {
    fullVoiceover: fallback.map((scene) => scene.voiceover || '').join(' ').trim(),
    scenes: fallback,
  }
}

function productBrollAnchor(product: Product): string {
  const text = `${product.name} ${product.category} ${(product.keywords || []).join(' ')}`.toLowerCase()
  if (/pasture|hay|horse|cattle|farm|field/.test(text)) return 'pasture grass field'
  if (/dog|urine|pet|lawn/.test(text)) return 'backyard lawn grass'
  if (/compost|biochar|worm|raised bed|container/.test(text)) return 'garden soil compost'
  return 'lawn and garden soil'
}

function sanitizeBrollQuery(rawQuery: string, product: Product): string {
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

async function findPexelsBackgroundImage(queries: string[], product: Product): Promise<string> {
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
    const photoResponse = await axios.get('https://api.pexels.com/v1/search', {
      headers: { Authorization: apiKey },
      params: { query, orientation: 'portrait', per_page: 15 },
      timeout: 30000,
    })
    const photos = Array.isArray(photoResponse.data?.photos) ? photoResponse.data.photos : []
    const photo = photos.find((item: any) => Number(item?.height || 0) > Number(item?.width || 0)) || photos[0]
    const imageUrl = photo?.src?.portrait || photo?.src?.large2x || photo?.src?.large || photo?.src?.original || ''
    if (imageUrl) {
      log('Selected Pexels image b-roll', { query, photoId: photo?.id, selected: true })
      return imageUrl
    }

    const videoResponse = await axios.get('https://api.pexels.com/videos/search', {
      headers: { Authorization: apiKey },
      params: { query, orientation: 'portrait', per_page: 6 },
      timeout: 30000,
    })
    const videos = Array.isArray(videoResponse.data?.videos) ? videoResponse.data.videos : []
    const stillImage = videos[0]?.image || ''
    if (stillImage) {
      log('Selected Pexels video thumbnail b-roll', { query, videoId: videos[0]?.id, selected: true })
      return stillImage
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

function inferAvatarRole(product: Product, profile: CreativeProfile): string {
  if (profile.didAvatarRole) return normalizeRole(profile.didAvatarRole)

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

function didAuthorization(apiKey: string): string {
  const value = String(apiKey || '').trim()
  if (/^(basic|bearer)\s+/i.test(value)) return value
  return `Basic ${value}`
}

function isLikelyDidAvatarId(value: string): boolean {
  const v = String(value || '').trim()
  if (!v) return false
  return /^v2_/.test(v) || /^public_/.test(v) || /^pr_/.test(v) || /^avt_/.test(v) || v.includes('@')
}

function resolveDidAvatar(product: Product, profile: CreativeProfile): DidAvatarSelection {
  const role = inferAvatarRole(product, profile)

  const roleAvatar = pickEnv([
    `DID_AVATAR_${role}`,
    `DID_${role}_AVATAR`,
  ])

  const roleVoice = pickEnv([
    `DID_VOICE_${role}`,
    `DID_${role}_VOICE`,
  ])

  const explicitAvatar = String(profile.didAvatarId || '').trim()
  const explicitVoice = String(profile.didVoiceId || '').trim()
  const legacyAvatar = String(profile.avatarId || '').trim()
  const legacyVoice = String(profile.voiceId || '').trim()

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

async function createDiDClip(product: Product, scenePlan: { fullVoiceover: string, scenes: CreativeScene[] }, profile: CreativeProfile): Promise<string> {
  const apiKey = pickEnv(['DID_API_KEY'])
  if (!apiKey) throw new Error('Missing DID_API_KEY')
  const endpoint = (pickEnv(['DID_API_ENDPOINT']) || 'https://api.d-id.com').replace(/\/$/, '')
  const avatar = resolveDidAvatar(product, profile)
  const voiceProvider = pickEnv(['DID_VOICE_PROVIDER']) || 'microsoft'

  const scenes = scenePlan.scenes.length ? scenePlan.scenes : fallbackScenes(product, profile)
  const queryCandidates = scenes.flatMap((scene) => scene.brollQueries?.length ? scene.brollQueries : [scene.brollQuery || product.category])
  const brollBackgroundUrl = await findPexelsBackgroundImage(queryCandidates, product)

  const body: any = {
    presenter_id: avatar.avatarId,
    script: {
      type: 'text',
      input: scenePlan.fullVoiceover || scenes.map((scene) => scene.voiceover || '').join(' ').trim() || product.description,
      subtitles: false,
      provider: {
        type: voiceProvider,
        voice_id: avatar.voiceId,
      },
    },
    config: {
      result_format: 'mp4',
      output_resolution: Number(process.env.DID_OUTPUT_RESOLUTION || 1080),
    },
    name: product.name.slice(0, 120),
  }

  if (brollBackgroundUrl) body.background = { source_url: brollBackgroundUrl }
  else if (product.productImageUrl) body.background = { source_url: product.productImageUrl }
  else body.background = { color: '#0a3d0a' }

  const response = await axios.post(`${endpoint}/clips`, body, {
    headers: {
      Authorization: didAuthorization(apiKey),
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  })

  const clipId = response.data?.id || response.data?.data?.id
  if (!clipId) throw new Error('DiD did not return clip id')
  log('DiD clip job created', {
    clipId,
    avatar: avatar.avatarId,
    voice: avatar.voiceId,
    role: avatar.role,
    hasBackgroundImage: !!(brollBackgroundUrl || product.productImageUrl),
  })
  return clipId
}

async function pollDiDClip(clipId: string): Promise<string> {
  const apiKey = pickEnv(['DID_API_KEY'])
  if (!apiKey) throw new Error('Missing DID_API_KEY')
  const endpoint = (pickEnv(['DID_API_ENDPOINT']) || 'https://api.d-id.com').replace(/\/$/, '')
  const timeoutMs = Number(process.env.DID_POLL_TIMEOUT_MS || process.env.HEYGEN_POLL_TIMEOUT_MS || 1500000)
  const intervalMs = Number(process.env.DID_POLL_INTERVAL_MS || process.env.HEYGEN_POLL_INTERVAL_MS || 15000)
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const response = await axios.get(`${endpoint}/clips/${clipId}`, {
      headers: { Authorization: didAuthorization(apiKey) },
      timeout: 60000,
    })
    const data = response.data || {}
    const status = String(data?.status || '').toLowerCase()
    log('DiD status', { clipId, status })
    if (status === 'done' && data?.result_url) return data.result_url
    if (status === 'error' || status === 'rejected') {
      const reason = data?.error?.description || data?.error?.message || data?.error || 'unknown error'
      throw new Error(`DiD failed: ${reason}`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error('DiD polling timed out')
}

function caption(product: Product, script: string): string {
  const tags = ['#NaturesWaySoil', '#SoilHealth', '#LawnCare', '#Gardening'].join(' ')
  return `${product.name}\n\n${product.description}\n\nShop direct: ${product.websiteUrl}\n\n${tags}`
}

async function postToYouTube(videoUrl: string, title: string, description: string): Promise<string> {
  const clientId = pickEnv(['YT_CLIENT_ID', 'YOUTUBE_CLIENT_ID'])
  const clientSecret = pickEnv(['YT_CLIENT_SECRET', 'YOUTUBE_CLIENT_SECRET'])
  const refreshToken = pickEnv(['YT_REFRESH_TOKEN', 'YOUTUBE_REFRESH_TOKEN'])
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Missing YouTube OAuth credentials')

  const oauth2Client = new google.auth.OAuth2({ clientId, clientSecret })
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client })
  const media = await axios.get(videoUrl, { responseType: 'stream', timeout: 120000 })

  const upload = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: title.slice(0, 95), description, categoryId: '22' },
      status: { privacyStatus: (process.env.YT_PRIVACY_STATUS as any) || 'public' },
    },
    media: { body: media.data },
  })

  const id = upload.data.id || ''
  if (!id) throw new Error('YouTube upload did not return video id')
  return id
}

async function postToInstagram(videoUrl: string, captionText: string): Promise<string> {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN
  const igId = pickEnv(['INSTAGRAM_IG_ID', 'INSTAGRAM_USER_ID', 'INSTAGRAM_ACCOUNT_ID'])
  if (!accessToken || !igId) throw new Error('Missing Instagram access token or IG ID')

  const apiVersion = process.env.INSTAGRAM_API_VERSION || 'v20.0'
  const host = process.env.INSTAGRAM_API_HOST || 'graph.facebook.com'
  const baseUrl = `https://${host}/${apiVersion}`

  const container = await axios.post(`${baseUrl}/${igId}/media`, {
    media_type: process.env.IG_MEDIA_TYPE || 'REELS',
    video_url: videoUrl,
    caption: captionText,
  }, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 120000,
  })

  const creationId = container.data?.id
  if (!creationId) throw new Error('Instagram did not return creation id')

  for (let i = 0; i < 24; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10000))
    const status = await axios.get(`${baseUrl}/${creationId}?fields=status_code`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 30000,
    })
    const code = status.data?.status_code
    log('Instagram media status', { creationId, code })
    if (code === 'FINISHED') break
    if (code === 'ERROR' || code === 'EXPIRED') throw new Error(`Instagram container ${code}`)
  }

  const published = await axios.post(`${baseUrl}/${igId}/media_publish`, { creation_id: creationId }, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 120000,
  })

  const mediaId = published.data?.id || ''
  if (!mediaId) throw new Error('Instagram publish did not return media id')
  return mediaId
}

async function main() {
  await loadSecrets()
  normalizeGeneratorEnv()

  const products = loadProducts()
  if (!products.length) throw new Error('No products configured')
  const { product, variationIndex, variationCount } = pickProduct(products)
  const profile = productCreativeProfile(product)
  const avatar = resolveDidAvatar(product, profile)

  log('Scheduled product selected', { product: product.name, id: product.id, variation: `${variationIndex + 1}/${variationCount}` })
  log('Creative mapping selected', {
    avatar: avatar.avatarId || 'default',
    voice: avatar.voiceId || 'default',
    role: avatar.role,
    hasScenePlan: !!profile.scenes?.length,
    hasProductImage: !!product.productImageUrl,
  })

  const scenePlan = await generateScenePlan(product, profile, variationIndex, variationCount)
  log('Generated scene plan', {
    fullVoiceoverLength: scenePlan.fullVoiceover.length,
    scenes: scenePlan.scenes.map((scene, index) => ({
      idx: index + 1,
      name: scene.name,
      seconds: scene.seconds,
      useProductImage: !!scene.useProductImage,
    })),
  })

  const clipId = await createDiDClip(product, scenePlan, profile)
  const videoUrl = await pollDiDClip(clipId)
  log('Finished video URL', { videoUrl })

  const captionText = caption(product, scenePlan.fullVoiceover)
  const platforms = (process.env.ENABLE_PLATFORMS || 'youtube,instagram')
    .toLowerCase()
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  if (String(process.env.DRY_RUN_LOG_ONLY || '').toLowerCase() === 'true') {
    log('Dry run enabled; skipping social posting', { platforms, caption: captionText })
    return
  }

  let posted = 0
  if (platforms.includes('youtube')) {
    try {
      const id = await postToYouTube(videoUrl, product.name, captionText)
      posted++
      log('Posted to YouTube', { id })
    } catch (error: any) {
      log('YouTube post failed', error?.message || error)
    }
  }

  if (platforms.includes('instagram')) {
    try {
      const id = await postToInstagram(videoUrl, captionText)
      posted++
      log('Posted to Instagram', { id })
    } catch (error: any) {
      log('Instagram post failed', error?.message || error)
    }
  }

  if (posted === 0) throw new Error('No platform posts succeeded')
  log('Scheduled post completed', { posted })
}

main().catch((error) => {
  console.error('Scheduled post failed:', error?.message || error)
  process.exit(1)
})