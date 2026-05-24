// @ts-nocheck
import 'dotenv/config'
import axios from 'axios'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

const SECRET_NAMES = [
  'DID_API_KEY',
  'DID_API_ENDPOINT',
  // Backward compatibility aliases
  'HEYGEN_API_KEY',
  'HEYGEN_API_ENDPOINT',
]

function good(value?: string) {
  return !!value && !/your_|your-|changeme|placeholder|paste_|replace_/i.test(value)
}

function variants(name: string) {
  const upper = name.replace(/[\s-]+/g, '_').toUpperCase()
  return [...new Set([upper, upper.toLowerCase().replace(/_/g, '-'), upper.toLowerCase()])]
}

function normalizeEnv() {
  if (!good(process.env.DID_API_KEY) && good(process.env.HEYGEN_API_KEY)) process.env.DID_API_KEY = process.env.HEYGEN_API_KEY
  if (!good(process.env.DID_API_ENDPOINT) && good(process.env.HEYGEN_API_ENDPOINT)) process.env.DID_API_ENDPOINT = process.env.HEYGEN_API_ENDPOINT
}

async function loadSecrets() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'natureswaysoil-video'
  const client = new SecretManagerServiceClient()
  for (const name of SECRET_NAMES) {
    if (good(process.env[name])) continue
    for (const candidate of variants(name)) {
      try {
        const [version] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${candidate}/versions/latest` })
        const value = version.payload?.data?.toString().trim()
        if (value) {
          process.env[name] = value
          console.log(`Loaded secret: ${candidate}`)
          break
        }
      } catch (error: any) {
        if (Number(error?.code) === 5) continue
        console.log(`Could not load ${candidate}: ${error?.message || error}`)
        break
      }
    }
  }
}

function printRows(title: string, rows: any[], pick: (row: any) => any) {
  console.log(`\n${title}`)
  console.log('='.repeat(title.length))
  rows.slice(0, Number(process.env.LIMIT || 60)).forEach((row: any, index: number) => {
    console.log(`${index + 1}. ${JSON.stringify(pick(row), null, 2)}`)
  })
}

function authHeader(apiKey: string): string {
  const trimmed = String(apiKey || '').trim()
  if (/^(basic|bearer)\s+/i.test(trimmed)) return trimmed
  return `Basic ${trimmed}`
}

async function main() {
  await loadSecrets()
  normalizeEnv()

  if (!process.env.DID_API_KEY) throw new Error('Missing DID_API_KEY')
  const endpoint = (process.env.DID_API_ENDPOINT || 'https://api.d-id.com').replace(/\/$/, '')
  const headers = { Authorization: authHeader(process.env.DID_API_KEY) }
  const limit = Number(process.env.LIMIT || 60)

  const presenterRes = await axios.get(`${endpoint}/clips/presenters`, { headers, params: { limit }, timeout: 60000 })
  const voiceRes = await axios.get(`${endpoint}/voices`, { headers, params: { limit }, timeout: 60000 })

  const presenters = presenterRes.data?.presenters || presenterRes.data?.data?.presenters || presenterRes.data?.data || []
  const voices = voiceRes.data?.voices || voiceRes.data?.data?.voices || voiceRes.data?.data || []

  printRows('Available DiD Presenters', presenters, (p) => ({
    presenter_id: p.presenter_id || p.id,
    name: p.presenter_name || p.name,
    gender: p.gender,
    access: p.access,
    preview: p.preview_url || p.thumbnail_url,
  }))

  printRows('Available DiD Voices', voices, (v) => ({
    voice_id: v.voice_id || v.id,
    name: v.name,
    provider: v.provider?.type || v.provider || 'unknown',
    language: v.language || v.locale,
    access: v.access,
    preview: v.preview_audio || v.preview_url,
  }))

  console.log('\nUse presenter_id and voice_id in config/creative-profiles.json (didAvatarId / didVoiceId) or set DID_AVATAR_* env vars.')
}

main().catch((error) => {
  console.error('DiD asset listing failed:', error?.message || error)
  process.exit(1)
})