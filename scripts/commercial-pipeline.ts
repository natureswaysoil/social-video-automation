// @ts-nocheck
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { execSync } from 'child_process'
import { createDidVideo, pollDidVideo } from './lib/did-provider'
import { downloadPexelsVideo } from './lib/pexels-media'
import { composeVerticalAd } from './lib/ffmpeg-compositor'
import { downloadProductImage, productOverlayText } from './lib/product-assets'
import { chooseBestHook } from './lib/retention-engine'
import { recordPerformance } from './lib/marketing-engine'
import { ensureDir, readJson, safeFileName, writeJson } from './lib/video-utils'

const ROOT = process.cwd()
const PRODUCTS_PATH = path.resolve(ROOT, 'config/top-products.json')
const CREATIVE_PATH = path.resolve(ROOT, 'config/creative-profiles.json')
const OUTPUT_DIR = path.resolve(ROOT, 'output')
const TEMP_DIR = path.resolve(ROOT, 'temp-commercial')
const MANIFEST_DIR = path.resolve(ROOT, 'data/runs')
const FOOTAGE_DIR = path.resolve(ROOT, process.env.FOOTAGE_DIR || 'footage')

function pickProduct() {
  const raw = readJson(PRODUCTS_PATH, { topProducts: [] })
  const products = raw.topProducts || []
  if (!products.length) throw new Error('No products configured')
  const requested = process.env.PRODUCT_ID
  return requested ? products.find((p: any) => p.id === requested) || products[0] : products[Math.floor(Math.random() * products.length)]
}

function creativeFor(product: any) {
  const raw = readJson(CREATIVE_PATH, { defaults: {}, profiles: {} })
  return { ...(raw.defaults || {}), ...((raw.profiles || {})[product.id] || {}) }
}

function fallbackQueries(product: any) {
  const text = `${product.name} ${product.description} ${product.category}`.toLowerCase()
  if (/dog|urine|pet|odor/.test(text)) return ['dog on green lawn', 'yellow lawn patch', 'spraying backyard lawn', 'clean patio dog', 'lush backyard grass']
  if (/pasture|hay|acre|field/.test(text)) return ['green pasture field', 'spraying farm field', 'hay field grass', 'lush grass close up', 'farm pasture sunset']
  if (/compost|worm|biochar|soil revitalizer/.test(text)) return ['hands holding rich soil', 'raised bed garden soil', 'compost close up', 'vegetable garden raised bed', 'healthy plant roots']
  return ['lush green lawn', 'spraying lawn', 'healthy soil close up', 'garden watering plants', 'green grass close up']
}

function localFootageCandidates(product: any) {
  if (!fs.existsSync(FOOTAGE_DIR)) return []
  const files = fs.readdirSync(FOOTAGE_DIR).filter((f) => /\.(mp4|mov|mkv|webm)$/i.test(f)).map((f) => path.resolve(FOOTAGE_DIR, f))
  const text = `${product.name} ${product.category}`.toLowerCase()
  return files.sort((a, b) => {
    const an = path.basename(a).toLowerCase()
    const bn = path.basename(b).toLowerCase()
    const score = (name: string) => {
      let s = 0
      if (/dog|pet|urine/.test(text) && /dog|pet|urine|lawn/.test(name)) s += 5
      if (/pasture|hay|field/.test(text) && /pasture|hay|field|farm/.test(name)) s += 5
      if (/compost|biochar|worm/.test(text) && /compost|soil|worm|garden/.test(name)) s += 5
      if (/spray|hose|before|after/.test(name)) s += 3
      return s
    }
    return score(bn) - score(an)
  })
}

async function generateScenePlan(product: any, profile: any, hook: string) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      fullVoiceover: `${hook}. ${product.description}. Shop Nature's Way Soil today.`,
      scenes: fallbackQueries(product).slice(0, 5).map((query: string, i: number) => ({ name: `Scene ${i + 1}`, seconds: i === 0 ? 3 : 5, voiceover: product.description, brollQuery: query }))
    }
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const prompt = `Build a commercial short-form ad scene plan for Nature's Way Soil.
Product: ${product.name}
Description: ${product.description}
Hook: ${hook}
Audience: ${profile.audience || 'lawn care, gardeners, land owners, homesteaders'}
Use five scenes, 22-32 seconds total.
Use simple stock-video search queries like "green lawn", "spraying lawn", "rich soil", "pasture field". Avoid complex sentence queries.
Require: product visible early, b-roll focused, narrator as support only, bold captions, CTA.
Avoid guaranteed results, disease claims, pesticide claims.
Return JSON only: {"fullVoiceover":"...","scenes":[{"name":"...","seconds":5,"voiceover":"...","brollQuery":"...","caption":"..."}]}`
  const res = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 800 })
  const text = res.choices[0]?.message?.content || ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('OpenAI did not return JSON scene plan')
  return JSON.parse(match[0])
}

