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
}

type State = {
  cursor: number
  variationByProduct: Record<string, number>
  lastRunAt?: string
}

const ROOT = process.cwd()
const CONFIG_PATH = path.resolve(ROOT, 'config/top-products.json')
const STATE_PATH = path.resolve(ROOT, process.env.ROTATION_STATE_FILE || 'data/rotation-state.json')
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

function assertRequiredSecrets() {
  const required = ['OPENAI_API_KEY', 'HEYGEN_API_KEY', 'PEXELS_API_KEY']
  const missing = required.filter((name) => !hasValue(name))
  if (missing.length === 0) return

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'unknown'
  throw new Error(
    `Missing required secrets after secret loading: ${missing.join(', ')}. ` +
    `Verify these secrets exist and are accessible in Google Secret Manager for project ${projectId}.`,
  )
}

function loadProducts(): Product[] {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const products = Array.isArray(raw.topProducts) ? raw.topProducts : []
  return products.slice(0, Number(process.env.SEED_PRODUCT_LIMIT || 5))
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

async function generateScript(product: Product, variationIndex: number, variationCount: number): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const angles = [
    'quick win for busy homeowners',
    'fix a frustrating recurring lawn issue',
    'pet-owner friendly yard recovery focus',
    'seasonal lawn prep and prevention',
    'save time versus trial-and-error methods',
    'beginner-friendly, simple next-step guidance',
  ]
  const angle = angles[variationIndex % angles.length]

  const prompt = `You are writing a high-converting short-form product sales voiceover for Nature's Way Soil.

Product context:
- Product: ${product.name}
- Description: ${product.description}
- Category: ${product.category}
- Website: ${product.websiteUrl}
- Variation: ${variationIndex + 1} of ${variationCount}
- Sales angle: ${angle}

Goal:
- Drive qualified clicks and purchases while staying truthful and compliant.

Required structure (speak naturally, no section labels):
- 0-3s: Pattern-interrupt hook tied to a painful problem.
- 3-10s: Call out who this is for and why common fixes fail.
- 10-22s: Explain how this product helps in practical, plain language.
- 22-30s: Add credibility signal (experience, consistency, routine, or practical proof-style language without fabricating stats/testimonials).
- 30-35s: Clear action CTA to visit the website now.

Hard rules:
- 25-35 seconds spoken length.
- No guarantees, no disease/pesticide cure claims, no instant-fix claims.
- No hype words like "miracle", "magic", or "secret formula".
- No hashtags, emojis, bullets, or stage directions.
- Keep it specific, concrete, and easy to understand.
- Return only the final spoken voiceover text.`

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.65,
    max_tokens: 260,
  })

  const draft = response.choices[0]?.message?.content?.trim() || ''
  if (!draft) return product.description

  const polishPrompt = `Polish this voiceover for clarity and conversion while keeping it compliant.

Requirements:
- Keep meaning and compliance intact.
- Keep 25-35 second spoken length.
- Improve hook strength, specificity, and CTA clarity.
- Remove fluff and repetition.
- Output only the revised spoken voiceover.

Draft:
${draft}`

  const polishedResponse = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: polishPrompt }],
    temperature: 0.35,
    max_tokens: 260,
  })

  return polishedResponse.choices[0]?.message?.content?.trim() || draft || product.description
}

