import fs from 'fs'
import path from 'path'
import axios from 'axios'

const ROOT = process.cwd()
const GROUPS_CONFIG = path.resolve(ROOT, 'config/facebook-groups.json')

function readJson(file: string, fallback: any) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function inferTopics(product: any): string[] {
  const text = `${product?.name || ''} ${product?.category || ''} ${(product?.keywords || []).join(' ')}`.toLowerCase()
  const topics = new Set<string>()
  if (/pasture|hay|field|farm|horse|cattle/.test(text)) topics.add('pasture')
  if (/garden|compost|worm|biochar|vegetable|flower|plant/.test(text)) topics.add('garden')
  if (/lawn|grass|turf|dog|urine|humic|fulvic|kelp/.test(text)) topics.add('lawn')
  if (!topics.size) topics.add('lawn')
  return Array.from(topics)
}

export async function postToFacebookGroup(groupId: string, publicVideoUrl: string, captionText: string) {
  const accessToken = process.env.FACEBOOK_GROUPS_ACCESS_TOKEN
  if (!accessToken) throw new Error('Missing FACEBOOK_GROUPS_ACCESS_TOKEN')
  if (!/^https?:\/\//i.test(String(publicVideoUrl || ''))) throw new Error('Facebook group posting requires a public HTTPS video URL')
  const apiVersion = process.env.FACEBOOK_API_VERSION || 'v20.0'
  const host = process.env.FACEBOOK_API_HOST || 'graph.facebook.com'
  const url = `https://${host}/${apiVersion}/${groupId}/videos`
  const response = await axios.post(url, {
    file_url: publicVideoUrl,
    description: captionText,
    published: true
  }, { headers: { Authorization: 'Bearer ' + accessToken }, timeout: 120000 })
  const id = response.data?.id || ''
  if (!id) throw new Error(`Facebook group ${groupId} did not return video id`)
  return id
}

export async function postToFacebookGroups(product: any, publicVideoUrl: string, captionText: string) {
  const config = readJson(GROUPS_CONFIG, { allowedGroupIds: [], routes: [] })
  const allowed = new Set((config.allowedGroupIds || []).map((id: string) => String(id)))
  const topics = inferTopics(product)
  const routes = (config.routes || []).filter((route: any) => {
    const routeTopics = Array.isArray(route.topics) ? route.topics : []
    const groupId = String(route.groupId || '')
    return groupId && allowed.has(groupId) && routeTopics.some((topic: string) => topics.includes(topic))
  })

  const results: any[] = []
  for (const route of routes) {
    try {
      const id = await postToFacebookGroup(String(route.groupId), publicVideoUrl, captionText)
      results.push({ groupId: String(route.groupId), label: route.label, id, ok: true })
    } catch (error: any) {
      results.push({ groupId: String(route.groupId), label: route.label, ok: false, error: error?.message || error })
    }
  }
  return results
}
