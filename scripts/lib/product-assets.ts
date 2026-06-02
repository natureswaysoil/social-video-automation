// @ts-nocheck
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
  if (clean.endsWith('.svg')) return 'svg'
  return 'jpg'
}

function xmlEscape(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapWords(text: string, maxChars = 24, maxLines = 4) {
  const words = String(text || '').replace(/Nature's Way Soil®?/gi, '').trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
    if (lines.length >= maxLines) break
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines.slice(0, maxLines)
}

function generateProductCard(product: any, outputDir: string) {
  ensureDir(outputDir)
  const output = path.resolve(outputDir, `generated-product-${product.id}.svg`)
  const nameLines = wrapWords(product.name, 23, 4)
  const size = product.size ? String(product.size).toUpperCase() : 'PREMIUM SOIL PRODUCT'
  const badge = productOverlayText(product)
  const price = product.price ? `$${Number(product.price).toFixed(2)}` : ''
  const yStart = 540
  const nameSvg = nameLines.map((line, idx) =>
    `<text x="540" y="${yStart + idx * 72}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="800" fill="#173d22">${xmlEscape(line)}</text>`
  ).join('\n')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f5fff4"/>
      <stop offset="1" stop-color="#dff2d5"/>
    </linearGradient>
    <linearGradient id="label" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#eef8e8"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <circle cx="140" cy="180" r="220" fill="#80b95a" opacity="0.18"/>
  <circle cx="960" cy="420" r="240" fill="#4f8f35" opacity="0.13"/>
  <circle cx="520" cy="1590" r="420" fill="#7ab65c" opacity="0.16"/>

  <text x="540" y="190" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="900" fill="#1c5f2d">Nature's Way Soil®</text>
  <text x="540" y="250" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="700" fill="#4d7440">Family Farm • Soil-First Products</text>

  <g filter="url(#shadow)">
    <rect x="300" y="360" width="480" height="840" rx="62" fill="#f2f2ea" stroke="#d2d2c8" stroke-width="8"/>
    <rect x="340" y="470" width="400" height="520" rx="30" fill="url(#label)" stroke="#2f7d36" stroke-width="8"/>
    <rect x="340" y="470" width="400" height="110" rx="30" fill="#2f7d36"/>
    <text x="540" y="543" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="900" fill="#ffffff">NATURE'S WAY</text>
    <text x="540" y="1038" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="800" fill="#2f7d36">${xmlEscape(size)}</text>
    <rect x="370" y="1120" width="340" height="46" rx="23" fill="#111111" opacity="0.16"/>
  </g>

  ${nameSvg}

  <rect x="150" y="1285" width="780" height="108" rx="54" fill="#2f7d36"/>
  <text x="540" y="1354" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="900" fill="#ffffff">${xmlEscape(badge)}</text>

  <text x="540" y="1470" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="800" fill="#173d22">Shop direct or on Amazon</text>
  ${price ? `<text x="540" y="1542" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="900" fill="#2f7d36">${xmlEscape(price)}</text>` : ''}
  <text x="540" y="1660" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#345b2f">natureswaysoil.com</text>
</svg>`
  fs.writeFileSync(output, svg, 'utf8')
  return output
}

export async function downloadProductImage(product: any, outputDir: string) {
  const local = localProductImage(product)
  if (local) return local

  const url = productImageSource(product)
  if (url) {
    ensureDir(outputDir)
    const ext = imageExtension(url)
    const output = path.resolve(outputDir, `product-${product.id}.${ext}`)

    try {
      const response = await axios.get(url, { responseType: 'stream', timeout: 60000 })
      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(output)
        response.data.pipe(writer)
        writer.on('finish', resolve)
        writer.on('error', reject)
      })
      return output
    } catch (error: any) {
      console.log('Product image skipped; generating branded fallback card', {
        productId: product.id,
        source: url,
        error: error?.response?.status || error?.message || error
      })
      try { if (fs.existsSync(output)) fs.unlinkSync(output) } catch {}
    }
  }

  return generateProductCard(product, outputDir)
}

export function productOverlayText(product: any) {
  if (/2\.5|pasture|hay|acre/i.test(`${product.name} ${product.description}`)) return 'COVERS UP TO 2–5 ACRES'
  if (/dog|urine|odor|pet/i.test(`${product.name} ${product.description}`)) return 'PET-SAFE OUTDOOR SUPPORT'
  if (/worm|biochar|compost|living soil/i.test(`${product.name} ${product.description}`)) return 'WORM CASTINGS + BIOCHAR'
  if (/humic|fulvic|kelp/i.test(`${product.name} ${product.description}`)) return 'HUMIC + FULVIC + KELP'
  return 'SOIL-FIRST SUPPORT'
}
