export type CaptionPlatform = 'youtube' | 'instagram' | 'facebook' | 'tiktok' | 'facebook_groups'

const SITE_URL = 'https://www.natureswaysoil.com'

function clamp(text: string, max: number) {
  return String(text || '').slice(0, max)
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

function siteCta() {
  return `Learn more: ${SITE_URL}`
}

export function formatCaption(product: any, scenePlan: any, platform: CaptionPlatform) {
  const title = String(product?.name || '').trim()
  const description = String(product?.description || '').trim()
  const hook = String(scenePlan?.scenes?.[0]?.voiceover || scenePlan?.scenes?.[0]?.caption || '').trim()
  const tags = hashtags(platform).join(' ')

  if (platform === 'youtube') {
    const lines = [title, description, siteCta(), tags]
    return clamp(lines.filter(Boolean).join('\n\n'), 5000)
  }

  if (platform === 'instagram') {
    const lines = [title, hook || description, siteCta(), tags]
    return clamp(lines.filter(Boolean).join('\n\n'), 2200)
  }

  if (platform === 'tiktok') {
    const firstLine = hook || `Soil-first support with ${title}`
    const lines = [`${firstLine}\n${siteCta()}`, description, tags]
    return clamp(lines.filter(Boolean).join('\n\n'), 2200)
  }

  const lines = [title, description, `See full details at ${SITE_URL}.`, tags]
  return clamp(lines.filter(Boolean).join('\n\n'), 63206)
}