async function makeThumbnail(videoFile: string, product: any, hook: string) {
  const thumbnail = path.resolve(OUTPUT_DIR, `${safeFileName(product.name)}-thumbnail.jpg`)
  execSync(`ffmpeg -y -i "${videoFile}" -ss 00:00:02 -vframes 1 "${thumbnail}"`, { stdio: 'inherit' })
  return thumbnail
}

function exportPlatformVariants(masterFile: string, product: any) {
  const variants = []
  const specs = [
    { platform: 'youtube_shorts', suffix: 'shorts', maxSeconds: 60 },
    { platform: 'instagram_reels', suffix: 'reels', maxSeconds: 90 },
    { platform: 'tiktok', suffix: 'tiktok', maxSeconds: 60 },
    { platform: 'facebook_reels', suffix: 'facebook', maxSeconds: 90 }
  ]
  for (const spec of specs) {
    const out = path.resolve(OUTPUT_DIR, `${safeFileName(product.name)}-${spec.suffix}.mp4`)
    execSync(`ffmpeg -y -i "${masterFile}" -t ${spec.maxSeconds} -c copy "${out}"`, { stdio: 'inherit' })
    variants.push({ ...spec, file: out })
  }
  return variants
}

async function uploadAutomatically(variants: any[], manifest: any) {
  if (String(process.env.AUTO_UPLOAD || 'false').toLowerCase() !== 'true') {
    return variants.map(v => ({ platform: v.platform, skipped: true, reason: 'AUTO_UPLOAD not enabled', file: v.file }))
  }
  return variants.map(v => ({ platform: v.platform, queued: true, file: v.file }))
}

async function main() {
  ensureDir(OUTPUT_DIR)
  ensureDir(TEMP_DIR)
  ensureDir(MANIFEST_DIR)
  ensureDir(FOOTAGE_DIR)

  const product = pickProduct()
  const profile = creativeFor(product)
  const baseHook = product.hook || `${product.name} can help support better soil.`
  const bestHook = chooseBestHook(baseHook)

  console.log('Commercial pipeline selected product', { product: product.name, hook: bestHook })

  const scenePlan = await generateScenePlan(product, profile, bestHook.hook)
  const sceneFiles = []

  for (const file of localFootageCandidates(product).slice(0, 5)) {
    sceneFiles.push(file)
  }

  const queries = [
    ...(scenePlan.scenes || []).map((s: any) => s.brollQuery).filter(Boolean),
    ...(product.brollQueries || []),
    ...fallbackQueries(product)
  ]

  for (let i = 0; sceneFiles.length < 5 && i < queries.length; i++) {
    const query = queries[i]
    try {
      const file = await downloadPexelsVideo(query, TEMP_DIR, i)
      if (file) sceneFiles.push(file)
    } catch (error: any) {
      console.log('Footage ingestion failed', { query, error: error?.message || error })
    }
  }

  if (!sceneFiles.length) throw new Error('No footage available. Add .mp4 files to footage/ or check PEXELS_API_KEY.')

  let narratorVideo = ''
  if (String(process.env.ENABLE_NARRATOR || 'true').toLowerCase() !== 'false') {
    const narratorId = await createDidVideo(product, scenePlan, profile)
    narratorVideo = await pollDidVideo(narratorId)
  }

  const productImage = await downloadProductImage(product, TEMP_DIR)
  const master = await composeVerticalAd({
    outputName: `${safeFileName(product.name)}-master.mp4`,
    sceneFiles,
    narratorVideo,
    productImage,
    captionText: bestHook.hook,
    overlayText: productOverlayText(product)
  })

  const thumbnail = await makeThumbnail(master, product, bestHook.hook)
  const variants = exportPlatformVariants(master, product)
  const uploadResults = await uploadAutomatically(variants, { product, scenePlan })

  const run = { runId: Date.now(), createdAt: new Date().toISOString(), product, hook: bestHook, scenePlan, sceneFiles, narratorVideo, master, thumbnail, variants, uploadResults }
  const manifestFile = path.resolve(MANIFEST_DIR, `${run.runId}-${safeFileName(product.name)}.json`)
  writeJson(manifestFile, run)
  recordPerformance({ productId: product.id, productName: product.name, hook: bestHook.hook, variant: 'commercial_pipeline', views: 0, likes: 0, comments: 0, clicks: 0, output: master })
  console.log('Commercial pipeline completed', { master, thumbnail, manifestFile, variants: variants.map(v => v.platform) })
}

main().catch((error) => { console.error('Commercial pipeline failed:', error?.message || error); process.exit(1) })
