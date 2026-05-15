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
const CREATIVE_PATH = path.resolve(ROOT, 'config/creative-profiles.json')
const FACEBOOK_GROUPS_PATH = path.resolve(ROOT, 'config/facebook-groups.json')
const STATE_PATH = path.resolve(ROOT, process.env.ROTATION_STATE_FILE || 'data/rotation-state.json')
const DEFAULT_STATE: State = { cursor: -1, variationByProduct: {} }
const DEFAULT_FIRST_PRODUCT_ID = process.env.NEXT_PRODUCT_PREFERRED_ID || 'NWS_021'

const SECRET_NAMES = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'HEYGEN_API_KEY',
  'HEYGEN_API_ENDPOINT',
  'HEYGEN_DEFAULT_AVATAR',
  'HEYGEN_DEFAULT_VOICE',
  'HEYGEN_AVATAR_SCALE',
  'HEYGEN_AVATAR_OFFSET_Y',
  'HEYGEN_AVATAR_DOG_OWNER',
  'HEYGEN_AVATAR_GARDENER',
  'HEYGEN_AVATAR_FARMER',
  'HEYGEN_AVATAR_HOMEOWNER',
  'HEYGEN_AVATAR_SCALE_DOG_OWNER',
  'HEYGEN_AVATAR_SCALE_GARDENER',
  'HEYGEN_AVATAR_SCALE_FARMER',
  'HEYGEN_AVATAR_SCALE_HOMEOWNER',
  'HEYGEN_AVATAR_OFFSET_Y_DOG_OWNER',
  'HEYGEN_AVATAR_OFFSET_Y_GARDENER',
  'HEYGEN_AVATAR_OFFSET_Y_FARMER',
  'HEYGEN_AVATAR_OFFSET_Y_HOMEOWNER',
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
  'FB_PAGE_ACCESS_TOKEN',
  'FB_PAGE_ID',
  'FB_GROUP_ACCESS_TOKEN',
  'FB_GROUP_IDS',
  'FACEBOOK_PAGE_ACCESS_TOKEN',
  'FACEBOOK_PAGE_ID',
  'FACEBOOK_GROUP_ACCESS_TOKEN',
  'FACEBOOK_GROUP_IDS',
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

function parseIdList(value?: string): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

type GeneratedScript = {
  fullVoiceover: string
  sceneVoiceovers: string[]
}

type FacebookGroupRoute = {
  label: string
  groupId?: string
  groupHandle?: string
  topics?: string[]
}

function loadProducts(): Product[] {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const products = Array.isArray(raw.topProducts) ? raw.topProducts : []
  return products.slice(0, Number(process.env.SEED_PRODUCT_LIMIT || 5))
}

function loadCreativeProfiles() {
  try {
    if (!fs.existsSync(CREATIVE_PATH)) return { defaults: {}, profiles: {} }
    return JSON.parse(fs.readFileSync(CREATIVE_PATH, 'utf8'))
  } catch {
    return { defaults: {}, profiles: {} }
  }
}

function loadFacebookGroupAllowlist(): Set<string> {
  try {
    if (!fs.existsSync(FACEBOOK_GROUPS_PATH)) return new Set()
    const parsed = JSON.parse(fs.readFileSync(FACEBOOK_GROUPS_PATH, 'utf8'))
    const ids = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.allowedGroupIds)
        ? parsed.allowedGroupIds
        : []
    return new Set(ids.map((id: any) => String(id).trim()).filter(Boolean))
  } catch {
    return new Set()
  }
}

