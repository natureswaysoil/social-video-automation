// @ts-nocheck
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { ensureDir, safeFileName } from './video-utils'

export async function findPexelsVideoUrl(query: string) {
  const key = process.env.PEXELS_API_KEY
  if (!key) {
    console.log('Pexels skipped: missing PEXELS_API_KEY')
    return ''
  }

  const attempts = [
    { query, orientation: 'portrait' },
    { query, orientation: 'landscape' },
    { query: query.split(' ').slice(0, 3).join(' '), orientation: 'portrait' },
    { query: 'green lawn', orientation: 'portrait' },
    { query: 'spraying lawn', orientation: 'landscape' }
  ]

  for (const attempt of attempts) {
    try {
      const response = await axios.get('https://api.pexels.com/videos/search', {
        headers: { Authorization: key },
        params: { query: attempt.query, orientation: attempt.orientation, per_page: 15 },
        timeout: 30000
      })

      const videos = Array.isArray(response.data?.videos) ? response.data.videos : []
      console.log('Pexels search result', { query: attempt.query, orientation: attempt.orientation, count: videos.length })

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
      if (selected) {
        console.log('Selected Pexels compositor clip', { query: attempt.query, videoId: selected.id, resolution: `${selected.width}x${selected.height}` })
        return selected.url
      }
    } catch (error: any) {
      console.log('Pexels search failed', {
        query: attempt.query,
        orientation: attempt.orientation,
        status: error?.response?.status,
        data: error?.response?.data,
        message: error?.message
      })
    }
  }

  return ''
}

export async function downloadUrl(url: string, outputFile: string) {
  ensureDir(path.dirname(outputFile))
  console.log('Downloading video asset', { outputFile })
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
