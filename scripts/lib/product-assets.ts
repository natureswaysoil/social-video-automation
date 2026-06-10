import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { ensureDir, safeFileName } from './video-utils'

const ROOT = process.cwd()
const PRODUCT_ASSET_DIR = path.resolve(ROOT, 'assets/products')
const DEFAULT_SITE_BASE_URL = 'https://www.natureswaysoil.com'

export function localProductImage(product: any) {
  const candidates = [
    path.resolve(PRODUCT_ASSET_DIR, `${product.id}.png`),
    path.resolve(PRODUCT_ASSET_DIR, `${product.id}.jpg`),
    path.resolve(PRODUCT_ASSET_DIR, `${safeFileName(product.name, 'png')}`),
    path.resolve(PRODUCT_ASSET_DIR, `${safeFileName(product.name, 'jpg')}`)
  ]
  return candidates.find((file) => fs.existsSync(file)) || ''
}

function encodeUrlPath(url: string) {
  try {
    const parsed = new URL(url)
    parsed.pathname = parsed.pathname
      .split('/')
      .map((part) => encodeURIComponent(decodeURIComponent(part)))
      .join('/')
    return parsed.toString()
  } catch {
    return url
  }
}

function productImageSource(product: any) {
  const source = product.productImageUrl || product.imageUrl || product.amazonImageUrl || product.productImagePath || product.imagePath || ''
  if (!source) return ''
  if (/^https?:\/\//i.test(source)) return encodeUrlPath(source)
  if (String(source).startsWith('/')) {
    const base = (process.env.PRODUCT_IMAGE_BASE_URL || DEFAULT_SITE_BASE_URL).replace(/\/$/, '')
    return encodeUrlPath(`${base}${source}`)
  }
  return source
}

function imageExtension(url: string) {
  const clean = String(url || '').split('?')[0].toLowerCase()
  if (clean.endsWith('.png')) return 'png'
  if (clean.endsWith('.webp')) return 'webp'
  return 'jpg'
}

export async function downloadProductImage(product: any, outputDir: string) {
  const local = localProductImage(product)
  if (local) return local

  const url = productImageSource(product)
  if (!url) return ''

  ensureDir(outputDir)
  const ext = imageExtension(url)
  const output = path.resolve(outputDir, `product-${product.id}.${ext}`)

  try {
    const response = await axios.get(url, { responseType: 'stream', timeout: 60000 })
    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(output)
      response.data.pipe(writer)
      writer.on('finish', () => resolve())
      writer.on('error', reject)
    })
    return output
  } catch (error: any) {
    console.log('Product image skipped; continuing with b-roll only', {
      productId: product.id,
      source: url,
      error: error?.response?.status || error?.message || error
    })
    try { if (fs.existsSync(output)) fs.unlinkSync(output) } catch {}
    return ''
  }
}

export function productOverlayText(product: any) {
  if (/2\.5|pasture|hay|acre/i.test(`${product.name} ${product.description}`)) return 'COVERS UP TO 2–5 ACRES'
  if (/dog|urine|odor|pet/i.test(`${product.name} ${product.description}`)) return 'PET-SAFE OUTDOOR SUPPORT'
  if (/worm|biochar|compost|living soil/i.test(`${product.name} ${product.description}`)) return 'WORM CASTINGS + BIOCHAR'
  if (/humic|fulvic|kelp/i.test(`${product.name} ${product.description}`)) return 'HUMIC + FULVIC + KELP'
  return 'SOIL-FIRST SUPPORT'
}
