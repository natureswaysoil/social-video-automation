import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { ensureDir, safeFileName } from './video-utils'
import { runFfmpeg } from './ffmpeg'

/**
 * Generate a voiceover audio file using OpenAI TTS only.
 */
export async function generateVoiceover(product: any, scenePlan: any, profile: any, outDir: string): Promise<string> {
  const script = (scenePlan?.fullVoiceover || (scenePlan?.scenes || []).map((s: any) => s.voiceover).filter(Boolean).join(' ') || '').trim()
  if (!script) {
    console.log('Narration skipped: empty script')
    return ''
  }
  if (!process.env.OPENAI_API_KEY) {
    console.log('Narration skipped: missing OPENAI_API_KEY')
    return ''
  }

  ensureDir(outDir)
  const ttsMp3 = path.resolve(outDir, `tts-${safeFileName(product.id || product.name, 'mp3')}`)
  const audioOut = path.resolve(outDir, `voiceover-${safeFileName(product.id || product.name, 'm4a')}`)

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.TTS_MODEL || 'gpt-4o-mini-tts'
    const voice = process.env.TTS_VOICE || 'alloy'
    const response = await client.audio.speech.create({
      model,
      voice: voice as any,
      input: script,
      format: 'mp3'
    } as any)
    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(ttsMp3, buffer)

    runFfmpeg([
      '-y', '-loglevel', 'error',
      '-i', ttsMp3,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-c:a', 'aac', '-b:a', '192k',
      audioOut
    ])

    if (fs.existsSync(audioOut) && fs.statSync(audioOut).size > 0) {
      console.log('Narration ready', { audioOut })
      try { fs.unlinkSync(ttsMp3) } catch {}
      return audioOut
    }
    if (fs.existsSync(ttsMp3) && fs.statSync(ttsMp3).size > 0) {
      console.log('Narration fallback: using raw mp3 output')
      return ttsMp3
    }
    console.log('Narration skipped: TTS produced no output')
    return ''
  } catch (error: any) {
    console.log('Narration generation failed; continuing without audio', { error: error?.message || error })
    try { if (fs.existsSync(ttsMp3)) fs.unlinkSync(ttsMp3) } catch {}
    return ''
  }
}
