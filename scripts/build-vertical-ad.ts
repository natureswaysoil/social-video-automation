import 'dotenv/config'
import path from 'path'
import fs from 'fs'
import { composeVerticalAd } from './lib/ffmpeg-compositor'
import { downloadPexelsVideo } from './lib/pexels-media'
import { downloadProductImage, productOverlayText } from './lib/product-assets'
import { ensureDir, safeFileName } from './lib/video-utils'
import { runFfmpeg } from './lib/ffmpeg'

const ROOT = process.cwd()
const OUTPUT_DIR = path.resolve(ROOT, 'output')
const TEMP_DIR = path.resolve(ROOT, 'temp-scenes')
const PRODUCTS_PATH = path.resolve(ROOT, 'config/top-products.json')

function readJson(file: string, fallback: any) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function chooseProduct() {
  const raw = readJson(PRODUCTS_PATH, { topProducts: [] })
  const products = raw.topProducts || []
  if (!products.length) throw new Error('No products configured')
  return products[Math.floor(Math.random() * products.length)]
}

function hookCaption(product: any) {
  const text = `${product.name} ${product.description}`.toLowerCase()
  if (/dog|urine|pet|odor/.test(text)) return 'DOG URINE RUINING YOUR LAWN?'
  if (/pasture|hay|acre/.test(text)) return 'YOUR PASTURE MAY NEED THIS'
  if (/worm|biochar|compost/.test(text)) return 'TIRED SOIL? FIX THE ROOT CAUSE'
  if (/humic|fulvic|kelp/.test(text)) return 'YELLOW GRASS? START BELOW THE SURFACE'
  return 'SOIL HEALTH CHANGES EVERYTHING'
}

async function build() {
  ensureDir(OUTPUT_DIR)
  ensureDir(TEMP_DIR)

  const product = chooseProduct()
  console.log('Building vertical marketing ad', { product: product.name })

  const queries = product.brollQueries?.length
    ? product.brollQueries
    : [
        'lush lawn drone shot',
        'spraying lawn with hose sprayer',
        'close-up healthy roots soil',
        'green pasture aerial',
        'garden before after'
      ]

  const sceneFiles: string[] = []

  for (let i = 0; i < Math.min(5, queries.length); i++) {
    try {
      const file = await downloadPexelsVideo(queries[i], TEMP_DIR, i)
      if (file) sceneFiles.push(file)
    } catch (error: any) {
      console.log('Scene download failed', { query: queries[i], error: error?.message || error })
    }
  }

  if (!sceneFiles.length) throw new Error('No footage downloaded')

  const productImage = await downloadProductImage(product, TEMP_DIR)

  const finalVideo = await composeVerticalAd({
    outputName: `${safeFileName(product.name, 'mp4')}`,
    sceneFiles,
    productImage,
    captionText: hookCaption(product),
    overlayText: productOverlayText(product)
  })

  const thumbnail = path.resolve(OUTPUT_DIR, `${safeFileName(product.name, 'jpg')}`)

  runFfmpeg(['-y', '-i', finalVideo, '-ss', '00:00:02', '-vframes', '1', thumbnail])

  console.log('Vertical marketing ad completed', {
    finalVideo,
    thumbnail,
    product: product.name,
    scenes: sceneFiles.length
  })
}

build().catch((error) => {
  console.error('Vertical ad build failed:', error?.message || error)
  process.exit(1)
})
