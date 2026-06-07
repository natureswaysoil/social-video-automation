// @ts-nocheck
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { ensureDir, safeFileName } from './video-utils'

const PEXELS_VIDEO_API = 'https://api.pexels.com/videos/search'
const PEXELS_PHOTO_API = 'https://api.pexels.com/v1/search'

function trimQuery(query: string, words = 4) {
  return String(query || '').split(/\s+/).filter(Boolean).slice(0, words).join(' ')
}

function uniqQueries(items: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const value = String(item || '').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

export function buildSceneQueryPriority(scene: any, product: any, index = 0) {
  const scenePrimary = String(scene?.brollQuery || '').trim()
  const sceneList = Array.isArray(scene?.brollQueries) ? scene.brollQueries : []
  const productFallback = Array.isArray(product?.brollQueries) ? product.brollQueries[index] : ''
  const categoryFallback = String(product?.category || '').trim()
  return uniqQueries([scenePrimary, ...sceneList, productFallback, categoryFallback])
}

/**
 * Build the search attempts for a query. We keep the attempts CLOSE to the
 * product (full query -> trimmed query) and only fall back to a generic term
 * as a last resort. Previously the chain degraded straight to "green lawn",
 * which is the main reason b-roll looked generic and unrelated to the product.
 */
function videoAttempts(query: string) {
  const q = String(query || '').trim()
  const short = trimQuery(q, 3)
  return [
    { query: q, orientation: 'portrait' },
    { query: q, orientation: 'landscape' },
    short !== q ? { query: short, orientation: 'portrait' } : null,
    short !== q ? { query: short, orientation: 'landscape' } : null
  ].filter(Boolean)
}

// ---------------------------------------------------------------------------
// VIDEO b-roll
// ---------------------------------------------------------------------------
export async function findPexelsVideoUrl(query: string) {
  const key = process.env.PEXELS_API_KEY
  if (!key) {
    console.log('Pexels skipped: missing PEXELS_API_KEY')
    return ''
  }

  for (const attempt of videoAttempts(query)) {
    try {
      const response = await axios.get(PEXELS_VIDEO_API, {
        headers: { Authorization: key },
        params: { query: attempt.query, orientation: attempt.orientation, per_page: 15 },
        timeout: 30000
      })
      const videos = Array.isArray(response.data?.videos) ? response.data.videos : []
      console.log('Pexels video search', { query: attempt.query, orientation: attempt.orientation, count: videos.length })

      // Prefer real portrait clips at a sane resolution (>=720 wide, <=2160),
      // so we don't grab a 4K landscape file and hard-crop it to a sliver.
      const ranked = videos
        .map((video: any) => {
          const files = video.video_files || []
          const portrait = files
            .filter((f: any) => Number(f.height || 0) >= Number(f.width || 0))
            .sort((a: any, b: any) => Math.abs(1080 - Number(a.width || 0)) - Math.abs(1080 - Number(b.width || 0)))[0]
          const any = files.sort((a: any, b: any) => Math.abs(1080 - Number(a.width || 0)) - Math.abs(1080 - Number(b.width || 0)))[0]
          const best = portrait || any
          return { id: video.id, url: best?.link || '', width: best?.width || 0, height: best?.height || 0, isPortrait: !!portrait }
        })
        .filter((item: any) => item.url)
        // portrait first, then closeness to 1080 wide
        .sort((a: any, b: any) => (Number(b.isPortrait) - Number(a.isPortrait)) || (Math.abs(1080 - a.width) - Math.abs(1080 - b.width)))

      if (ranked[0]) {
        console.log('Selected Pexels video', { query: attempt.query, id: ranked[0].id, res: `${ranked[0].width}x${ranked[0].height}`, portrait: ranked[0].isPortrait })
        return ranked[0].url
      }
    } catch (error: any) {
      console.log('Pexels video search failed', { query: attempt.query, status: error?.response?.status, message: error?.message })
    }
  }
  return ''
}

// ---------------------------------------------------------------------------
// PHOTO b-roll (used for Ken Burns scenes)
// ---------------------------------------------------------------------------
export async function findPexelsPhotoUrl(query: string) {
  const key = process.env.PEXELS_API_KEY
  if (!key) {
    console.log('Pexels skipped: missing PEXELS_API_KEY')
    return ''
  }

  const attempts = [
    { query: String(query || '').trim(), orientation: 'portrait' },
    { query: trimQuery(query, 3), orientation: 'portrait' },
    { query: String(query || '').trim(), orientation: 'landscape' }
  ]

  for (const attempt of attempts) {
    try {
      const response = await axios.get(PEXELS_PHOTO_API, {
        headers: { Authorization: key },
        params: { query: attempt.query, orientation: attempt.orientation, per_page: 15 },
        timeout: 30000
      })
      const photos = Array.isArray(response.data?.photos) ? response.data.photos : []
      console.log('Pexels photo search', { query: attempt.query, orientation: attempt.orientation, count: photos.length })
      const first = photos[0]
      // large2x (~1880px) is plenty for a 1080x1920 Ken Burns frame; original is huge.
      const url = first?.src?.large2x || first?.src?.original || first?.src?.large || ''
      if (url) {
        console.log('Selected Pexels photo', { query: attempt.query, id: first?.id })
        return url
      }
    } catch (error: any) {
      console.log('Pexels photo search failed', { query: attempt.query, status: error?.response?.status, message: error?.message })
    }
  }
  return ''
}

export async function downloadUrl(url: string, outputFile: string) {
  ensureDir(path.dirname(outputFile))
  const response = await axios.get(url, { responseType: 'stream', timeout: 120000 })
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputFile)
    response.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
  return outputFile
}

export async function downloadPexelsVideo(query: string, outputDir: string, index = 0) {
  const url = await findPexelsVideoUrl(query)
  if (!url) return ''
  const file = path.resolve(outputDir, `${String(index + 1).padStart(2, '0')}-vid-${safeFileName(query, 'mp4')}`)
  return await downloadUrl(url, file)
}

export async function downloadPexelsPhoto(query: string, outputDir: string, index = 0) {
  const url = await findPexelsPhotoUrl(query)
  if (!url) return ''
  const ext = (url.split('?')[0].toLowerCase().endsWith('.png')) ? 'png' : 'jpg'
  const file = path.resolve(outputDir, `${String(index + 1).padStart(2, '0')}-img-${safeFileName(query, ext)}`)
  return await downloadUrl(url, file)
}

export async function fetchBrollForScene(scene: any, product: any, outputDir: string, index = 0) {
  const attempts = buildSceneQueryPriority(scene, product, index)
  for (const query of attempts) {
    try {
      const videoFile = await downloadPexelsVideo(query, outputDir, index)
      if (videoFile) return { file: videoFile, kind: 'video', query }
    } catch {}
    try {
      const photoFile = await downloadPexelsPhoto(query, outputDir, index)
      if (photoFile) return { file: photoFile, kind: 'photo', query }
    } catch {}
  }
  return null
}
