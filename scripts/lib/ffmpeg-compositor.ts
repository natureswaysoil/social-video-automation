// @ts-nocheck
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { ensureDir, safeFileName } from './video-utils'

function run(cmd: string) {
  execSync(cmd, { stdio: 'inherit' })
}

function shellEscapeText(value: string) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function isImage(file: string) {
  return /\.(png|jpe?g|webp)$/i.test(file)
}

function probeDuration(file: string): number {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`).toString().trim()
    const n = Number(out)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/**
 * Build ONE scene clip (always 1080x1920, 30fps, no audio).
 *   kind 'product' -> the product image is CONTAINED over a blurred copy of
 *                     itself (never cropped) with a gentle Ken Burns push-in.
 *   kind 'photo'   -> Pexels still: cover-crop to portrait + Ken Burns
 *                     (alternating zoom-in / pan so consecutive stills differ).
 *   kind 'video'   -> Pexels/local clip: cover-crop to portrait, looped/trimmed.
 */
function makeSceneClip(file: string, index: number, seconds: number, kind: string, outputDir: string) {
  const duration = Math.max(3, Number(seconds || 5))
  const frames = Math.ceil(duration * 30)
  const clip = path.resolve(outputDir, `scene-${Date.now()}-${index}.mp4`)
  const resolvedKind = kind || (isImage(file) ? 'photo' : 'video')

  if (resolvedKind === 'product') {
    // contain product over a blurred, cover-filled background of itself
    run([
      'ffmpeg -y -loglevel error',
      '-loop 1',
      `-i "${file}"`,
      `-filter_complex "` +
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:2[bg];` +
        `[0:v]scale=-1:1500:force_original_aspect_ratio=decrease[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,` +
        `zoompan=z='min(zoom+0.0012,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,` +
        `format=yuv420p"`,
      '-an -r 30',
      `-frames:v ${frames}`,
      `"${clip}"`
    ].join(' '))
    return clip
  }

  if (resolvedKind === 'photo') {
    // alternate the Ken Burns move so back-to-back stills feel different
    const move = index % 3 === 0
      ? "zoompan=z='min(zoom+0.0018,1.16)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
      : index % 3 === 1
        ? `zoompan=z='1.12':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`            // pan right
        : `zoompan=z='1.12':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`        // pan left
    run([
      'ffmpeg -y -loglevel error',
      '-loop 1',
      `-i "${file}"`,
      `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${move}:d=${frames}:s=1080x1920:fps=30,format=yuv420p"`,
      '-an -r 30',
      `-frames:v ${frames}`,
      `"${clip}"`
    ].join(' '))
    return clip
  }

  // video
  run([
    'ffmpeg -y -loglevel error',
    `-stream_loop -1 -t ${duration}`,
    `-i "${file}"`,
    '-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p"',
    '-an -r 30',
    `"${clip}"`
  ].join(' '))
  return clip
}

/**
 * composeVerticalAd
 *  Preferred input:
 *    scenes: [{ file, seconds, kind: 'product'|'photo'|'video' }]
 *  Legacy input (still supported):
 *    sceneFiles: string[], sceneDurations?: number[], productImage?: string
 *  Optional:
 *    voiceoverFile  -> audio track (mp3/m4a/wav). Video is timed to it.
 *    captionText, overlayText
 */
