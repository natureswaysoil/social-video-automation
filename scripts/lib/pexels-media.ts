// @ts-nocheck
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { ensureDir, safeFileName } from './video-utils'

export async function findPexelsVideoUrl(query: string) {
  if (!process.env.PEXELS_API_KEY) return ''
  const response = await axios.get('https://api.pexels.com/videos/search', {
    headers: { Authorization: process.env.PEXELS_API_KEY },
    params: { query, orientation: 'portrait', per_page: 10 },
    timeout: 30000
  })
  const videos = Array.isArray(response.data?.videos) ? response.data.videos : []
  const ranked = videos
    .map((video: any) => {
      const files = video.video_files || []
      const portrait = files.find((file: any) => Number(file.height || 0) > Number(file.width || 0))
      const best = portrait || files.sort((a: any, b: any) => (Number(b.width || 0) * Number(b.height || 0)) - (Number(a.width || 0) * Number(a.height || 0)))[0]
      return { id: video.id, url: best?.link || '', width: best?.width || 0, height: best?.height || 0 }
    })
    .filter((item: any) => item.url)
    .sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height))
  const selected = ranked[0]
  if (selected) console.log('Selected Pexels compositor clip', { query, videoId: selected.id, resolution: `${selected.width}x${selected.height}` })
  return selected?.url || ''
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
  const file = path.resolve(outputDir, `${String(index + 1).padStart(2, '0')}-${safeFileName(query, 'mp4')}`)
  return await downloadUrl(url, file)
}
