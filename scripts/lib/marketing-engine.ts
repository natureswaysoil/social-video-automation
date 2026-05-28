// @ts-nocheck
import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { readJson, writeJson, slugify } from './video-utils'

const ROOT = process.cwd()
const ANALYTICS_FILE = path.resolve(ROOT, process.env.VIDEO_ANALYTICS_FILE || 'data/video-analytics.json')
const TRENDS_FILE = path.resolve(ROOT, process.env.TRENDS_FILE || 'data/trends.json')

export function amazonAttributionUrl(product: any, campaign = 'social_video') {
  const base = product.amazonUrl || product.websiteUrl || ''
  if (!base) return ''
  const separator = base.includes('?') ? '&' : '?'
  const source = encodeURIComponent(process.env.ATTRIBUTION_SOURCE || 'social')
  const medium = encodeURIComponent(process.env.ATTRIBUTION_MEDIUM || 'short_video')
  const content = encodeURIComponent(slugify(product.name || product.id || 'product'))
  return `${base}${separator}utm_source=${source}&utm_medium=${medium}&utm_campaign=${encodeURIComponent(campaign)}&utm_content=${content}`
}

export function recordPerformance(input: any) {
  const analytics = readJson(ANALYTICS_FILE, { hooks: {}, videos: [] })
  analytics.videos.push({ ...input, recordedAt: new Date().toISOString() })
  if (input.hook) {
    analytics.hooks[input.hook] = analytics.hooks[input.hook] || { uses: 0, views: 0, likes: 0, comments: 0, clicks: 0, score: 0 }
    analytics.hooks[input.hook].uses += 1
    analytics.hooks[input.hook].views += Number(input.views || 0)
    analytics.hooks[input.hook].likes += Number(input.likes || 0)
    analytics.hooks[input.hook].comments += Number(input.comments || 0)
    analytics.hooks[input.hook].clicks += Number(input.clicks || 0)
    analytics.hooks[input.hook].score =
      analytics.hooks[input.hook].likes * 2 + analytics.hooks[input.hook].comments * 3 + analytics.hooks[input.hook].clicks * 5 + analytics.hooks[input.hook].views * 0.01
  }
  analytics.lastUpdatedAt = new Date().toISOString()
  writeJson(ANALYTICS_FILE, analytics)
  return analytics
}

export function pickABVariant(product: any) {
  const analytics = readJson(ANALYTICS_FILE, { hooks: {}, videos: [] })
  const candidates = [
    'problem_first',
    'before_after',
    'product_demo',
    'soil_science_simple',
    'price_value',
    'farmer_plainspoken'
  ]
  const counts = Object.fromEntries(candidates.map((c) => [c, 0]))
  for (const video of analytics.videos || []) {
    if (video.productId === product.id && video.variant && counts[video.variant] !== undefined) counts[video.variant]++
  }
  return candidates.sort((a, b) => counts[a] - counts[b])[0]
}

export async function generateTrendAwareHooks(product: any, profile: any) {
  const trends = readJson(TRENDS_FILE, { trends: [] })
  if (!process.env.OPENAI_API_KEY) return profile.hooks || []
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const prompt = `Create 8 short high-retention hooks for a vertical video ad.
Product: ${product.name}
Description: ${product.description}
Audience: ${profile.audience || 'homeowners, gardeners, lawn care, pasture owners'}
Current trend notes: ${(trends.trends || []).slice(0, 10).join(' | ')}
Rules: no exaggerated guarantees, no disease/pesticide claims, sound natural, first 3 seconds only.
Return JSON only: {"hooks":["..."]}`
  const res = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: 500 })
  const text = res.choices[0]?.message?.content || ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return profile.hooks || []
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed.hooks) ? parsed.hooks : (profile.hooks || [])
  } catch {
    return profile.hooks || []
  }
}

export function updateTrendsManually(items: string[]) {
  const payload = { updatedAt: new Date().toISOString(), trends: items.filter(Boolean).slice(0, 50) }
  writeJson(TRENDS_FILE, payload)
  return payload
}
