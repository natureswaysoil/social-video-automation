import 'dotenv/config'
import path from 'path'
import { readJson, writeJson } from './lib/video-utils'
import { fetchBasicMetrics } from './lib/social-platforms'

const ROOT = process.cwd()
const ANALYTICS_FILE = path.resolve(ROOT, process.env.VIDEO_ANALYTICS_FILE || 'data/video-analytics.json')

async function main() {
  const analytics = readJson(ANALYTICS_FILE, { hooks: {}, videos: [] })
  const videos = Array.isArray(analytics.videos) ? analytics.videos : []

  let updated = 0
  for (const video of videos) {
    if (!video || !video.videoIds) continue
    const ageMs = Date.now() - new Date(video.recordedAt || 0).getTime()
    if (!Number.isFinite(ageMs) || ageMs < 24 * 60 * 60 * 1000) continue
    if (video.metricsFetchedAt) continue

    const metrics = await fetchBasicMetrics(video.videoIds)
    video.views = Number(metrics.youtube?.views || metrics.instagram?.views || metrics.facebook?.views || video.views || 0)
    video.likes = Number((metrics.youtube?.likes || 0) + (metrics.instagram?.likes || 0) + (metrics.facebook?.likes || 0))
    video.comments = Number((metrics.youtube?.comments || 0) + (metrics.instagram?.comments || 0) + (metrics.facebook?.comments || 0))
    video.metrics = metrics
    video.metricsFetchedAt = new Date().toISOString()
    updated++
  }

  analytics.lastUpdatedAt = new Date().toISOString()
  writeJson(ANALYTICS_FILE, analytics)
  console.log(`Analytics refresh complete: updated ${updated} record(s).`)
}

main().catch((error) => {
  console.error('fetch-analytics failed:', error?.message || error)
  process.exit(1)
})
