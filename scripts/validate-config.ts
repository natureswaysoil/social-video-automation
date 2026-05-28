// @ts-nocheck
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

const ROOT = process.cwd()
const REQUIRED_FILES = [
  'config/top-products.json',
  'config/creative-profiles.json'
]

const SECRET_ALIASES: Record<string, string[]> = {
  OPENAI_API_KEY: ['OPENAI_API_KEY', 'openai-api-key'],
  PEXELS_API_KEY: ['PEXELS_API_KEY', 'pexels-api-key'],
  HEYGEN_API_KEY: ['HEYGEN_API_KEY', 'heygen-api-key'],
  DID_API_KEY: ['DID_API_KEY', 'did-api-key', 'DiD'],
  YOUTUBE_CLIENT_ID: ['YOUTUBE_CLIENT_ID', 'YT_CLIENT_ID'],
  YOUTUBE_CLIENT_SECRET: ['YOUTUBE_CLIENT_SECRET', 'YT_CLIENT_SECRET'],
  YOUTUBE_REFRESH_TOKEN: ['YOUTUBE_REFRESH_TOKEN', 'YT_REFRESH_TOKEN'],
  INSTAGRAM_ACCESS_TOKEN: ['INSTAGRAM_ACCESS_TOKEN'],
  INSTAGRAM_IG_ID: ['INSTAGRAM_IG_ID', 'INSTAGRAM_USER_ID', 'INSTAGRAM_ACCOUNT_ID']
}

function good(value?: string) {
  return !!value && !/your_|your-|changeme|placeholder|paste_|replace_/i.test(value)
}

function normalizeCandidates(name: string) {
  const upper = name.replace(/[\s-]+/g, '_').toUpperCase()
  return [...new Set([name, upper, upper.toLowerCase(), upper.toLowerCase().replace(/_/g, '-')])]
}

async function loadSecretIfPresent(name: string) {
  if (good(process.env[name])) return true
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'natureswaysoil-video'
  const client = new SecretManagerServiceClient()
  const aliases = SECRET_ALIASES[name] || [name]
  for (const alias of aliases.flatMap(normalizeCandidates)) {
    try {
      const [version] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${alias}/versions/latest` })
      const value = version.payload?.data?.toString().trim()
      if (value) {
        process.env[name] = value
        if (alias === 'DiD') process.env.DID_API_KEY = value
        return true
      }
    } catch (error: any) {
      if (Number(error?.code) === 5 || String(error?.message || '').includes('NOT_FOUND')) continue
    }
  }
  return false
}

function checkFiles() {
  const results = []
  for (const file of REQUIRED_FILES) {
    const full = path.resolve(ROOT, file)
    const exists = fs.existsSync(full)
    results.push({ check: `file:${file}`, ok: exists })
    if (exists && file.endsWith('.json')) {
      try { JSON.parse(fs.readFileSync(full, 'utf8')) }
      catch (error: any) { results.push({ check: `json:${file}`, ok: false, detail: error.message }) }
    }
  }
  return results
}

async function checkPexels() {
  if (!good(process.env.PEXELS_API_KEY)) return { check: 'pexels', ok: false, detail: 'Missing PEXELS_API_KEY' }
  try {
    const res = await axios.get('https://api.pexels.com/videos/search', {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      params: { query: 'healthy lawn', orientation: 'portrait', per_page: 1 },
      timeout: 15000
    })
    return { check: 'pexels', ok: Array.isArray(res.data?.videos), detail: `videos:${res.data?.videos?.length || 0}` }
  } catch (error: any) {
    return { check: 'pexels', ok: false, detail: error?.response?.data || error.message }
  }
}

async function main() {
  const provider = String(process.env.VIDEO_PROVIDER || 'heygen').toLowerCase()
  const platforms = String(process.env.ENABLE_PLATFORMS || 'youtube,instagram').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)

  const requiredSecrets = ['OPENAI_API_KEY', 'PEXELS_API_KEY']
  if (provider === 'heygen') requiredSecrets.push('HEYGEN_API_KEY')
  if (provider === 'did') requiredSecrets.push('DID_API_KEY')
  if (platforms.includes('youtube')) requiredSecrets.push('YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN')
  if (platforms.includes('instagram')) requiredSecrets.push('INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_IG_ID')

  const results: any[] = []
  results.push(...checkFiles())

  for (const secret of requiredSecrets) {
    const ok = await loadSecretIfPresent(secret)
    results.push({ check: `secret:${secret}`, ok })
  }

  results.push(await checkPexels())

  const failed = results.filter(r => !r.ok)
  for (const result of results) {
    console.log(`${result.ok ? '✅' : '❌'} ${result.check}${result.detail ? ` — ${JSON.stringify(result.detail)}` : ''}`)
  }

  if (failed.length) {
    console.error(`\nValidation failed: ${failed.length} issue(s).`)
    process.exit(1)
  }

  console.log('\nValidation passed. Automation is ready for a dry run or scheduled post.')
}

main().catch((error) => {
  console.error('Validation crashed:', error?.message || error)
  process.exit(1)
})
