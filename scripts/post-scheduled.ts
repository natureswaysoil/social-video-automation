// @ts-nocheck
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import OpenAI from 'openai'
import { google } from 'googleapis'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import { createDidVideo, pollDidVideo } from './lib/did-provider'

type Product = {
  id: string
  name: string
  description: string
  category: string
  websiteUrl: string
  amazonUrl?: string
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
  didPresenterUrl?: string
  didVoiceId?: string
  avatarScale?: number
  avatarOffsetY?: number
  audience?: string
  angle?: string
  tone?: string
  cta?: string
  hooks?: string[]
  scenes?: CreativeScene[]
}

const ROOT = process.cwd()
const CONFIG_PATH = path.resolve(ROOT, 'config/top-products.json')
const STATE_PATH = path.resolve(ROOT, process.env.ROTATION_STATE_FILE || 'data/rotation-state.json')
const CREATIVE_PATH = path.resolve(ROOT, 'config/creative-profiles.json')
const DEFAULT_STATE: State = { cursor: -1, variationByProduct: {} }

const SECRET_NAMES = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'DID_API_KEY',
  'DiD',
  'DID_API_ENDPOINT',
  'DID_DEFAULT_PRESENTER_URL',
  'DID_DEFAULT_VOICE_ID',
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
  'INSTAGRAM_ACCOUNT_ID'
]

function log(message: string, data?: any) {
  if (data === undefined) console.log(message)
  else console.log(message, data)
}

function hasValue(name: string): boolean {
  const value = process.env[name]
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && !/your-|your_|changeme|placeholder|paste_|replace_|dummy_|example_/i.test(normalized)
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
        const [version] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${candidate}/versions/latest` })
        const value = version.payload?.data?.toString().trim()
        if (value) {
          process.env[secretName] = value
          process.env[candidate] = value
          if (secretName === 'DiD' || candidate === 'DiD') process.env.DID_API_KEY = value
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

function readJson(file: string, fallback: any) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: any) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function loadProducts(): Product[] {
  const raw = readJson(CONFIG_PATH, { topProducts: [] })
  return Array.isArray(raw.topProducts) ? raw.topProducts.slice(0, Number(process.env.SEED_PRODUCT_LIMIT || 20)) : []
}

function pickProduct(products: Product[]) {
  const state = readJson(STATE_PATH, { ...DEFAULT_STATE })
  const nextCursor = (Number(state.cursor || -1) + 1) % products.length
  const product = products[nextCursor]
  const variationCount = Number(process.env.VARIATIONS_PER_PRODUCT || 5)
  const lastVariation = state.variationByProduct?.[product.id]
  const variationIndex = typeof lastVariation === 'number' ? (lastVariation + 1) % variationCount : 0
  state.cursor = nextCursor
  state.variationByProduct = state.variationByProduct || {}
  state.variationByProduct[product.id] = variationIndex
  state.lastRunAt = new Date().toISOString()
  writeJson(STATE_PATH, state)
  return { product, variationIndex, variationCount }
}

function productCreativeProfile(product: Product): CreativeProfile {
  const creative = readJson(CREATIVE_PATH, { defaults: {}, profiles: {} })
  return { ...(creative.defaults || {}), ...((creative.profiles || {})[product.id] || {}) }
}

function fallbackScenes(product: Product, profile: CreativeProfile): CreativeScene[] {
  const base = product.brollQueries?.length ? product.brollQueries : [product.category]
  return [
    { name: 'Hook / Problem', seconds: 5, voiceover: `${profile.hooks?.[0] || 'Your lawn or soil problem may start below the surface.'}`, brollQuery: base[0] || product.category },
    { name: 'Product Hero', seconds: 5, voiceover: `${product.name} is designed to support healthier soil and stronger-looking growth.`, brollQuery: base[1] || product.name, useProductImage: true },
    { name: 'Application', seconds: 6, voiceover: 'Use it as part of your regular lawn, garden, pasture, or soil care routine according to label directions.', brollQuery: base[2] || 'spraying lawn' },
    { name: 'Soil Benefit', seconds: 6, voiceover: 'The goal is better soil support, root-zone activity, and nutrient availability.', brollQuery: base[3] || 'healthy soil close up' },
    { name: 'Result / CTA', seconds: 6, voiceover: profile.cta || `Shop Nature's Way Soil direct or on Amazon.`, brollQuery: base[4] || 'healthy green lawn' }
  ]
}

function parseJson(text: string): any {
  try { return JSON.parse(text) } catch {
    const match = String(text || '').match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}

async function generateScenePlan(product: Product, profile: CreativeProfile, variationIndex: number, variationCount: number): Promise<{ fullVoiceover: string, scenes: CreativeScene[] }> {
  const fallback = fallbackScenes(product, profile)
  if (!hasValue('OPENAI_API_KEY')) return { fullVoiceover: fallback.map(s => s.voiceover || '').join(' '), scenes: fallback }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const prompt = `Create a high-retention 25-35 second vertical product video script for Nature's Way Soil.
Product: ${product.name}
Description: ${product.description}
Category: ${product.category}
Website: ${product.amazonUrl || product.websiteUrl}
Variation: ${variationIndex + 1} of ${variationCount}
Audience: ${profile.audience || 'homeowners, gardeners, lawn care, land owners'}
Angle: ${profile.angle || 'soil-first product explanation'}
Tone: ${profile.tone || 'plainspoken and practical'}
Rules:
- Strong first 3 seconds.
- No guaranteed results.
- No pesticide, disease, or cure claims.
- Product should be mentioned early.
- End with a direct CTA.
- Return only JSON: {"fullVoiceover":"...","scenes":[{"name":"...","seconds":6,"voiceover":"...","brollQuery":"..."}]}
- Provide exactly 5 scenes.`
  const response = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 700 })
  const parsed = parseJson(response.choices[0]?.message?.content?.trim() || '')
  if (parsed?.scenes?.length) {
    const scenes = parsed.scenes.slice(0, 5).map((scene: any, index: number) => ({
      name: String(scene?.name || fallback[index]?.name || `scene-${index + 1}`),
      seconds: Number(scene?.seconds || fallback[index]?.seconds || 6),
      voiceover: String(scene?.voiceover || fallback[index]?.voiceover || '').trim(),
      brollQuery: String(scene?.brollQuery || fallback[index]?.brollQuery || product.category),
      useProductImage: index === 1 || index === 4
    }))
    return { fullVoiceover: String(parsed.fullVoiceover || scenes.map((s: CreativeScene) => s.voiceover || '').join(' ')), scenes }
  }
  return { fullVoiceover: fallback.map(s => s.voiceover || '').join(' '), scenes: fallback }
}

