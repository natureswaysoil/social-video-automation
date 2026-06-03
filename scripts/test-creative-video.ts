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
  'DiD',
  'DID_VOICE_ID',
  'DID_SOURCE_URL',
]

function log(message: string, data?: any) { data === undefined ? console.log(message) : console.log(message, data) }
function json(file: string, fallback: any) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback } catch { return fallback } }
function good(value?: string) { return !!value && !/your_|your-|changeme|placeholder|paste_|replace_/i.test(value) }
function variants(name: string) { const upper = name.replace(/[\s-]+/g, '_').toUpperCase(); return [...new Set([upper, upper.toLowerCase().replace(/_/g, '-'), upper.toLowerCase(), name])] }

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
          if (candidate === 'DiD') process.env.DID_API_KEY = value
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
    { name: 'hook', seconds: 6, brollQueries: ['damaged lawn', 'dry pasture', 'weak grass'] },
    { name: 'mechanism', seconds: 8, brollQueries: product.brollQueries || [product.category] },
    { name: 'application', seconds: 8, brollQueries: ['spraying lawn', 'garden hose application'] },
    { name: 'cta', seconds: 7, brollQueries: ['healthy lawn', 'healthy pasture'] }
  ]

  const hook = creative.hooks?.[0] || `${product.name} helps support healthier soil and stronger-looking growth.`

  const text = [
    hook,
    product.description,
    'Apply consistently as part of your lawn, garden, or pasture routine according to label directions.',
    creative.cta || "Shop direct at Nature's Way Soil."
  ]

  return scenes.slice(0, 4).map((s: any, i: number) => ({
    name: s.name,
    seconds: s.seconds || 7,
    voiceover: text[i],
    brollQuery: (s.brollQueries || product.brollQueries || [product.category])[0]
  }))
}

function parseJson(text: string) {
  try { return JSON.parse(text) }
  catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    try { return JSON.parse(m[0]) } catch { return null }
  }
}

async function generateScenes(product: any, creative: any) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const plan = (creative.scenes || []).map((s: any) => `${s.name}: ${(s.brollQueries || []).join(' | ')}`).join('\n')

  const prompt = `Create a high-retention 30 second vertical social media ad for Nature's Way Soil.

Product: ${product.name}
Description: ${product.description}
Audience: ${creative.audience}
Angle: ${creative.angle}
Tone: ${creative.tone}
Scene plan: ${plan}

Rules:
- Strong first 3 second hook.
- Visual-first pacing.
- Avoid exaggerated claims.
- Focus on soil improvement and practical use.
- End with a direct CTA.
- Return only JSON.

Format:
{"fullVoiceover":"...","scenes":[{"name":"...","seconds":7,"voiceover":"...","brollQuery":"..."}]}
`

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.75,
    max_tokens: 650
  })

  const parsed = parseJson(response.choices[0]?.message?.content || '')
  const scenes = parsed?.scenes?.length ? parsed.scenes.slice(0, 4) : fallbackScenes(product, creative)

  return {
    fullVoiceover: parsed?.fullVoiceover || scenes.map((s: any) => s.voiceover).join(' '),
    scenes
  }
}

async function createVideo(product: any, creative: any, fullVoiceover: string) {
  const rawKey = process.env.DiD || process.env.DID_API_KEY
  if (!rawKey) throw new Error('No D-ID API key found (DiD or DID_API_KEY)')
  const encoded = Buffer.from(`${rawKey}:`).toString('base64')

  const sourceUrl = process.env.DID_SOURCE_URL ||
    'https://create-images-results.d-id.com/DefaultPresenters/Noelle_f/image.jpeg'
  const voiceId = process.env.DID_VOICE_ID || 'en-US-JennyNeural'

  const res = await axios.post(
    'https://api.d-id.com/talks',
    {
      source_url: sourceUrl,
      script: {
        type: 'text',
        input: fullVoiceover,
        provider: { type: 'microsoft', voice_id: voiceId }
      },
      config: { fluent: true, pad_audio: 0 }
    },
    {
      headers: {
        Authorization: `Basic ${encoded}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  )

  const jobId = res.data?.id
  if (!jobId) throw new Error('D-ID did not return a job ID')

  log('Creative video job created', {
    provider: 'D-ID',
    product: product.name,
    jobId,
    voiceId
  })

  return jobId
}

async function poll(jobId: string) {
  const rawKey = process.env.DiD || process.env.DID_API_KEY
  const encoded = Buffer.from(`${rawKey}:`).toString('base64')

  for (let i = 0; i < 60; i++) {
    const res = await axios.get(`https://api.d-id.com/talks/${jobId}`, {
      headers: { Authorization: `Basic ${encoded}` },
      timeout: 60000
    })

    const status = String(res.data?.status || '').toLowerCase()
    log('Video render status', { jobId, status })

    if ((status === 'done' || status.includes('complet')) && res.data.result_url) {
      return res.data.result_url
    }

    if (status.includes('fail') || status === 'error') {
      throw new Error(res.data?.error?.description || res.data?.error || 'D-ID video generation failed')
    }

    await new Promise(r => setTimeout(r, 10000))
  }

  throw new Error('Timed out waiting for D-ID video render')
}

async function main() {
  await loadSecrets()

  const product = pickProduct()
  const creative = creativeFor(product)

  log('Creative product selected', {
    product: product.name,
    id: product.id,
    angle: creative.angle
  })

  const generated = await generateScenes(product, creative)

  log('Generated scene plan', generated.scenes.map((s: any) => ({
    name: s.name,
    query: s.brollQuery,
    text: s.voiceover
  })))

  const jobId = await createVideo(product, creative, generated.fullVoiceover)
  const videoUrl = await poll(jobId)

  log('Finished creative video URL', { videoUrl })
}

main().catch((error) => {
  console.error('Creative test failed:', error?.message || error)
  process.exit(1)
})
