import axios from 'axios'
import crypto from 'crypto'
import { google } from 'googleapis'

function pickEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

// ---------------------------------------------------------------------------
// Twitter / X  OAuth 1.0a helper + video posting
// Secrets: TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
// ---------------------------------------------------------------------------
function twEnc(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}
function twOAuthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  creds: { apiKey: string; apiSecret: string; token: string; tokenSecret: string }
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.token,
    oauth_version: '1.0',
  }
  const allParams: Record<string, string> = { ...oauth, ...params }
  const paramString = Object.keys(allParams).sort()
    .map((k) => `${twEnc(k)}=${twEnc(allParams[k])}`).join('&')
  const baseString = [method.toUpperCase(), twEnc(url.split('?')[0]), twEnc(paramString)].join('&')
  const signingKey = `${twEnc(creds.apiSecret)}&${twEnc(creds.tokenSecret)}`
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64')
  return 'OAuth ' + Object.keys(oauth).sort().map((k) => `${twEnc(k)}="${twEnc(oauth[k])}"`).join(', ')
}

export async function postToTwitter(videoUrl: string, caption: string) {
  const apiKey = process.env.TWITTER_API_KEY
  const apiSecret = process.env.TWITTER_API_SECRET
  const token = process.env.TWITTER_ACCESS_TOKEN
  const tokenSecret = process.env.TWITTER_ACCESS_SECRET
  if (!apiKey || !apiSecret || !token || !tokenSecret) {
    console.log('Twitter posting skipped: missing TWITTER_API_KEY/API_SECRET/ACCESS_TOKEN/ACCESS_SECRET')
    return { skipped: true }
  }
  const creds = { apiKey, apiSecret, token, tokenSecret }
  const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json'

  // 1. Download MP4 into memory
  const dl = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 180000 })
  const videoBuffer = Buffer.from(dl.data)
  const totalBytes = videoBuffer.length

  // 2. INIT
  const initParams: Record<string, string> = { command: 'INIT', total_bytes: String(totalBytes), media_type: 'video/mp4', media_category: 'tweet_video' }
  const initRes = await axios.post(uploadUrl, new URLSearchParams(initParams).toString(), {
    headers: { Authorization: twOAuthHeader('POST', uploadUrl, initParams, creds), 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 60000,
  })
  const mediaId = initRes.data?.media_id_string
  if (!mediaId) throw new Error(`Twitter INIT failed: ${JSON.stringify(initRes.data)}`)

  // 3. APPEND in <=4MB chunks (native FormData/Blob, Node 18+). OAuth signs non-file fields only.
  const CHUNK = 4 * 1024 * 1024
  let segment = 0
  for (let offset = 0; offset < totalBytes; offset += CHUNK) {
    const chunk = videoBuffer.subarray(offset, Math.min(offset + CHUNK, totalBytes))
    const appendFields: Record<string, string> = { command: 'APPEND', media_id: mediaId, segment_index: String(segment) }
    const form = new FormData()
    form.append('command', 'APPEND')
    form.append('media_id', mediaId)
    form.append('segment_index', String(segment))
    form.append('media', new Blob([chunk]))
    await axios.post(uploadUrl, form, {
      headers: { Authorization: twOAuthHeader('POST', uploadUrl, appendFields, creds) },
      maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 120000,
    })
    segment++
  }

  // 4. FINALIZE
  const finParams: Record<string, string> = { command: 'FINALIZE', media_id: mediaId }
  const finRes = await axios.post(uploadUrl, new URLSearchParams(finParams).toString(), {
    headers: { Authorization: twOAuthHeader('POST', uploadUrl, finParams, creds), 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 60000,
  })

  // 5. Poll STATUS until processing finishes
  let info = finRes.data?.processing_info
  let waited = 0
  while (info && (info.state === 'pending' || info.state === 'in_progress')) {
    const secs = Math.max(1, Number(info.check_after_secs || 5))
    await new Promise((r) => setTimeout(r, secs * 1000))
    waited += secs
    const statParams: Record<string, string> = { command: 'STATUS', media_id: mediaId }
    const statRes = await axios.get(`${uploadUrl}?command=STATUS&media_id=${mediaId}`, {
      headers: { Authorization: twOAuthHeader('GET', uploadUrl, statParams, creds) }, timeout: 60000,
    })
    info = statRes.data?.processing_info
    if (waited > 300) throw new Error('Twitter media processing timed out')
  }
  if (info && info.state === 'failed') throw new Error(`Twitter media processing failed: ${JSON.stringify(info)}`)

  // 6. Create tweet (v2) with media id
  const tweetUrl = 'https://api.twitter.com/2/tweets'
  const tweetRes = await axios.post(tweetUrl, { text: caption.slice(0, 280), media: { media_ids: [mediaId] } }, {
    headers: { Authorization: twOAuthHeader('POST', tweetUrl, {}, creds), 'Content-Type': 'application/json' }, timeout: 60000,
  })
  const tweetId = tweetRes.data?.data?.id
  if (!tweetId) throw new Error(`Twitter tweet create failed: ${JSON.stringify(tweetRes.data)}`)
  return { platform: 'twitter', tweetId, mediaId }
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
  const init = await axios.post(`https://${host}/v2/post/publish/video/init/`, {
    post_info: { title: caption.slice(0, 2200), privacy_level: 'PUBLIC_TO_EVERYONE', disable_duet: false, disable_comment: false, disable_stitch: false },
    source_info: { source: 'PULL_FROM_URL', video_url: videoUrl }
  }, { headers: { Authorization: 'Bearer ' + accessToken }, timeout: 120000 })

  const publishId = init.data?.data?.publish_id || init.data?.publish_id || ''
  if (!publishId) throw new Error(`TikTok init failed: ${JSON.stringify(init.data)}`)

  return { platform: 'tiktok', publishId, status: init.data?.data?.status || init.data?.status || 'submitted' }
}

export async function postToFacebookReels(videoUrl: string, caption: string) {
  if (!process.env.FACEBOOK_PAGE_ACCESS_TOKEN || !process.env.FACEBOOK_PAGE_ID) {
    console.log('Facebook Reels skipped: missing page credentials')
    return { skipped: true }
  }
  return { platform: 'facebook_reels', queued: true, videoUrl, caption }
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
        metrics.youtube = { views: Number(stats?.viewCount || 0), likes: Number(stats?.likeCount || 0), comments: Number(stats?.commentCount || 0) }
      }
    } catch (error: any) { metrics.youtube.error = error?.message || String(error) }
  }
  if (videoIds.instagramId && process.env.INSTAGRAM_ACCESS_TOKEN) {
    try {
      const apiVersion = process.env.INSTAGRAM_API_VERSION || 'v20.0'
      const host = process.env.INSTAGRAM_API_HOST || 'graph.facebook.com'
      const response = await axios.get(`https://${host}/${apiVersion}/${videoIds.instagramId}?fields=like_count,comments_count,reach,video_view_count`, {
        headers: { Authorization: 'Bearer ' + process.env.INSTAGRAM_ACCESS_TOKEN }, timeout: 60000
      })
      metrics.instagram = { views: Number(response.data?.video_view_count || 0), likes: Number(response.data?.like_count || 0), comments: Number(response.data?.comments_count || 0), reach: Number(response.data?.reach || 0) }
    } catch (error: any) { metrics.instagram.error = error?.message || String(error) }
  }
  if (videoIds.facebookId) {
    try {
      const accessToken = pickEnv(['FB_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN'])
      if (accessToken) {
        const apiVersion = process.env.FACEBOOK_API_VERSION || process.env.INSTAGRAM_API_VERSION || 'v20.0'
        const host = process.env.FACEBOOK_API_HOST || 'graph.facebook.com'
        const summary = await axios.get(`https://${host}/${apiVersion}/${videoIds.facebookId}?fields=reactions.summary(true),comments.summary(true),views`, {
          headers: { Authorization: 'Bearer ' + accessToken }, timeout: 60000
        })
        metrics.facebook = { views: Number(summary.data?.views || 0), likes: Number(summary.data?.reactions?.summary?.total_count || 0), comments: Number(summary.data?.comments?.summary?.total_count || 0) }
      }
    } catch (error: any) { metrics.facebook.error = error?.message || String(error) }
  }
  return metrics
}