function loadFacebookGroupRoutes(): FacebookGroupRoute[] {
  try {
    if (!fs.existsSync(FACEBOOK_GROUPS_PATH)) return []
    const parsed = JSON.parse(fs.readFileSync(FACEBOOK_GROUPS_PATH, 'utf8'))
    if (Array.isArray(parsed?.routes)) return parsed.routes
    return []
  } catch {
    return []
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
  if ((state.cursor < 0 || !products[state.cursor]) && DEFAULT_FIRST_PRODUCT_ID) {
    const preferredIndex = products.findIndex((product) => product.id === DEFAULT_FIRST_PRODUCT_ID)
    if (preferredIndex >= 0) {
      const product = products[preferredIndex]
      const variationCount = Number(process.env.VARIATIONS_PER_PRODUCT || 5)
      const lastVariation = state.variationByProduct[product.id]
      const variationIndex = typeof lastVariation === 'number' ? (lastVariation + 1) % variationCount : 0

      state.cursor = preferredIndex
      state.variationByProduct[product.id] = variationIndex
      state.lastRunAt = new Date().toISOString()
      writeState(state)

      return { product, variationIndex, variationCount }
    }
  }
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

async function generateScript(product: Product, variationIndex: number, variationCount: number): Promise<GeneratedScript> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const minWords = Number(process.env.SCRIPT_MIN_WORDS || 48)
  const maxWords = Number(process.env.SCRIPT_MAX_WORDS || 68)
  const sceneCount = Math.max(1, Number(process.env.HEYGEN_SCENE_COUNT || 4))
  const countWords = (text: string): number =>
    (text || '').trim().split(/\s+/).filter(Boolean).length
  const scenePlan = [
    {
      scene: 'Scene 1',
      job: 'Hook',
      instruction: 'Open on the exact problem in the soil, lawn, or garden that the viewer wants fixed.',
    },
    {
      scene: 'Scene 2',
      job: 'Body',
      instruction: 'Explain the simple action, product use, or feeding step in a clear, practical way.',
    },
    {
      scene: 'Scene 3',
      job: 'Body',
      instruction: 'Show the growth, recovery, or healthier-looking result the viewer is trying to get.',
    },
    {
      scene: 'Scene 4',
      job: 'CTA',
      instruction: 'Close with a direct, urgent call to visit the website and shop now.',
    },
  ]
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
- Sound like a direct-response ad, not a brochure.
- Make the listener feel a specific problem, then a clear fix, then a reason to act now.

Required structure (speak naturally, no section labels):
- 0-3s: Pattern-interrupt hook tied to a painful problem.
- 3-10s: Call out who this is for and why common fixes fail.
- 10-22s: Explain how this product helps in practical, plain language.
- 22-30s: Add credibility signal (experience, consistency, routine, or practical proof-style language without fabricating stats/testimonials).
- 30-35s: Clear action CTA to visit the website now.

Scene plan to match while writing:
${scenePlan.map((item) => `- ${item.scene} (${item.job}): ${item.instruction}`).join('\n')}

Hard rules:
- 25-35 seconds spoken length.
- Target ${minWords}-${maxWords} words.
- Keep the CTA direct and urgent, like "visit now" or "shop the product that fits your issue." 
- No guarantees, no disease/pesticide cure claims, no instant-fix claims.
- No hype words like "miracle", "magic", or "secret formula".
- No hashtags, emojis, bullets, or stage directions.
- Keep it specific, concrete, and easy to understand.
- Return only JSON with this shape:
{"fullVoiceover":"...","scenes":[{"name":"Scene 1","voiceover":"..."},{"name":"Scene 2","voiceover":"..."},{"name":"Scene 3","voiceover":"..."},{"name":"Scene 4","voiceover":"..."}]}
- The four scene voiceovers should be distinct and map to the scene plan above.
- Keep each scene voiceover roughly balanced so the full script lands between ${minWords} and ${maxWords} words.`

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.65,
    max_tokens: 260,
  })

  const draft = response.choices[0]?.message?.content?.trim() || ''
  if (!draft) {
    const fallbackScenes = fallbackScenesForScript(product, sceneCount)
    return { fullVoiceover: fallbackScenes.map((scene) => scene.voiceover).join(' '), sceneVoiceovers: fallbackScenes.map((scene) => scene.voiceover) }
  }

  const polishedDraft = parseJson(draft)
  const draftFullVoiceover = typeof polishedDraft?.fullVoiceover === 'string' ? polishedDraft.fullVoiceover.trim() : ''
  const draftScenes = Array.isArray(polishedDraft?.scenes)
    ? polishedDraft.scenes
        .map((scene: any) => String(scene?.voiceover || '').trim())
        .filter(Boolean)
    : []

  const polishPrompt = `Polish this voiceover for clarity and conversion while keeping it compliant.

Requirements:
- Keep meaning and compliance intact.
- Keep 25-35 second spoken length.
- Keep the final script between ${minWords} and ${maxWords} words.
- Improve hook strength, specificity, and CTA clarity.
- Remove fluff and repetition.
- Output only the revised spoken voiceover.

Draft:
${draftFullVoiceover || draft}`

  const polishedResponse = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: polishPrompt }],
    temperature: 0.35,
    max_tokens: 260,
  })
  const polished = polishedResponse.choices[0]?.message?.content?.trim() || draftFullVoiceover || draft
  const polishedWordCount = countWords(polished)
  if (polishedWordCount >= minWords && polishedWordCount <= maxWords) {
    return {
      fullVoiceover: polished || product.description,
      sceneVoiceovers: draftScenes.length === sceneCount ? draftScenes : splitScriptIntoScenes(polished || product.description, sceneCount),
    }
  }

  const compressPrompt = `Rewrite the voiceover to ${minWords}-${maxWords} words while preserving the same offer, compliance, and CTA.

Rules:
- Stay natural and conversational.
- Keep one clear hook, one clear mechanism, one clear CTA.
- No exaggerated or prohibited claims.
- Output only the final voiceover text.

Voiceover:
${polished}`

  const compressedResponse = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: compressPrompt }],
    temperature: 0.25,
    max_tokens: 220,
  })

  const compressed = compressedResponse.choices[0]?.message?.content?.trim() || polished
  const sceneVoiceovers = draftScenes.length === sceneCount ? draftScenes : splitScriptIntoScenes(compressed || draftFullVoiceover || draft || product.description, sceneCount)
  return {
    fullVoiceover: compressed || draftFullVoiceover || draft || product.description,
    sceneVoiceovers,
  }
}

function fallbackScenesForScript(product: Product, sceneCount: number) {
  const scenes = fallbackScenes(product, { scenes: [], hooks: [], cta: '' } as any)
  return scenes.slice(0, Math.max(1, sceneCount)).map((scene, index) => ({
    ...scene,
    voiceover: scene.voiceover || `${product.name} helps support healthier soil and a better-looking result.`,
  }))
}

async function findPexelsVideo(product: Product): Promise<string> {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) return ''
  const queries = product.brollQueries?.length ? product.brollQueries : [product.category, product.name]
  const query = queries[Math.floor(Date.now() / 3600000) % queries.length]
  const response = await axios.get('https://api.pexels.com/videos/search', {
    headers: { Authorization: apiKey },
    params: { query, orientation: 'portrait', per_page: 10 },
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

function sceneBrollQueries(product: Product): string[] {
  const name = `${product.name} ${product.category} ${product.description}`.toLowerCase()
  const base = [
    ...(product.brollQueries || []),
    ...(product.keywords || []),
    product.category,
    product.name,
  ]

  const themeQueries = /dog|urine|pet/.test(name)
    ? [
        'watering lawn with hose',
        'green grass roots close up',
        'healthy lawn soil close up',
        'garden hose watering grass',
        'lawn care soil amendment',
        'lush backyard lawn close up',
      ]
    : /compost|biochar|worm|living/.test(name)
      ? [
          'hands mixing compost and soil',
          'rich compost soil close up',
          'raised bed vegetable garden',
          'mulching garden bed',
          'seedlings in rich soil',
          'gardening hands soil close up',
        ]
      : /pasture|hay|field/.test(name)
        ? [
            'green pasture grass close up',
            'farm field watering grass',
            'healthy field soil close up',
            'cattle grazing pasture',
            'lush grass field sunrise',
            'hands checking soil in field',
          ]
        : [
            'healthy soil close up',
            'watering vegetable garden',
            'garden soil being prepared',
            'mulching flower bed',
            'seedlings in garden bed',
            'hands working in soil',
          ]

  const queries = [...themeQueries, ...base].map((query) => String(query).trim()).filter(Boolean)
  return [...new Set(queries)]
}

type SceneTheme = {
  label: string
  scriptGoal: string
  queryHints: string[]
}

function sceneThemes(product: Product): SceneTheme[] {
  const name = `${product.name} ${product.category} ${product.description}`.toLowerCase()

  const soilTheme: SceneTheme = {
    label: 'soil close-up',
    scriptGoal: 'Show the soil problem and make the viewer feel the pain immediately.',
    queryHints: [
      'healthy soil close up',
      'rich compost soil close up',
      'soil texture macro',
      'garden soil being prepared',
      'hands working in soil',
    ],
  }

  const wateringTheme: SceneTheme = {
    label: 'watering and gardening',
    scriptGoal: 'Show simple action and care with watering, feeding, or garden maintenance.',
    queryHints: [
      'watering vegetable garden',
      'watering lawn with hose',
      'garden hose watering grass',
      'mulching garden bed',
      'gardening hands soil close up',
    ],
  }

  const growthTheme: SceneTheme = {
    label: 'plant and lawn growth',
    scriptGoal: 'Show the healthy-looking result or the kind of growth the product supports.',
    queryHints: [
      'seedlings in rich soil',
      'green grass roots close up',
      'lush backyard lawn close up',
      'raised bed vegetable garden',
      'healthy lawn roots close up',
    ],
  }

  const ctaTheme: SceneTheme = {
    label: 'final CTA shot',
    scriptGoal: 'Close with a direct call to action and a clean product-forward finish.',
    queryHints: [
      'product on garden table',
      'hands holding garden product',
      'lawn care product close up',
      'gardener looking at lawn',
      'healthy garden close up',
    ],
  }

  const specific: SceneTheme[] = /dog|urine|pet/.test(name)
    ? [
        soilTheme,
        {
          ...wateringTheme,
          queryHints: ['watering lawn with hose', 'garden hose watering grass', 'green grass roots close up', 'healthy lawn soil close up'],
        },
        {
          ...growthTheme,
          queryHints: ['lush backyard lawn close up', 'healthy lawn roots close up', 'green grass close up', 'lawn after watering'],
        },
        ctaTheme,
      ]
    : /compost|biochar|worm|living/.test(name)
      ? [
          {
            ...soilTheme,
            queryHints: ['hands mixing compost and soil', 'rich compost soil close up', 'worm castings compost', 'garden soil being prepared'],
          },
          wateringTheme,
          {
            ...growthTheme,
            queryHints: ['raised bed vegetable garden', 'seedlings in rich soil', 'plant roots in rich soil', 'healthy garden bed'],
          },
          ctaTheme,
        ]
      : /pasture|hay|field/.test(name)
        ? [
            {
              ...soilTheme,
              queryHints: ['healthy field soil close up', 'farm field soil close up', 'hands checking soil in field', 'green pasture soil close up'],
            },
            {
              ...wateringTheme,
              queryHints: ['farm field watering grass', 'watering pasture field', 'green pasture grass close up', 'lawn irrigation field'],
            },
            {
              ...growthTheme,
              queryHints: ['green pasture grass close up', 'lush grass field sunrise', 'cattle grazing pasture', 'healthy pasture field'],
            },
            ctaTheme,
          ]
        : [soilTheme, wateringTheme, growthTheme, ctaTheme]

  return specific
}

function avatarTheme(product: Product): 'dog-owner' | 'gardener' | 'farmer' | 'homeowner' {
  const name = `${product.name} ${product.category} ${product.description}`.toLowerCase()
  if (/dog|urine|pet/.test(name)) return 'dog-owner'
  if (/pasture|hay|field|farm/.test(name)) return 'farmer'
  if (/compost|biochar|worm|living|soil|garden|humic|seaweed/.test(name)) return 'gardener'
  return 'homeowner'
}

function educationTopicForProduct(product: Product): 'pasture' | 'garden' | 'lawn' {
  const name = `${product.name} ${product.category} ${product.description}`.toLowerCase()
  if (/pasture|hay|field|farm|cattle|goat|forage|bermuda grass pasture/.test(name)) return 'pasture'
  if (/compost|biochar|worm|raised bed|vegetable|fruit tree|homestead|organic/.test(name)) return 'garden'
  return 'lawn'
}

function resolveFacebookGroupRoutes(product: Product): FacebookGroupRoute[] {
  const topic = educationTopicForProduct(product)
  const routes = loadFacebookGroupRoutes()
  if (!routes.length) return []

  return routes.filter((route) => {
    const topics = (route.topics || []).map((value) => String(value).toLowerCase())
    return topics.length === 0 || topics.includes(topic)
  })
}

function avatarProfile(product: Product) {
  const creativeProfiles = loadCreativeProfiles()
  const creative = {
    ...(creativeProfiles.defaults || {}),
    ...((creativeProfiles.profiles || {})[product.id] || {}),
  }

  const theme = avatarTheme(product)
  const profiles = {
    'dog-owner': {
      avatarId: process.env.HEYGEN_AVATAR_DOG_OWNER || creative.avatarId || process.env.HEYGEN_DEFAULT_AVATAR,
      voiceId: process.env.HEYGEN_VOICE_DOG_OWNER || creative.voiceId || process.env.HEYGEN_DEFAULT_VOICE,
      scale: Number(process.env.HEYGEN_AVATAR_SCALE_DOG_OWNER || creative.avatarScale || process.env.HEYGEN_AVATAR_SCALE || 0.47),
      offsetY: Number(process.env.HEYGEN_AVATAR_OFFSET_Y_DOG_OWNER || creative.avatarOffsetY || process.env.HEYGEN_AVATAR_OFFSET_Y || 0.1),
    },
    gardener: {
      avatarId: process.env.HEYGEN_AVATAR_GARDENER || creative.avatarId || process.env.HEYGEN_DEFAULT_AVATAR,
      voiceId: process.env.HEYGEN_VOICE_GARDENER || creative.voiceId || process.env.HEYGEN_DEFAULT_VOICE,
      scale: Number(process.env.HEYGEN_AVATAR_SCALE_GARDENER || creative.avatarScale || process.env.HEYGEN_AVATAR_SCALE || 0.45),
      offsetY: Number(process.env.HEYGEN_AVATAR_OFFSET_Y_GARDENER || creative.avatarOffsetY || process.env.HEYGEN_AVATAR_OFFSET_Y || 0.12),
    },
    farmer: {
      avatarId: process.env.HEYGEN_AVATAR_FARMER || creative.avatarId || process.env.HEYGEN_DEFAULT_AVATAR,
      voiceId: process.env.HEYGEN_VOICE_FARMER || creative.voiceId || process.env.HEYGEN_DEFAULT_VOICE,
      scale: Number(process.env.HEYGEN_AVATAR_SCALE_FARMER || creative.avatarScale || process.env.HEYGEN_AVATAR_SCALE || 0.46),
      offsetY: Number(process.env.HEYGEN_AVATAR_OFFSET_Y_FARMER || creative.avatarOffsetY || process.env.HEYGEN_AVATAR_OFFSET_Y || 0.12),
    },
    homeowner: {
      avatarId: process.env.HEYGEN_AVATAR_HOMEOWNER || creative.avatarId || process.env.HEYGEN_DEFAULT_AVATAR,
      voiceId: process.env.HEYGEN_VOICE_HOMEOWNER || creative.voiceId || process.env.HEYGEN_DEFAULT_VOICE,
      scale: Number(process.env.HEYGEN_AVATAR_SCALE_HOMEOWNER || creative.avatarScale || process.env.HEYGEN_AVATAR_SCALE || 0.48),
      offsetY: Number(process.env.HEYGEN_AVATAR_OFFSET_Y_HOMEOWNER || creative.avatarOffsetY || process.env.HEYGEN_AVATAR_OFFSET_Y || 0.1),
    },
  } as const

  const profile = profiles[theme]
  return {
    theme,
    avatar_id: profile.avatarId || 'Daisy-inskirt-20220818',
    voice_id: profile.voiceId || '2d5b0e6cf36f460aa7fc47e3eee4ba54',
    scale: profile.scale,
    offsetY: profile.offsetY,
  }
}

function splitScriptIntoScenes(script: string, sceneCount: number): string[] {
  const text = (script || '').trim()
  if (!text) return ['']

  const normalizedSceneCount = Math.max(1, sceneCount)
  if (normalizedSceneCount === 1) return [text]

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (sentences.length <= 1) return [text]

  const chunks: string[] = Array.from({ length: normalizedSceneCount }, () => '')
  const wordsByChunk: number[] = Array.from({ length: normalizedSceneCount }, () => 0)

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean).length
    let targetIndex = 0
    for (let i = 1; i < wordsByChunk.length; i++) {
      if (wordsByChunk[i] < wordsByChunk[targetIndex]) targetIndex = i
    }

    chunks[targetIndex] = chunks[targetIndex] ? `${chunks[targetIndex]} ${sentence}` : sentence
    wordsByChunk[targetIndex] += words
  }

  const nonEmpty = chunks.map((s) => s.trim()).filter(Boolean)
  return nonEmpty.length ? nonEmpty : [text]
}

function normalizeSceneVoiceovers(sceneVoiceovers: string[], sceneCount: number, fallbackScript: string): string[] {
  const normalizedSceneCount = Math.max(1, sceneCount)
  const trimmed = sceneVoiceovers.map((scene) => String(scene || '').trim()).filter(Boolean)
  const base = trimmed.length >= normalizedSceneCount
    ? trimmed.slice(0, normalizedSceneCount)
    : splitScriptIntoScenes(fallbackScript, normalizedSceneCount)

  if (!base.length) return [fallbackScript || '']

  while (base.length < normalizedSceneCount) {
    base.push(base[base.length - 1])
  }

  return base.slice(0, normalizedSceneCount)
}

async function findPexelsVideos(product: Product, sceneCount: number): Promise<string[]> {
  const themes = sceneThemes(product)
  const count = Math.max(1, sceneCount)
  const urls: string[] = []

  for (let i = 0; i < count; i++) {
    const theme = themes[i] || themes[themes.length - 1]
    const queries = [...theme.queryHints, ...sceneBrollQueries(product)]
    const query = queries[i % queries.length] || product.category || product.name
    const tempProduct: Product = { ...product, brollQueries: [query] }
    const url = await findPexelsVideo(tempProduct)
    if (url) urls.push(url)
  }

  return urls
}

function avatarSettings(product: Product) {
  const profile = avatarProfile(product)
  return {
    avatar_id: profile.avatar_id,
    voice_id: profile.voice_id,
    scale: profile.scale,
    offsetY: profile.offsetY,
    theme: profile.theme,
  }
}

async function createHeyGenVideo(product: Product, sceneVoiceovers: string[], brollUrls: string[]): Promise<string> {
  const apiKey = process.env.HEYGEN_API_KEY
  if (!apiKey) throw new Error('Missing HEYGEN_API_KEY')
  const endpoint = process.env.HEYGEN_API_ENDPOINT || 'https://api.heygen.com'
  const avatar = avatarSettings(product)

  const sceneCount = Math.max(1, Number(process.env.HEYGEN_SCENE_COUNT || 4))
  const fallbackScript = sceneVoiceovers.join(' ').trim()
  const scriptScenes = normalizeSceneVoiceovers(sceneVoiceovers, sceneCount, fallbackScript)
  const sceneBackgrounds = scriptScenes.map((_, index) => brollUrls[index] || brollUrls[0] || '')

  const videoInputs = scriptScenes.map((sceneScript, index) => {
    const background = sceneBackgrounds[index]
      ? { type: 'video', url: sceneBackgrounds[index], play_style: 'fit_to_scene' }
      : { type: 'color', value: '#0a3d0a' }

    return {
      character: {
        type: 'avatar',
        avatar_id: avatar.avatar_id,
        avatar_style: 'normal',
        scale: avatar.scale,
        offset: { x: 0, y: avatar.offsetY },
      },
      voice: {
        type: 'text',
        input_text: sceneScript,
        voice_id: avatar.voice_id,
        speed: 1.0,
      },
      background,
    }
  })

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
  log('HeyGen video job created', { videoId, avatarScale: avatar.scale, avatarTheme: avatar.theme, scenes: videoInputs.length })
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

async function postToFacebook(videoUrl: string, title: string, captionText: string): Promise<string> {
  const pageAccessToken = pickEnv(['FB_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN'])
  const pageId = pickEnv(['FB_PAGE_ID', 'FACEBOOK_PAGE_ID'])
  if (!pageAccessToken || !pageId) throw new Error('Missing Facebook Page access token or Page ID')

  const apiVersion = process.env.FACEBOOK_API_VERSION || 'v20.0'
  const host = process.env.FACEBOOK_API_HOST || 'graph.facebook.com'
  const baseUrl = `https://${host}/${apiVersion}`

  const body = new URLSearchParams({
    access_token: pageAccessToken,
    file_url: videoUrl,
    title: title.slice(0, 95),
    description: captionText,
    published: 'true',
  })

  const response = await axios.post(`${baseUrl}/${pageId}/videos`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 180000,
  })

  const postId = response.data?.id || ''
  if (!postId) throw new Error('Facebook video publish did not return id')
  return postId
}

