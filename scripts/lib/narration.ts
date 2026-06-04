// @ts-nocheck
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { execSync } from 'child_process'
import { createDidVideo, pollDidVideo } from './did-provider'
import { ensureDir, safeFileName } from './video-utils'

/**
 * Generate a voiceover audio file for the b-roll/Ken Burns pipeline.
 *
 * D-ID's /talks endpoint returns a talking-avatar MP4. This pipeline does NOT
 * show the avatar — it only needs the narration — so we generate the talk,
 * download the MP4, and extract a normalised AAC audio track. The compositor
 * then muxes that audio and times the visuals to it.
 *
 * Returns a local audio path, or '' on any failure (caller keeps posting,
 * just silent — so narration problems can never take the whole job down).
 */
export async function generateVoiceover(product: any, scenePlan: any, profile: any, outDir: string): Promise<string> {
  const script = (scenePlan?.fullVoiceover || (scenePlan?.scenes || []).map((s: any) => s.voiceover).filter(Boolean).join(' ') || '').trim()
  if (!script) {
    console.log('Narration skipped: empty script')
    return ''
  }

  ensureDir(outDir)
  const talkMp4 = path.resolve(outDir, `narration-${safeFileName(product.id || product.name, 'mp4')}`)
  const audioOut = path.resolve(outDir, `voiceover-${safeFileName(product.id || product.name, 'm4a')}`)

  try {
    const id = await createDidVideo(product, { ...scenePlan, fullVoiceover: script }, profile)
    const resultUrl = await pollDidVideo(id)
    if (!resultUrl) {
      console.log('Narration skipped: D-ID returned no result_url')
      return ''
    }

    // download the talk mp4
    const response = await axios.get(resultUrl, { responseType: 'stream', timeout: 180000 })
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(talkMp4)
      response.data.pipe(writer)
      writer.on('finish', resolve)
      writer.on('error', reject)
    })

    // extract + loudness-normalise the audio (drop the avatar video)
    execSync([
      'ffmpeg -y -loglevel error',
      `-i "${talkMp4}"`,
      '-vn',
      '-af "loudnorm=I=-16:TP=-1.5:LRA=11"',
      '-c:a aac -b:a 192k',
      `"${audioOut}"`
    ].join(' '), { stdio: 'inherit' })

    if (fs.existsSync(audioOut) && fs.statSync(audioOut).size > 0) {
      console.log('Narration ready', { audioOut })
      try { fs.unlinkSync(talkMp4) } catch {}
      return audioOut
    }
    console.log('Narration skipped: audio extraction produced no output')
    return ''
  } catch (error: any) {
    console.log('Narration generation failed; continuing without audio', { error: error?.message || error })
    try { if (fs.existsSync(talkMp4)) fs.unlinkSync(talkMp4) } catch {}
    return ''
  }
}