async function findPexelsVideo(product: Product): Promise<string> {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) return ''
  const queries = product.brollQueries?.length ? product.brollQueries : [product.category, product.name]
  const query = queries[Math.floor(Date.now() / 3600000) % queries.length]
  const response = await axios.get('https://api.pexels.com/videos/search', {
    headers: { Authorization: apiKey },
    params: { query, orientation: 'portrait', per_page: 5 },
    timeout: 30000,
  })
  const video = response.data?.videos?.[0]
  const files = video?.video_files || []

  const qualityScore = (quality: string): number => {
    const q = String(quality || '').toLowerCase()
    if (q.includes('uhd') || q.includes('4k')) return 4
    if (q.includes('hd') || q.includes('full')) return 3
    if (q.includes('sd')) return 1
    return 2
  }

  const area = (file: any): number => Number(file.width || 0) * Number(file.height || 0)
  const portraitFiles = files.filter((file: any) => Number(file.height || 0) > Number(file.width || 0))
  const candidates = portraitFiles.length ? portraitFiles : files

  const best = [...candidates].sort((a: any, b: any) => {
    const scoreA = qualityScore(a.quality) * 100000000 + area(a)
    const scoreB = qualityScore(b.quality) * 100000000 + area(b)
    return scoreB - scoreA
  })[0]

  const url = best?.link || ''
  log('Selected Pexels b-roll', {
    query,
    videoId: video?.id,
    quality: best?.quality || 'unknown',
    width: best?.width || 0,
    height: best?.height || 0,
    url: url ? 'selected' : 'none',
  })
  return url
}

function avatarSettings(product: Product) {
  const hay = /hay|pasture|forage|cattle|field/i.test(`${product.name} ${product.category}`)
  const dog = /dog|urine|yellow|pet/i.test(`${product.name} ${product.category}`)
  const scale = Number(process.env.HEYGEN_AVATAR_SCALE || (hay ? 0.44 : dog ? 0.47 : 0.5))
  const offsetY = Number(process.env.HEYGEN_AVATAR_OFFSET_Y || (hay ? 0.14 : 0.1))
  return {
    avatar_id: process.env.HEYGEN_DEFAULT_AVATAR || 'Daisy-inskirt-20220818',
    voice_id: process.env.HEYGEN_DEFAULT_VOICE || '2d5b0e6cf36f460aa7fc47e3eee4ba54',
    scale,
    offsetY,
  }
}

async function createHeyGenVideo(product: Product, script: string, brollUrl: string): Promise<string> {
  const apiKey = process.env.HEYGEN_API_KEY
  if (!apiKey) throw new Error('Missing HEYGEN_API_KEY')
  const endpoint = process.env.HEYGEN_API_ENDPOINT || 'https://api.heygen.com'
  const avatar = avatarSettings(product)

  const background = brollUrl
    ? { type: 'video', url: brollUrl, play_style: 'fit_to_scene' }
    : { type: 'color', value: '#0a3d0a' }

  const body = {
    video_inputs: [
      {
        character: {
          type: 'avatar',
          avatar_id: avatar.avatar_id,
          avatar_style: 'normal',
          scale: avatar.scale,
          offset: { x: 0, y: avatar.offsetY },
        },
        voice: {
          type: 'text',
          input_text: script,
          voice_id: avatar.voice_id,
          speed: 1.0,
        },
        background,
      },
    ],
    dimension: { width: 720, height: 1280 },
    title: product.name,
  }

  const response = await axios.post(`${endpoint}/v2/video/generate`, body, {
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    timeout: 120000,
  })

  const videoId = response.data?.data?.video_id || response.data?.video_id
  if (!videoId) throw new Error('HeyGen did not return video_id')
  log('HeyGen video job created', { videoId, avatarScale: avatar.scale })
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
  assertRequiredSecrets()

  const products = loadProducts()
  if (!products.length) throw new Error('No products configured')
  const { product, variationIndex, variationCount } = pickProduct(products)

  log('Scheduled product selected', { product: product.name, id: product.id, variation: `${variationIndex + 1}/${variationCount}` })

  const script = await generateScript(product, variationIndex, variationCount)
  log('Generated script', {
    length: script.length,
    preview: script.replace(/\s+/g, ' ').trim().slice(0, 240),
  })

  const brollUrl = await findPexelsVideo(product)
  const videoId = await createHeyGenVideo(product, script, brollUrl)
  const videoUrl = await pollHeyGen(videoId)
  log('Finished video URL', { videoUrl })

  const captionText = caption(product, script)
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