async function postToFacebookGroup(videoUrl: string, title: string, captionText: string, groupId: string): Promise<string> {
  const allowedGroupIds = loadFacebookGroupAllowlist()
  if (allowedGroupIds.size === 0) throw new Error('No Facebook group allowlist configured')
  if (!allowedGroupIds.has(groupId)) throw new Error(`Facebook group ${groupId} is not in the allowlist`)

  const groupAccessToken = pickEnv(['FB_GROUP_ACCESS_TOKEN', 'FACEBOOK_GROUP_ACCESS_TOKEN', 'FB_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN'])
  if (!groupAccessToken) throw new Error('Missing Facebook group access token')

  const apiVersion = process.env.FACEBOOK_API_VERSION || 'v20.0'
  const host = process.env.FACEBOOK_API_HOST || 'graph.facebook.com'
  const baseUrl = `https://${host}/${apiVersion}`

  const body = new URLSearchParams({
    access_token: groupAccessToken,
    file_url: videoUrl,
    title: title.slice(0, 95),
    description: captionText,
    published: 'true',
  })

  const response = await axios.post(`${baseUrl}/${groupId}/videos`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 180000,
  })

  const postId = response.data?.id || ''
  if (!postId) throw new Error(`Facebook group ${groupId} publish did not return id`)
  return postId
}

