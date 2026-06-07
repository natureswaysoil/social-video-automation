import { generateVoiceover } from './narration'

export async function createNarration(product: any, scenePlan: any, profile: any, outDir: string) {
  const requested = String(process.env.VIDEO_PROVIDER || 'openai_tts').toLowerCase()

  if (requested !== 'openai_tts') {
    console.log(`VIDEO_PROVIDER=${requested} requested but OpenAI TTS is enforced for this automation`)
  }

  return await generateVoiceover(product, scenePlan, profile, outDir)
}
