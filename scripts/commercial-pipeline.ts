// @ts-nocheck
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import OpenAI from 'openai'
import { execSync } from 'child_process'
import { google } from 'googleapis'
import { Storage } from '@google-cloud/storage'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import { fetchBrollForScene } from './lib/pexels-media'
import { composeVerticalAd } from './lib/ffmpeg-compositor'
import { downloadProductImage, productOverlayText } from './lib/product-assets'
import { chooseBestHook } from './lib/retention-engine'
import { buildThumbnailPrompt } from './lib/ffmpeg-builder'
import { recordPerformance } from './lib/marketing-engine'
import { formatCaption } from './lib/caption-formatter'
import { postToTikTok } from './lib/social-platforms'
import { createNarration } from './lib/video-provider'
import { ensureDir, readJson, safeFileName, writeJson } from './lib/video-utils'

const ROOT = process.cwd()
const PRODUCTS_PATH = path.resolve(ROOT, 'config/top-products.json')
const CREATIVE_PATH = path.resolve(ROOT, 'config/creative-profiles.json')
const OUTPUT_DIR = path.resolve(ROOT, 'output')
const TEMP_DIR = path.resolve(ROOT, 'temp-commercial')
const MANIFEST_DIR = path.resolve(ROOT, 'data/runs')
const FOOTAGE_DIR = path.resolve(ROOT, process.env.FOOTAGE_DIR || 'footage')
const DEFAULT_PUBLIC_VIDEO_BUCKET = 'natureswaysoil-social-videos'
const PLATFORM_VARIANT_MAP: Record<string, string> = {
  youtube_shorts: 'youtube',
  instagram_reels: 'instagram',
  facebook_reels: 'facebook',
  tiktok: 'tiktok'
}
const SECRET_NAMES = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
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
  'FACEBOOK_PAGE_ACCESS_TOKEN',
  'FACEBOOK_PAGE_ID',
  'TIKTOK_ACCESS_TOKEN',
  'TIKTOK_OPEN_ID',
  'GCS_PUBLIC_BUCKET',
  'VIDEO_PUBLIC_BUCKET',
  'VIDEO_PUBLIC_URL_BASE'
]

function hasValue(name: string) {
  const value = process.env[name]
  return !!value && !/your-|your_|changeme|placeholder|paste_|replace_|dummy_|example_/i.test(value)
}

function secretCandidates(name: string) {
  const upper = name.trim().replace(/[\s-]+/g, '_').toUpperCase()
  return [...new Set([name, upper, upper.toLowerCase(), upper.toLowerCase().replace(/_/g, '-')])]
}

