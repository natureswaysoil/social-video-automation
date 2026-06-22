export type CaptionPlatform = 'youtube' | 'instagram' | 'facebook' | 'tiktok' | 'facebook_groups'
const SITE_URL = 'https://www.natureswaysoil.com'
function clamp(text: string, max: number) {
  return String(text || '').slice(0, max)
}
function productUrl(product: any) {
  const u = String(product?.websiteUrl || '').trim()
  return u || SITE_URL
}
function hashtags(platform: CaptionPlatform) {
  if (platform === 'instagram') {
    return [
      '#NaturesWaySoil', '#SoilHealth', '#LawnCare', '#GardenTips', '#PastureCare',
      '#OrganicGardening', '#Homesteading', '#RegenerativeAgriculture', '#HealthySoil', '#LawnRepair',
      '#GardenSoil', '#RootHealth', '#PlantCare', '#BackyardGarden', '#SoilBiology',
      '#GrassCare', '#TurfCare', '#GardenLife', '#FarmLife', '#Compost', '#Biochar',
      '#HumicAcid', '#FulvicAcid', '#Kelp', '#SoilFirst'
    ]
  }
  if (platform === 'tiktok') return ['#NaturesWaySoil', '#LawnCare', '#SoilHealth', '#GardenTips', '#PastureCare']
  if (platform === 'youtube') return ['#NaturesWaySoil', '#SoilHealth', '#LawnCare', '#Gardening', '#PastureCare']
  return ['#NaturesWaySoil', '#SoilHealth', '#LawnCare', '#Gardening']
}
function siteCta(product: any) {
  return `Shop now: ${productUrl(product)}`
}
export function formatCaption(product: any, scenePlan: any, platform: CaptionPlatform) {
  const title = String(product?.name || '').trim()
  const description = String(product?.description || '').trim()
  const hook = String(scenePlan?.scenes?.[0]?.voiceover || scenePlan?.scenes?.[0]?.caption || '').trim()
  const tags = hashtags(platform).join(' ')
  if (platform === 'youtube') {
    const lines = [title, description, siteCta(product), tags]
    return clamp(lines.filter(Boolean).join('\n\n'), 5000)
  }
  if (platform === 'instagram') {
    const lines = [title, hook || description, siteCta(product), tags]
    return clamp(lines.filter(Boolean).join('\n\n'), 2200)
  }
  if (platform === 'tiktok') {
    const firstLine = hook || `Soil-first support with ${title}`
    const lines = [`${firstLine}\n${siteCta(product)}`, description, tags]
    return clamp(lines.filter(Boolean).join('\n\n'), 2200)
  }
  const lines = [title, description, `Shop now: ${productUrl(product)}`, tags]
  return clamp(lines.filter(Boolean).join('\n\n'), 63206)
}
