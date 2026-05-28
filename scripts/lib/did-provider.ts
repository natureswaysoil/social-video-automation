// @ts-nocheck
import axios from 'axios'

function pickDidApiKey() {
  return process.env.DID_API_KEY || process.env.DiD || process.env.DID || ''
}

function formatAxiosError(error: any) {
  const status = error?.response?.status
  const data = error?.response?.data
  const message = error?.message || String(error)
  return JSON.stringify({ status, message, data }, null, 2)
}

function authHeaders() {
  const apiKey = pickDidApiKey()
  if (!apiKey) throw new Error('Missing DID_API_KEY. Google Secret Manager alias DiD is supported by validate-config.')
  return {
    Authorization: `Basic ${apiKey}`,
    'Content-Type': 'application/json'
  }
}

export function didPresenter(profile: any) {
  const url = profile.didPresenterUrl || process.env.DID_PRESENTER_URL || process.env.DID_DEFAULT_PRESENTER_URL || ''
  if (!url) {
    throw new Error('Missing D-ID presenter image URL. Set DID_PRESENTER_URL or DID_DEFAULT_PRESENTER_URL to a publicly accessible HTTPS image URL, or add didPresenterUrl in config/creative-profiles.json.')
  }
  if (!/^https:\/\//i.test(url)) {
    throw new Error(`Invalid D-ID presenter URL. Must be HTTPS: ${url}`)
  }
  return url
}

export function didVoice(profile: any) {
  return profile.didVoiceId || process.env.DID_VOICE_ID || process.env.DID_DEFAULT_VOICE_ID || 'en-US-JennyNeural'
}

export async function createDidVideo(product: any, scenePlan: any, profile: any) {
  const endpoint = process.env.DID_API_ENDPOINT || 'https://api.d-id.com'
  const voiceId = didVoice(profile)
  const presenter = didPresenter(profile)
  const script = scenePlan.fullVoiceover || (scenePlan.scenes || []).map((s: any) => s.voiceover).join(' ')

  const body: any = {
    source_url: presenter,
    script: {
      type: 'text',
      input: script,
      provider: {
        type: process.env.DID_TTS_PROVIDER || 'microsoft',
        voice_id: voiceId
      }
    },
    config: {
      stitch: true,
      fluent: true,
      result_format: 'mp4'
    },
    user_data: JSON.stringify({
      productId: product.id,
      productName: product.name
    })
  }

  try {
    const response = await axios.post(`${endpoint}/talks`, body, {
      headers: authHeaders(),
      timeout: 120000
    })

    const id = response.data?.id
    if (!id) throw new Error(`D-ID did not return talk id: ${JSON.stringify(response.data)}`)
    console.log('D-ID video job created', { id, product: product.name, voiceId, presenter })
    return id
  } catch (error: any) {
    throw new Error(`D-ID create failed: ${formatAxiosError(error)}`)
  }
}

export async function pollDidVideo(id: string) {
  const endpoint = process.env.DID_API_ENDPOINT || 'https://api.d-id.com'
  const timeoutMs = Number(process.env.DID_POLL_TIMEOUT_MS || 1200000)
  const intervalMs = Number(process.env.DID_POLL_INTERVAL_MS || 10000)
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await axios.get(`${endpoint}/talks/${id}`, {
        headers: authHeaders(),
        timeout: 60000
      })

      const data = response.data || {}
      const status = String(data.status || '').toLowerCase()
      console.log('D-ID status', { id, status })

      if ((status === 'done' || status === 'completed') && data.result_url) return data.result_url
      if (status === 'error' || status === 'failed' || data.error) {
        throw new Error(`D-ID failed: ${JSON.stringify(data.error || data)}`)
      }
    } catch (error: any) {
      if (error.message?.startsWith('D-ID failed:')) throw error
      throw new Error(`D-ID poll failed: ${formatAxiosError(error)}`)
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error('D-ID polling timed out')
}