async function main() {
  await loadSecrets()
  assertRequiredSecrets()

  const products = loadProducts()
  if (!products.length) throw new Error('No products configured')
  const { product, variationIndex, variationCount } = pickProduct(products)

  log('Scheduled product selected', { product: product.name, id: product.id, variation: `${variationIndex + 1}/${variationCount}` })

  const scriptBundle = await generateScript(product, variationIndex, variationCount)
  const script = scriptBundle.fullVoiceover
  const scriptWordCount = script.trim().split(/\s+/).filter(Boolean).length
  log('Generated script', {
    length: script.length,
    words: scriptWordCount,
    preview: script.replace(/\s+/g, ' ').trim().slice(0, 240),
  })

  const sceneCount = Math.max(1, Number(process.env.HEYGEN_SCENE_COUNT || 4))
  const brollUrls = await findPexelsVideos(product, sceneCount)
  log('Selected b-roll scenes', {
    requestedScenes: sceneCount,
    selected: brollUrls.length,
    themes: sceneThemes(product).slice(0, sceneCount).map((theme) => theme.label),
  })
  const videoId = await createHeyGenVideo(product, scriptBundle.sceneVoiceovers, brollUrls)
  const videoUrl = await pollHeyGen(videoId)
  log('Finished video URL', { videoUrl })

  const captionText = caption(product, script)
  const platforms = (process.env.ENABLE_PLATFORMS || 'youtube,instagram,facebook')
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

  if (platforms.includes('facebook')) {
    try {
      const id = await postToFacebook(videoUrl, product.name, captionText)
      posted++
      log('Posted to Facebook', { id })
    } catch (error: any) {
      log('Facebook post failed', error?.message || error)
    }

    const groupIds = parseIdList(pickEnv(['FB_GROUP_IDS', 'FACEBOOK_GROUP_IDS']))
    const allowedGroupIds = loadFacebookGroupAllowlist()
    const approvedGroupIds = groupIds.filter((groupId) => allowedGroupIds.has(groupId))
    const routedGroups = resolveFacebookGroupRoutes(product)

    if (groupIds.length > 0 && allowedGroupIds.size > 0) {
      const skippedGroupIds = groupIds.filter((groupId) => !allowedGroupIds.has(groupId))
      if (skippedGroupIds.length > 0) {
        log('Skipping unapproved Facebook group IDs', { skippedGroupIds })
      }

      for (const groupId of approvedGroupIds) {
        try {
          const id = await postToFacebookGroup(videoUrl, product.name, captionText, groupId)
          posted++
          log('Posted to Facebook group', { groupId, id })
        } catch (error: any) {
          log('Facebook group post failed', { groupId, error: error?.message || error })
        }
      }
      if (approvedGroupIds.length === 0) {
        log('No configured Facebook group IDs matched the allowlist')
      }
    } else {
      log('No Facebook group allowlist or group IDs configured; skipping group posts')
    }

    if (routedGroups.length > 0) {
      const routedGroupIds = routedGroups
        .map((route) => route.groupId || '')
        .map((groupId) => groupId.trim())
        .filter(Boolean)

      if (routedGroupIds.length === 0) {
        log('Facebook educational group routes configured but no group IDs are set yet', {
          routes: routedGroups.map((route) => route.label),
          topic: educationTopicForProduct(product),
        })
      } else {
        const dedupedGroupIds = [...new Set(routedGroupIds)]
        for (const groupId of dedupedGroupIds) {
          if (!allowedGroupIds.has(groupId)) {
            log('Skipping unrouted Facebook group because it is not allowlisted', { groupId })
            continue
          }
          try {
            const id = await postToFacebookGroup(videoUrl, product.name, captionText, groupId)
            posted++
            log('Posted to routed Facebook group', { groupId, id, topic: educationTopicForProduct(product) })
          } catch (error: any) {
            log('Routed Facebook group post failed', { groupId, error: error?.message || error })
          }
        }
      }
    }
  }

  if (posted === 0) throw new Error('No platform posts succeeded')
  log('Scheduled post completed', { posted })
}

main().catch((error) => {
  console.error('Scheduled post failed:', error?.message || error)
  process.exit(1)
})