async function loadSecrets() {
  if (String(process.env.USE_SECRET_MANAGER || 'true').toLowerCase() === 'false') return
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'natureswaysoil-video'
  const client = new SecretManagerServiceClient()
  for (const name of SECRET_NAMES) {
    if (hasValue(name)) continue
    for (const candidate of secretCandidates(name)) {
      try {
        const [version] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${candidate}/versions/latest` })
        const value = version.payload?.data?.toString().trim()
        if (value) {
          process.env[name] = value
          process.env[candidate] = value
          console.log(`Loaded secret: ${candidate}${candidate === name ? '' : ` -> ${name}`}`)
          break
        }
      } catch (error: any) {
        if (Number(error?.code) === 5 || String(error?.message || '').includes('NOT_FOUND')) continue
        break
      }
    }
  }
}

function pickEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(String(value || ''))
}

function publicBucketName() {
  return pickEnv(['GCS_PUBLIC_BUCKET', 'VIDEO_PUBLIC_BUCKET']) || DEFAULT_PUBLIC_VIDEO_BUCKET
}

function publicBucketUrlBase(bucket: string) {
  const explicit = process.env.VIDEO_PUBLIC_URL_BASE?.replace(/\/$/, '') || ''
  return explicit || `https://storage.googleapis.com/${bucket}`
}

function authHeader(token: string) {
  return { Authorization: 'Bearer ' + token }
}

async function uploadVideoForSocial(videoFileOrUrl: string): Promise<string> {
  if (isHttpUrl(videoFileOrUrl)) return videoFileOrUrl
  const bucketName = publicBucketName()
  const storage = new Storage()
  const objectName = `social-videos/${Date.now()}-${safeFileName(path.basename(videoFileOrUrl), 'mp4')}`
  await storage.bucket(bucketName).upload(videoFileOrUrl, {
    destination: objectName,
    resumable: false,
    metadata: {
      contentType: 'video/mp4',
      cacheControl: 'public, max-age=604800'
    }
  })
  try {
    await storage.bucket(bucketName).file(objectName).makePublic()
  } catch (error: any) {
    console.log('Could not make uploaded video public. Bucket may use uniform public access.', error?.message || error)
  }
  return `${publicBucketUrlBase(bucketName)}/${objectName.split('/').map(encodeURIComponent).join('/')}`
}

async function postToYouTube(videoFileOrUrl: string, title: string, description: string, thumbnailFile?: string): Promise<string> {
  const clientId = pickEnv(['YT_CLIENT_ID', 'YOUTUBE_CLIENT_ID'])
  const clientSecret = pickEnv(['YT_CLIENT_SECRET', 'YOUTUBE_CLIENT_SECRET'])
  const refreshToken = pickEnv(['YT_REFRESH_TOKEN', 'YOUTUBE_REFRESH_TOKEN'])
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Missing YouTube OAuth credentials')
  const oauth2Client = new google.auth.OAuth2({ clientId, clientSecret })
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client })
  const body = isHttpUrl(videoFileOrUrl)
    ? (await axios.get(videoFileOrUrl, { responseType: 'stream', timeout: 120000 })).data
    : fs.createReadStream(videoFileOrUrl)
  const requestBody = {
    snippet: { title: title.slice(0, 95), description, categoryId: '22' },
    status: { privacyStatus: (process.env.YT_PRIVACY_STATUS as any) || 'public' }
  }
  const upload = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody,
    media: { body }
  })
  const id = upload.data.id || ''
  if (!id) throw new Error('YouTube upload did not return video id')
  if (thumbnailFile && fs.existsSync(thumbnailFile)) {
    try {
      await youtube.thumbnails.set({ videoId: id, media: { body: fs.createReadStream(thumbnailFile) } })
    } catch (error: any) {
      console.log('YouTube thumbnail upload failed', error?.message || error)
    }
  }
  return id
}

async function postToInstagram(publicVideoUrl: string, captionText: string): Promise<string> {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN
  const igId = pickEnv(['INSTAGRAM_IG_ID', 'INSTAGRAM_USER_ID', 'INSTAGRAM_ACCOUNT_ID'])
  if (!accessToken || !igId) throw new Error('Missing Instagram access token or IG ID')
  if (!isHttpUrl(publicVideoUrl)) throw new Error('Instagram requires a public HTTPS video URL.')
  const apiVersion = process.env.INSTAGRAM_API_VERSION || 'v20.0'
  const host = process.env.INSTAGRAM_API_HOST || 'graph.facebook.com'
  const baseUrl = `https://${host}/${apiVersion}`
  const container = await axios.post(`${baseUrl}/${igId}/media`, { media_type: process.env.IG_MEDIA_TYPE || 'REELS', video_url: publicVideoUrl, caption: captionText }, { headers: authHeader(accessToken), timeout: 120000 })
  const creationId = container.data?.id
  if (!creationId) throw new Error('Instagram did not return creation id')
  for (let i = 0; i < 24; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10000))
    const status = await axios.get(`${baseUrl}/${creationId}?fields=status_code`, { headers: authHeader(accessToken), timeout: 30000 })
    const code = status.data?.status_code
    if (code === 'FINISHED') break
    if (code === 'ERROR' || code === 'EXPIRED') throw new Error(`Instagram container ${code}`)
  }
  const published = await axios.post(`${baseUrl}/${igId}/media_publish`, { creation_id: creationId }, { headers: authHeader(accessToken), timeout: 120000 })
  const mediaId = published.data?.id || ''
  if (!mediaId) throw new Error('Instagram publish did not return media id')
  return mediaId
}

async function postToFacebook(publicVideoUrl: string, captionText: string): Promise<string> {
  const accessToken = pickEnv(['FB_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN'])
  const pageId = pickEnv(['FB_PAGE_ID', 'FACEBOOK_PAGE_ID'])
  if (!accessToken || !pageId) throw new Error('Missing Facebook page access token or page ID')
  if (!isHttpUrl(publicVideoUrl)) throw new Error('Facebook requires a public HTTPS video URL.')
  const apiVersion = process.env.FACEBOOK_API_VERSION || process.env.INSTAGRAM_API_VERSION || 'v20.0'
  const host = process.env.FACEBOOK_API_HOST || 'graph.facebook.com'
  const baseUrl = `https://${host}/${apiVersion}`
  const response = await axios.post(`${baseUrl}/${pageId}/videos`, {
    file_url: publicVideoUrl,
    description: captionText,
    published: true
  }, { headers: authHeader(accessToken), timeout: 120000 })
  const id = response.data?.id || ''
  if (!id) throw new Error(`Facebook did not return video id: ${JSON.stringify(response.data)}`)
  return id
}

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