function caption(product: Product, script: string): string {
  const tags = ['#NaturesWaySoil', '#SoilHealth', '#LawnCare', '#Gardening'].join(' ')
  return `${product.name}\n\n${product.description}\n\nShop: ${product.amazonUrl || product.websiteUrl}\n\n${tags}`
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
  const upload = await youtube.videos.insert({ part: ['snippet', 'status'], requestBody: { snippet: { title: title.slice(0, 95), description, categoryId: '22' }, status: { privacyStatus: (process.env.YT_PRIVACY_STATUS as any) || 'public' } }, media: { body: media.data } })
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
  const container = await axios.post(`${baseUrl}/${igId}/media`, { media_type: process.env.IG_MEDIA_TYPE || 'REELS', video_url: videoUrl, caption: captionText }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 120000 })
  const creationId = container.data?.id
  if (!creationId) throw new Error('Instagram did not return creation id')
  for (let i = 0; i < 24; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10000))
    const status = await axios.get(`${baseUrl}/${creationId}?fields=status_code`, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000 })
    const code = status.data?.status_code
    log('Instagram media status', { creationId, code })
    if (code === 'FINISHED') break
    if (code === 'ERROR' || code === 'EXPIRED') throw new Error(`Instagram container ${code}`)
  }
  const published = await axios.post(`${baseUrl}/${igId}/media_publish`, { creation_id: creationId }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 120000 })
  const mediaId = published.data?.id || ''
  if (!mediaId) throw new Error('Instagram publish did not return media id')
  return mediaId
}

async function renderVideo(product: Product, scenePlan: any, profile: CreativeProfile): Promise<string> {
  const provider = String(process.env.VIDEO_PROVIDER || 'did').toLowerCase()
  if (provider !== 'did') throw new Error(`Unsupported VIDEO_PROVIDER "${provider}". This scheduler is D-ID first.`)
  const id = await createDidVideo(product, scenePlan, profile)
  return await pollDidVideo(id)
}

async function main() {
  process.env.VIDEO_PROVIDER = String(process.env.VIDEO_PROVIDER || 'did').toLowerCase()
  await loadSecrets()
  const products = loadProducts()
  if (!products.length) throw new Error('No products configured')
  const { product, variationIndex, variationCount } = pickProduct(products)
  const profile = productCreativeProfile(product)
  log('Scheduled product selected', { provider: process.env.VIDEO_PROVIDER, product: product.name, id: product.id, variation: `${variationIndex + 1}/${variationCount}` })
  log('Creative mapping selected', { didPresenterUrl: profile.didPresenterUrl || process.env.DID_DEFAULT_PRESENTER_URL || 'default', didVoiceId: profile.didVoiceId || process.env.DID_DEFAULT_VOICE_ID || 'default', hasScenePlan: !!profile.scenes?.length, hasProductImage: !!product.productImageUrl })
  const scenePlan = await generateScenePlan(product, profile, variationIndex, variationCount)
  log('Generated scene plan', { fullVoiceoverLength: scenePlan.fullVoiceover.length, scenes: scenePlan.scenes.map((scene: CreativeScene, index: number) => ({ idx: index + 1, name: scene.name, seconds: scene.seconds, useProductImage: !!scene.useProductImage })) })
  const captionText = caption(product, scenePlan.fullVoiceover)
  const platforms = (process.env.ENABLE_PLATFORMS || 'youtube,instagram').toLowerCase().split(',').map((p) => p.trim()).filter(Boolean)
  if (String(process.env.DRY_RUN_LOG_ONLY || '').toLowerCase() === 'true') {
    log('Dry run enabled; skipping D-ID render and social posting', { provider: process.env.VIDEO_PROVIDER, platforms, caption: captionText, voiceover: scenePlan.fullVoiceover })
    return
  }
  const videoUrl = await renderVideo(product, scenePlan, profile)
  log('Finished D-ID video URL', { videoUrl })
  let posted = 0
  if (platforms.includes('youtube')) {
    try { const id = await postToYouTube(videoUrl, product.name, captionText); posted++; log('Posted to YouTube', { id }) } catch (error: any) { log('YouTube post failed', error?.message || error) }
  }
  if (platforms.includes('instagram')) {
    try { const id = await postToInstagram(videoUrl, captionText); posted++; log('Posted to Instagram', { id }) } catch (error: any) { log('Instagram post failed', error?.message || error) }
  }
  if (posted === 0) throw new Error('No platform posts succeeded')
  log('Scheduled post completed', { posted })
}

main().catch((error) => { console.error('Scheduled post failed:', error?.message || error); process.exit(1) })
