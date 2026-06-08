import axios from 'axios'
import { google } from 'googleapis'

function pickEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

export async function postToTikTok(videoUrl: string, caption: string) {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN
  const openId = process.env.TIKTOK_OPEN_ID
  if (!accessToken || !openId) {
    console.log('TikTok posting skipped: missing TIKTOK_ACCESS_TOKEN or TIKTOK_OPEN_ID')
    return { skipped: true }
  }
  if (!/^https?:\/\//i.test(videoUrl)) throw new Error('TikTok posting requires a public HTTPS video URL')

  const host = process.env.TIKTOK_API_HOST || 'open.tiktokapis.com'
  // For PULL_FROM_URL, TikTok fetches the video itself after init; no separate upload call is needed.
  const init = await axios.post(`https://${host}/v2/post/publish/video/init/`, {
    post_info: { title: caption.slice(0, 2200), privacy_level: 'PUBLIC_TO_EVERYONE', disable_duet: false, disable_comment: false, disable_stitch: false },
    source_info: { source: 'PULL_FROM_URL', video_url: videoUrl }
  }, { headers: { Authorization: 'Bearer ' + accessToken }, timeout: 120000 })

  const publishId = init.data?.data?.publish_id || init.data?.publish_id || ''
  if (!publishId) throw new Error(`TikTok init failed: ${JSON.stringify(init.data)}`)

  return {
    platform: 'tiktok',
    publishId,
    status: init.data?.data?.status || init.data?.status || 'submitted'
  }
}

export async function postToFacebookReels(videoUrl: string, caption: string) {
  if (!process.env.FACEBOOK_PAGE_ACCESS_TOKEN || !process.env.FACEBOOK_PAGE_ID) {
    console.log('Facebook Reels skipped: missing page credentials')
    return { skipped: true }
  }

  return {
    platform: 'facebook_reels',
    queued: true,
    videoUrl,
    caption
  }
}

export async function autoReplyTemplates() {
  return [
    'Thanks for checking out Nature\'s Way Soil.',
    'We appreciate the support.',
    'Let us know if you have application questions.',
    'Thanks for supporting a small family business.'
  ]
}

export async function fetchBasicMetrics(videoIds: { youtubeId?: string, instagramId?: string, facebookId?: string }) {
  const metrics: any = {
    youtube: { views: 0, likes: 0, comments: 0 },
    instagram: { views: 0, likes: 0, comments: 0, reach: 0 },
    facebook: { views: 0, likes: 0, comments: 0 }
  }

  if (videoIds.youtubeId) {
    try {
      const clientId = pickEnv(['YT_CLIENT_ID', 'YOUTUBE_CLIENT_ID'])
      const clientSecret = pickEnv(['YT_CLIENT_SECRET', 'YOUTUBE_CLIENT_SECRET'])
      const refreshToken = pickEnv(['YT_REFRESH_TOKEN', 'YOUTUBE_REFRESH_TOKEN'])
      if (clientId && clientSecret && refreshToken) {
        const oauth2Client = new google.auth.OAuth2({ clientId, clientSecret })
        oauth2Client.setCredentials({ refresh_token: refreshToken })
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client })
        const response = await youtube.videos.list({ part: ['statistics'], id: [videoIds.youtubeId] })
        const stats = response.data.items?.[0]?.statistics
        metrics.youtube = {
          views: Number(stats?.viewCount || 0),
          likes: Number(stats?.likeCount || 0),
          comments: Number(stats?.commentCount || 0)
        }
      }
    } catch (error: any) {
      metrics.youtube.error = error?.message || String(error)
    }
  }

  if (videoIds.instagramId && process.env.INSTAGRAM_ACCESS_TOKEN) {
    try {
      const apiVersion = process.env.INSTAGRAM_API_VERSION || 'v20.0'
      const host = process.env.INSTAGRAM_API_HOST || 'graph.facebook.com'
      const response = await axios.get(`https://${host}/${apiVersion}/${videoIds.instagramId}?fields=like_count,comments_count,reach,video_view_count`, {
        headers: { Authorization: 'Bearer ' + process.env.INSTAGRAM_ACCESS_TOKEN },
        timeout: 60000
      })
      metrics.instagram = {
        views: Number(response.data?.video_view_count || 0),
        likes: Number(response.data?.like_count || 0),
        comments: Number(response.data?.comments_count || 0),
        reach: Number(response.data?.reach || 0)
      }
    } catch (error: any) {
      metrics.instagram.error = error?.message || String(error)
    }
  }

  if (videoIds.facebookId) {
    try {
      const accessToken = pickEnv(['FB_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN'])
      if (accessToken) {
        const apiVersion = process.env.FACEBOOK_API_VERSION || process.env.INSTAGRAM_API_VERSION || 'v20.0'
        const host = process.env.FACEBOOK_API_HOST || 'graph.facebook.com'
        const summary = await axios.get(`https://${host}/${apiVersion}/${videoIds.facebookId}?fields=reactions.summary(true),comments.summary(true),views`, {
          headers: { Authorization: 'Bearer ' + accessToken },
          timeout: 60000
        })
        metrics.facebook = {
          views: Number(summary.data?.views || 0),
          likes: Number(summary.data?.reactions?.summary?.total_count || 0),
          comments: Number(summary.data?.comments?.summary?.total_count || 0)
        }
      }
    } catch (error: any) {
      metrics.facebook.error = error?.message || String(error)
    }
  }

  return metrics
}