function normalizedScenes(scenePlan: any, fallbackSceneQueries: string[]) {
  if (Array.isArray(scenePlan?.scenes) && scenePlan.scenes.length) return scenePlan.scenes.slice(0, 5)
  return fallbackSceneQueries.slice(0, 5).map((query: string, idx: number) => ({
    name: `Scene ${idx + 1}`,
    seconds: idx === 0 ? 3 : 5,
    brollQuery: query
  }))
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
    return { fullVoiceover: `${hook}. ${product.description}. See full product details at natureswaysoil.com.`, scenes: fallbackQueries(product).slice(0, 5).map((query: string, i: number) => ({ name: `Scene ${i + 1}`, seconds: i === 0 ? 3 : 5, voiceover: product.description, brollQuery: query })) }
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
  if (process.env.OPENAI_API_KEY && String(process.env.USE_DALLE_THUMBNAIL || 'true').toLowerCase() === 'true') {
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const promptParts = buildThumbnailPrompt(product)
      const prompt = [
        `Create a product-focused vertical social thumbnail for Nature's Way Soil.`,
        `Headline: ${promptParts.headline}`,
        `Subheadline: ${promptParts.subheadline}`,
        `Visual style: ${promptParts.visual}`,
        `Hook context: ${hook}`,
        `Brand CTA should direct viewers to natureswaysoil.com.`,
        'No text clutter, no claims of guaranteed results.'
      ].join('\n')
      const image = await client.images.generate({
        model: process.env.THUMBNAIL_IMAGE_MODEL || 'dall-e-3',
        prompt,
        size: '1024x1024',
        quality: 'standard'
      } as any)
      const b64 = image.data?.[0]?.b64_json
      if (b64) {
        fs.writeFileSync(thumbnail, Buffer.from(b64, 'base64'))
        return thumbnail
      }
    } catch (error: any) {
      console.log('DALL-E thumbnail generation failed; using frame extract fallback', { error: error?.message || error })
    }
  }
  execSync(`ffmpeg -y -loglevel error -i "${videoFile}" -ss 00:00:02 -vframes 1 "${thumbnail}"`, { stdio: 'inherit' })
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

async function uploadAutomatically(variants: any[], context: any) {
  if (String(process.env.AUTO_UPLOAD || 'false').toLowerCase() !== 'true') {
    return variants.map(v => ({ platform: v.platform, skipped: true, reason: 'AUTO_UPLOAD not enabled', file: v.file }))
  }
  const enabled = String(process.env.ENABLE_PLATFORMS || 'youtube,instagram,facebook,tiktok')
    .toLowerCase()
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const captions = {
    youtube: formatCaption(context.product, context.scenePlan, 'youtube'),
    instagram: formatCaption(context.product, context.scenePlan, 'instagram'),
    facebook: formatCaption(context.product, context.scenePlan, 'facebook'),
    tiktok: formatCaption(context.product, context.scenePlan, 'tiktok')
  }

  const results = []
  for (const variant of variants) {
    const target = PLATFORM_VARIANT_MAP[variant.platform] || variant.platform

    if (!enabled.includes(target)) {
      results.push({ platform: variant.platform, skipped: true, reason: `Platform ${target} not enabled`, file: variant.file })
      continue
    }

    try {
      if (target === 'youtube') {
        const id = await postToYouTube(variant.file, context.product.name, captions.youtube, context.thumbnail)
        results.push({ platform: variant.platform, posted: true, id, file: variant.file })
        continue
      }

      const publicUrl = await uploadVideoForSocial(variant.file)
      if (target === 'instagram') {
        const id = await postToInstagram(publicUrl, captions.instagram)
        results.push({ platform: variant.platform, posted: true, id, file: variant.file, publicUrl })
      } else if (target === 'facebook') {
        const id = await postToFacebook(publicUrl, captions.facebook)
        results.push({ platform: variant.platform, posted: true, id, file: variant.file, publicUrl })
      } else if (target === 'tiktok') {
        const result = await postToTikTok(publicUrl, captions.tiktok)
        results.push({ platform: variant.platform, posted: true, ...result, file: variant.file, publicUrl })
      } else {
        results.push({ platform: variant.platform, skipped: true, reason: `No posting handler for ${target}`, file: variant.file })
      }
    } catch (error: any) {
      results.push({ platform: variant.platform, failed: true, error: error?.message || error, file: variant.file })
    }
  }
  return results
}

