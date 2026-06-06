import { generateVoiceover } from './narration'

export async function createNarration(product: any, scenePlan: any, profile: any, outDir: string) {
  const requested = String(process.env.VIDEO_PROVIDER || 'did').toLowerCase()
  const provider = requested === 'ffmpeg' ? 'ffmpeg' : 'did'

  if (provider === 'ffmpeg') return ''

  if (!process.env.DID_API_KEY && !process.env.DiD && !process.env.DID) {
    console.log('Narration skipped: missing DID credentials')
    return ''
  }

  if (requested === 'heygen') {
    console.log('VIDEO_PROVIDER=heygen requested but D-ID is enforced for this automation; using D-ID narration')
  }

  return await generateVoiceover(product, scenePlan, profile, outDir)
}