export async function composeVerticalAd(input: any) {
  const outputDir = path.resolve(process.cwd(), 'output')
  ensureDir(outputDir)

  // Normalise to a scenes[] array with explicit kinds.
  let scenes = Array.isArray(input.scenes) ? input.scenes.filter((s: any) => s && s.file) : []
  if (!scenes.length) {
    const files = input.sceneFiles || []
    if (!files.length) throw new Error('No scene files provided to compositor')
    const durations = input.sceneDurations || []
    const productImage = input.productImage || ''
    scenes = files.map((file: string, i: number) => ({
      file,
      seconds: durations[i] || input.sceneSeconds || 5,
      kind: (productImage && file === productImage) ? 'product' : (isImage(file) ? 'photo' : 'video')
    }))
  }

  const hasProductScene = scenes.some((s: any) => s.kind === 'product')

  const sceneClips = scenes.map((s: any, i: number) =>
    makeSceneClip(s.file, i, s.seconds, s.kind, outputDir))

  // ---- stitch ----
  const concatList = path.resolve(outputDir, `concat-${Date.now()}.txt`)
  fs.writeFileSync(concatList, sceneClips.map((f: string) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')
  let working = path.resolve(outputDir, `stitched-${Date.now()}.mp4`)
  run([
    'ffmpeg -y -loglevel error',
    '-f concat -safe 0',
    `-i "${concatList}"`,
    '-c:v libx264 -preset veryfast -pix_fmt yuv420p -r 30',
    `"${working}"`
  ].join(' '))

  // ---- product corner watermark (ONLY if there is no full product scene) ----
  if (input.productImage && !hasProductScene) {
    const out = path.resolve(outputDir, `product-${Date.now()}.mp4`)
    run([
      'ffmpeg -y -loglevel error',
      `-i "${working}"`,
      `-loop 1 -i "${input.productImage}"`,
      `-filter_complex "[1:v]scale=430:-1[prod];[0:v][prod]overlay=40:H-h-80:enable='between(t,1,999)'"`,
      '-c:v libx264 -preset veryfast -pix_fmt yuv420p -shortest',
      `"${out}"`
    ].join(' '))
    working = out
  }

  // ---- overlay text (sub-headline, top) ----
  if (input.overlayText) {
    const out = path.resolve(outputDir, `overlay-${Date.now()}.mp4`)
    run([
      'ffmpeg -y -loglevel error',
      `-i "${working}"`,
      `-vf "drawtext=text='${shellEscapeText(input.overlayText)}':fontcolor=white:fontsize=42:borderw=4:bordercolor=black:x=40:y=90:box=1:boxcolor=black@0.35:boxborderw=18"`,
      '-c:v libx264 -preset veryfast -pix_fmt yuv420p',
      `"${out}"`
    ].join(' '))
    working = out
  }

  // ---- caption (hook, lower third) ----
  if (input.captionText) {
    const out = path.resolve(outputDir, `caption-${Date.now()}.mp4`)
    run([
      'ffmpeg -y -loglevel error',
      `-i "${working}"`,
      `-vf "drawtext=text='${shellEscapeText(input.captionText)}':fontcolor=white:fontsize=52:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h-260:box=1:boxcolor=black@0.25:boxborderw=18"`,
      '-c:v libx264 -preset veryfast -pix_fmt yuv420p',
      `"${out}"`
    ].join(' '))
    working = out
  }

  // ---- voiceover: time the video to the audio, then mux ----
  // This is the piece the production path was missing — without it the post
  // is a silent montage. When you wire D-ID/TTS, pass voiceoverFile here.
  if (input.voiceoverFile && fs.existsSync(input.voiceoverFile)) {
    const audioDur = probeDuration(input.voiceoverFile)
    const videoDur = probeDuration(working)
    const out = path.resolve(outputDir, `voiced-${Date.now()}.mp4`)
    if (audioDur > videoDur + 0.3) {
      // hold the last frame so narration isn't cut off
      run([
        'ffmpeg -y -loglevel error',
        `-i "${working}"`,
        `-i "${input.voiceoverFile}"`,
        `-filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=${(audioDur - videoDur).toFixed(2)}[v]"`,
        '-map "[v]" -map 1:a',
        '-c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -shortest',
        `"${out}"`
      ].join(' '))
    } else {
      run([
        'ffmpeg -y -loglevel error',
        `-i "${working}"`,
        `-i "${input.voiceoverFile}"`,
        '-map 0:v -map 1:a',
        '-c:v copy -c:a aac -shortest',
        `"${out}"`
      ].join(' '))
    }
    working = out
  }

  const finalOutput = path.resolve(outputDir, `${safeFileName(input.outputName || 'vertical-ad', 'mp4')}`)
  fs.copyFileSync(working, finalOutput)
  return finalOutput
}
