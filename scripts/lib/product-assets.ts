// @ts-nocheck
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { ensureDir, safeFileName } from './video-utils'

const ROOT = process.cwd()
const PRODUCT_ASSET_DIR = path.resolve(ROOT, 'assets/products')

export function localProductImage(product: any) {
  const candidates = [
    path.resolve(PRODUCT_ASSET_DIR, `${product.id}.png`),
    path.resolve(PRODUCT_ASSET_DIR, `${product.id}.jpg`),
    path.resolve(PRODUCT_ASSET_DIR, `${safeFileName(product.name, 'png')}`),
    path.resolve(PRODUCT_ASSET_DIR, `${safeFileName(product.name, 'jpg')}`)
  ]
  return candidates.find((file) => fs.existsSync(file)) || ''
}

export async function downloadProductImage(product: any, outputDir: string) {
  const local = localProductImage(product)
  if (local) return local

  const url = product.productImageUrl || product.imageUrl || product.amazonImageUrl || ''
  if (!url) return ''

  ensureDir(outputDir)
  const ext = url.toLowerCase().includes('.png') ? 'png' : 'jpg'
  const output = path.resolve(outputDir, `product-${product.id}.${ext}`)

  const response = await axios.get(url, { responseType: 'stream', timeout: 60000 })
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(output)
    response.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
  return output
}

export function productOverlayText(product: any) {
  if (/2\.5|pasture|hay|acre/i.test(`${product.name} ${product.description}`)) return 'COVERS UP TO 2–5 ACRES'
  if (/dog|urine|odor|pet/i.test(`${product.name} ${product.description}`)) return 'PET-SAFE OUTDOOR SUPPORT'
  if (/worm|biochar|compost|living soil/i.test(`${product.name} ${product.description}`)) return 'WORM CASTINGS + BIOCHAR'
  if (/humic|fulvic|kelp/i.test(`${product.name} ${product.description}`)) return 'HUMIC + FULVIC + KELP'
  return 'SOIL-FIRST SUPPORT'
}
