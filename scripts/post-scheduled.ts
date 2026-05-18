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
  'HEYGEN_API_KEY',
  'HEYGEN_API_ENDPOINT',
  'HEYGEN_DEFAULT_AVATAR',
  'HEYGEN_DEFAULT_VOICE',
  'HEYGEN_AVATAR_SCALE',
  'HEYGEN_AVATAR_OFFSET_Y',
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
]

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

function secretCandidates(name: string): string[] {
  const upper = name.trim().replace(/[\s-]+/g, '_').toUpperCase()
  const lowerHyphen = upper.toLowerCase().replace(/_/g, '-')
  const lowerUnderscore = upper.toLowerCase()
  return [...new Set([upper, lowerHyphen, name, name.replace(/_/g, '-'), lowerUnderscore])]
}

async function loadSecrets() {
  const useSecretManager = String(process.env.USE_SECRET_MANAGER || 'true').toLowerCase() !== 'false'
  if (!useSecretManager) return

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
      useProductImage: scene.useProductImage ?? index === 1 || index === 4,
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
      .filter((token) => token.length >= 3)
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

async function findPexelsVideo(queries: string[], product: Product): Promise<string> {
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
    const response = await axios.get('https://api.pexels.com/videos/search', {
      headers: { Authorization: apiKey },
      params: { query, orientation: 'portrait', per_page: 8 },
      timeout: 30000,
    })
    const videos = Array.isArray(response.data?.videos) ? response.data.videos : []
    const video = videos[0]
    const files = video?.video_files || []
    const portrait = files.find((file: any) => Number(file.height || 0) > Number(file.width || 0))
    const sd = files.find((file: any) => file.quality === 'sd')
    const url = portrait?.link || sd?.link || files[0]?.link || ''
    log('Selected Pexels b-roll', { query, videoId: video?.id, url: url ? 'selected' : 'none' })
    if (url) return url
  }

  return ''
}

function avatarSettings(profile: CreativeProfile) {
  const scale = Number(process.env.HEYGEN_AVATAR_SCALE || profile.avatarScale || 0.46)
  const offsetY = Number(process.env.HEYGEN_AVATAR_OFFSET_Y || profile.avatarOffsetY || 0.18)
  return {
    avatar_id: profile.avatarId || process.env.HEYGEN_DEFAULT_AVATAR || 'Daisy-inskirt-20220818',
    voice_id: profile.voiceId || process.env.HEYGEN_DEFAULT_VOICE || '2d5b0e6cf36f460aa7fc47e3eee4ba54',
    scale,
    offsetY,
  }
}

async function createHeyGenVideo(product: Product, scenePlan: { fullVoiceover: string, scenes: CreativeScene[] }, profile: CreativeProfile): Promise<string> {
  const apiKey = process.env.HEYGEN_API_KEY
  if (!apiKey) throw new Error('Missing HEYGEN_API_KEY')
  const endpoint = process.env.HEYGEN_API_ENDPOINT || 'https://api.heygen.com'
  const avatar = avatarSettings(profile)

  const scenes = scenePlan.scenes.length ? scenePlan.scenes : fallbackScenes(product, profile)
  const videoInputs = []
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index]
    const queries = scene.brollQueries?.length
      ? scene.brollQueries
      : [scene.brollQuery || product.category]
    const brollUrl = await findPexelsVideo(queries, product)

    const isProductImageSlot = index === 1 || index === 4
    const useProductImage = !!(product.productImageUrl && isProductImageSlot && scene.useProductImage !== false)
    const background = useProductImage
      ? { type: 'image', url: product.productImageUrl }
      : brollUrl
        ? { type: 'video', url: brollUrl, play_style: 'fit_to_scene' }
        : { type: 'color', value: '#0a3d0a' }

    const sceneVoice = (scene.voiceover || '').trim() || product.description
    videoInputs.push({
      character: {
        type: 'avatar',
        avatar_id: avatar.avatar_id,
        avatar_style: 'normal',
        scale: avatar.scale,
        offset: { x: 0, y: avatar.offsetY },
      },
      voice: {
        type: 'text',
        input_text: sceneVoice,
        voice_id: avatar.voice_id,
        speed: 1.0,
      },
      background,
    })
  }

  const body = {
    video_inputs: videoInputs,
    dimension: { width: 720, height: 1280 },
    title: product.name,
  }

  const response = await axios.post(`${endpoint}/v2/video/generate`, body, {
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    timeout: 120000,
  })

  const videoId = response.data?.data?.video_id || response.data?.video_id
  if (!videoId) throw new Error('HeyGen did not return video_id')
  log('HeyGen video job created', { videoId, avatarScale: avatar.scale, scenes: videoInputs.length, hasProductImage: !!product.productImageUrl })
  return videoId
}

async function pollHeyGen(videoId: string): Promise<string> {
  const apiKey = process.env.HEYGEN_API_KEY
  const endpoint = process.env.HEYGEN_API_ENDPOINT || 'https://api.heygen.com'
  const timeoutMs = Number(process.env.HEYGEN_POLL_TIMEOUT_MS || 1500000)
  const intervalMs = Number(process.env.HEYGEN_POLL_INTERVAL_MS || 15000)
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const response = await axios.get(`${endpoint}/v1/video_status.get`, {
      headers: { 'X-Api-Key': apiKey },
      params: { video_id: videoId },
      timeout: 60000,
    })
    const data = response.data?.data || response.data
    const status = String(data?.status || '').toLowerCase()
    log('HeyGen status', { videoId, status })
    const url = data?.video_url || data?.videoUrl || data?.url
    if ((status.includes('complete') || status === 'success') && url) return url
    if (status.includes('fail') || status === 'error') throw new Error(`HeyGen failed: ${data?.error || data?.error_message || 'unknown error'}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error('HeyGen polling timed out')
}

function caption(product: Product, script: string): string {
  const tags = ['#NaturesWaySoil', '#SoilHealth', '#LawnCare', '#Gardening'].join(' ')
  return `${product.name}\n\n${product.description}\n\nShop direct: ${product.websiteUrl}\n\n${tags}`
}

function pickEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
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

  const products = loadProducts()
  if (!products.length) throw new Error('No products configured')
  const { product, variationIndex, variationCount } = pickProduct(products)
  const profile = productCreativeProfile(product)

  log('Scheduled product selected', { product: product.name, id: product.id, variation: `${variationIndex + 1}/${variationCount}` })
  log('Creative mapping selected', {
    avatar: profile.avatarId || process.env.HEYGEN_DEFAULT_AVATAR || 'default',
    voice: profile.voiceId || process.env.HEYGEN_DEFAULT_VOICE || 'default',
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

  const videoId = await createHeyGenVideo(product, scenePlan, profile)
  const videoUrl = await pollHeyGen(videoId)
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
