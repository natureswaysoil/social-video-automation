import 'dotenv/config'
import path from 'path'
import fs from 'fs'
import axios from 'axios'
import { ensureDir, readJson } from './lib/video-utils'

const ROOT = process.cwd()
const PRODUCTS_FILE = path.resolve(ROOT, 'config/top-products.json')
const OUTPUT_DIR = path.resolve(ROOT, 'assets/products')
const SITE_BASE = 'https://www.natureswaysoil.com'

function buildUrl(source: string) {
  if (!source) return ''
  if (/^https?:\/\//i.test(source)) return source
  if (source.startsWith('/')) return `${SITE_BASE}${source}`
  return source
}

function extFor(url: string) {
  const clean = String(url || '').split('?')[0].toLowerCase()
  if (clean.endsWith('.png')) return 'png'
  if (clean.endsWith('.webp')) return 'webp'
  return 'jpg'
}

async function download(url: string, outputFile: string) {
  const response = await axios.get(url, { responseType: 'stream', timeout: 60000 })
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(outputFile)
    response.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

async function main() {
  ensureDir(OUTPUT_DIR)
  const products = readJson(PRODUCTS_FILE, { topProducts: [] }).topProducts || []
  let ok = 0
  let failed = 0

  for (const product of products) {
    const source = buildUrl(product.productImageUrl || product.imageUrl || product.amazonImageUrl || product.productImagePath || product.imagePath || '')
    if (!source) continue
    const output = path.resolve(OUTPUT_DIR, `${product.id}.${extFor(source)}`)
    try {
      await download(source, output)
      ok++
      console.log('Downloaded product image', { productId: product.id, output })
    } catch (error: any) {
      failed++
      console.log('Failed product image download', { productId: product.id, source, error: error?.message || error })
    }
  }

  console.log(`Product image download complete. success=${ok} failed=${failed}`)
}

main().catch((error) => {
  console.error('download-product-images failed:', error?.message || error)
  process.exit(1)
})