async function main() {
  await loadSecrets()
  ensureDir(OUTPUT_DIR); ensureDir(TEMP_DIR); ensureDir(MANIFEST_DIR); ensureDir(FOOTAGE_DIR)
  const product = pickProduct()
  const profile = creativeFor(product)
  const baseHook = product.hook || `${product.name} can help support better soil.`
  const bestHook = chooseBestHook(baseHook)
  console.log('Commercial pipeline selected product', { product: product.name, hook: bestHook })
  const scenePlan = await generateScenePlan(product, profile, bestHook.hook)
  const local = localFootageCandidates(product)
  const usedLocal = new Set<string>()
  const scenes = []
  const productImage = await downloadProductImage(product, TEMP_DIR)
  const fallbackSceneQueries = fallbackQueries(product)
  const localScore = (file: string, text: string) => {
    const fileName = path.basename(file).toLowerCase()
    return text
      .split(/\s+/)
      .filter(Boolean)
      .reduce((score: number, token: string) => score + (fileName.includes(token) ? 1 : 0), 0)
  }

  for (const [i, rawScene] of normalizedScenes(scenePlan, fallbackSceneQueries).entries()) {
    const scene = rawScene || {}
    const seconds = Number(scene.seconds || 5)
    if (scene.useProductImage && productImage) {
      scenes.push({ file: productImage, seconds, kind: 'product' })
      continue
    }

    const queryText = `${scene.name || ''} ${scene.caption || ''} ${scene.brollQuery || ''} ${(scene.brollQueries || []).join(' ')}`.toLowerCase()
    const localCandidate = local
      .filter((file) => !usedLocal.has(file))
      .map((file) => ({ file, score: localScore(file, queryText) }))
      .sort((a, b) => b.score - a.score)[0]

    if (localCandidate?.score > 0) {
      usedLocal.add(localCandidate.file)
      scenes.push({ file: localCandidate.file, seconds, kind: 'video' })
      continue
    }

    const fetched = await fetchBrollForScene(scene, product, TEMP_DIR, i)
    if (fetched?.file) {
      scenes.push({ file: fetched.file, seconds, kind: fetched.kind })
      continue
    }
    if (productImage) scenes.push({ file: productImage, seconds, kind: 'product' })
  }

  if (!scenes.length) throw new Error('No footage available. Add .mp4 files to footage/ or check PEXELS_API_KEY.')
  let voiceoverFile = ''
  if (String(process.env.ENABLE_NARRATOR || 'true').toLowerCase() !== 'false') voiceoverFile = await createNarration(product, scenePlan, profile, TEMP_DIR)
  const master = await composeVerticalAd({ outputName: `${safeFileName(product.name)}-master.mp4`, scenes, voiceoverFile, productImage, captionText: bestHook.hook, overlayText: productOverlayText(product) })
  const thumbnail = await makeThumbnail(master, product, bestHook.hook)
  const variants = exportPlatformVariants(master, product)
  const uploadResults = await uploadAutomatically(variants, { product, scenePlan, thumbnail })
  const run = { runId: Date.now(), createdAt: new Date().toISOString(), product, hook: bestHook, scenePlan, scenes, voiceoverFile, master, thumbnail, variants, uploadResults }
  const manifestFile = path.resolve(MANIFEST_DIR, `${run.runId}-${safeFileName(product.name)}.json`)
  writeJson(manifestFile, run)
  recordPerformance({ productId: product.id, productName: product.name, hook: bestHook.hook, variant: 'commercial_pipeline', views: 0, likes: 0, comments: 0, clicks: 0, output: master })
  console.log('Commercial pipeline completed', { master, thumbnail, manifestFile, variants: variants.map(v => v.platform) })
}

main().catch((error) => { console.error('Commercial pipeline failed:', error?.message || error); process.exit(1) })
