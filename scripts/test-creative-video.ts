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

const SECRET_NAMES = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'HEYGEN_API_KEY', 'PEXELS_API_KEY', 'HEYGEN_DEFAULT_AVATAR', 'HEYGEN_DEFAULT_VOICE']

function log(message: string, data?: any) { data === undefined ? console.log(message) : console.log(message, data) }
function json(file: string, fallback: any) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback } catch { return fallback } }
function good(value?: string) { return !!value && !/your_|your-|changeme|placeholder|paste_|replace_/i.test(value) }
function variants(name: string) { const upper = name.replace(/[\s-]+/g, '_').toUpperCase(); return [...new Set([upper, upper.toLowerCase().replace(/_/g, '-'), upper.toLowerCase()])] }

async function loadSecrets() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'natureswaysoil-video'
  const client = new SecretManagerServiceClient()
  for (const name of SECRET_NAMES) {
    if (good(process.env[name])) continue
    for (const candidate of variants(name)) {
      try {
        const [version] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${candidate}/versions/latest` })
        const value = version.payload?.data?.toString().trim()
        if (value) { process.env[name] = value; log(`Loaded secret: ${candidate}`); break }
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
    { name: 'problem', seconds: 7, brollQueries: product.brollQueries || [product.category] },
    { name: 'mechanism', seconds: 8, brollQueries: product.brollQueries || [product.category] },
    { name: 'application', seconds: 8, brollQueries: ['watering lawn', 'gardening application'] },
    { name: 'cta', seconds: 7, brollQueries: product.brollQueries || [product.category] }
  ]
  const hook = creative.hooks?.[0] || `${product.name} supports healthier soil and stronger-looking growth.`
  const text = [hook, product.description, 'Use it as part of your regular soil or lawn care routine according to label directions.', creative.cta || "Shop direct at Nature's Way Soil."]
  return scenes.slice(0, 4).map((s: any, i: number) => ({ name: s.name, seconds: s.seconds || 7, voiceover: text[i], brollQuery: (s.brollQueries || product.brollQueries || [product.category])[0] }))
}

function parseJson(text: string) { try { return JSON.parse(text) } catch { const m = text.match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]) } catch { return null } } }

async function generateScenes(product: any, creative: any) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const plan = (creative.scenes || []).map((s: any) => `${s.name}: ${(s.brollQueries || []).join(' | ')}`).join('\n')
  const prompt = `Create a 30 second vertical ad for Nature's Way Soil. Product: ${product.name}. Description: ${product.description}. Audience: ${creative.audience}. Angle: ${creative.angle}. Tone: ${creative.tone}. Scene plan: ${plan}. Return only JSON: {"fullVoiceover":"...","scenes":[{"name":"...","seconds":7,"voiceover":"...","brollQuery":"..."}]}. Use 4 scenes. Be honest, no guaranteed results, end with a website CTA.`
  const response = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.75, max_tokens: 650 })
  const parsed = parseJson(response.choices[0]?.message?.content || '')
  const scenes = parsed?.scenes?.length ? parsed.scenes.slice(0, 4) : fallbackScenes(product, creative)
  return { fullVoiceover: parsed?.fullVoiceover || scenes.map((s: any) => s.voiceover).join(' '), scenes }
}

async function pexels(query: string) {
  if (!process.env.PEXELS_API_KEY) return ''
  const res = await axios.get('https://api.pexels.com/videos/search', { headers: { Authorization: process.env.PEXELS_API_KEY }, params: { query, orientation: 'portrait', per_page: 5 }, timeout: 30000 })
  const video = res.data?.videos?.[0]
  const files = video?.video_files || []
  const portrait = files.find((f: any) => Number(f.height || 0) > Number(f.width || 0))
  const url = portrait?.link || files[0]?.link || ''
  log('B-roll scene picked', { query, pexelsVideoId: video?.id, selected: !!url })
  return url
}

async function createVideo(product: any, creative: any, scenes: any[]) {
  const avatar = process.env.HEYGEN_DEFAULT_AVATAR || creative.avatarId || 'Daisy-inskirt-20220818'
  const voice = process.env.HEYGEN_DEFAULT_VOICE || creative.voiceId || '2d5b0e6cf36f460aa7fc47e3eee4ba54'
  const scale = Number(process.env.HEYGEN_AVATAR_SCALE || creative.avatarScale || 0.48)
  const offsetY = Number(process.env.HEYGEN_AVATAR_OFFSET_Y || creative.avatarOffsetY || 0.16)
  const inputs = []
  for (const scene of scenes) {
    const brollUrl = await pexels(scene.brollQuery)
    inputs.push({
      character: { type: 'avatar', avatar_id: avatar, avatar_style: 'normal', scale, offset: { x: 0, y: offsetY } },
      voice: { type: 'text', input_text: scene.voiceover, voice_id: voice, speed: 1.0 },
      background: brollUrl ? { type: 'video', url: brollUrl, play_style: 'fit_to_scene' } : { type: 'color', value: '#0a3d0a' }
    })
  }
  const res = await axios.post('https://api.heygen.com/v2/video/generate', { video_inputs: inputs, dimension: { width: 720, height: 1280 }, title: product.name }, { headers: { 'X-Api-Key': process.env.HEYGEN_API_KEY, 'Content-Type': 'application/json' }, timeout: 120000 })
  const videoId = res.data?.data?.video_id || res.data?.video_id
  log('HeyGen creative video job created', { videoId, product: product.name, avatar, voice, scale, sceneCount: inputs.length })
  return videoId
}

async function poll(videoId: string) {
  for (let i = 0; i < 100; i++) {
    const res = await axios.get('https://api.heygen.com/v1/video_status.get', { headers: { 'X-Api-Key': process.env.HEYGEN_API_KEY }, params: { video_id: videoId }, timeout: 60000 })
    const data = res.data?.data || res.data
    const status = String(data?.status || '').toLowerCase()
    log('HeyGen status', { videoId, status })
    if ((status.includes('complete') || status === 'success') && data.video_url) return data.video_url
    if (status.includes('fail') || status === 'error') throw new Error(data.error || data.error_message || 'HeyGen failed')
    await new Promise(r => setTimeout(r, 15000))
  }
  throw new Error('Timed out waiting for HeyGen')
}

async function main() {
  await loadSecrets()
  const product = pickProduct()
  const creative = creativeFor(product)
  log('Creative product selected', { product: product.name, id: product.id, angle: creative.angle })
  const generated = await generateScenes(product, creative)
  log('Generated scene plan', generated.scenes.map((s: any) => ({ name: s.name, query: s.brollQuery, text: s.voiceover })))
  const videoId = await createVideo(product, creative, generated.scenes)
  const videoUrl = await poll(videoId)
  log('Finished creative video URL', { videoUrl })
}

main().catch((error) => { console.error('Creative test failed:', error?.message || error); process.exit(1) })
