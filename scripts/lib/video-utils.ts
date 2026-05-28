// @ts-nocheck
import fs from 'fs'
import path from 'path'

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

export function slugify(input: string) {
  return String(input || 'video')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'video'
}

export function wrapCaption(text: string, max = 28) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > max && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 3).join('\\n')
}

export function safeFileName(input: string, ext = '') {
  const base = slugify(input)
  return ext ? `${base}.${ext.replace(/^\./, '')}` : base
}

export function readJson(file: string, fallback: any) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file: string, data: any) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

export function pickHook(product: any, profile: any, analytics: any) {
  const hooks = Array.isArray(profile?.hooks) && profile.hooks.length
    ? profile.hooks
    : [
        `Stop treating the grass. Start feeding the soil.`,
        `Your lawn problem may actually be a soil problem.`,
        `This is a better way to support stressed grass.`,
        `For better growth, start below the surface.`
      ]

  const scores = analytics?.hookScores || {}
  const ranked = hooks
    .map((hook: string, index: number) => ({ hook, index, score: Number(scores[hook]?.score || 0), uses: Number(scores[hook]?.uses || 0) }))
    .sort((a: any, b: any) => (b.score - a.score) || (a.uses - b.uses) || (a.index - b.index))

  return ranked[0]?.hook || hooks[0]
}

export function recordHookUse(analyticsFile: string, hook: string, productId: string) {
  const analytics = readJson(analyticsFile, { hookScores: {}, productRuns: {} })
  analytics.hookScores[hook] = analytics.hookScores[hook] || { uses: 0, score: 0 }
  analytics.hookScores[hook].uses += 1
  analytics.productRuns[productId] = analytics.productRuns[productId] || { runs: 0 }
  analytics.productRuns[productId].runs += 1
  analytics.lastUpdatedAt = new Date().toISOString()
  writeJson(analyticsFile, analytics)
  return analytics
}
