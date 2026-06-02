// @ts-nocheck
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { ensureDir, safeFileName } from './video-utils'

function shellEscapeText(value: string) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function isImage(file: string) {
  return /\.(png|jpe?g|webp|svg)$/i.test(file)
}

function makeSceneClip(file: string, index: number, seconds: number, outputDir: string) {
  const duration = Math.max(3, Number(seconds || 6))
  const frames = Math.ceil(duration * 30)
  const clip = path.resolve(outputDir, `scene-${Date.now()}-${index}.mp4`)

  if (isImage(file)) {
    const direction = index % 2 === 0
      ? "zoompan=z='min(zoom+0.0018,1.16)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
      : `zoompan=z='min(zoom+0.0015,1.14)':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`

    execSync([
      'ffmpeg -y',
      '-loop 1',
      `-i "${file}"`,
      `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${direction}:d=${frames}:s=1080x1920:fps=30,format=yuv420p"`,
      '-an',
      '-r 30',
      `-frames:v ${frames}`,
      `"${clip}"`
    ].join(' '), { stdio: 'inherit' })
    return clip
  }

  execSync([
    'ffmpeg -y',
    `-stream_loop -1 -t ${duration}`,
    `-i "${file}"`,
    '-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p"',
    '-an',
    '-r 30',
    `"${clip}"`
  ].join(' '), { stdio: 'inherit' })
  return clip
}

export async function composeVerticalAd(input: any) {
  const outputDir = path.resolve(process.cwd(), 'output')
  ensureDir(outputDir)

  const sceneFiles = input.sceneFiles || []
  if (!sceneFiles.length) throw new Error('No scene files provided to compositor')

  const sceneDurations = input.sceneDurations || []
  const sceneClips = sceneFiles.map((file: string, index: number) => makeSceneClip(file, index, sceneDurations[index] || input.sceneSeconds || 6, outputDir))

  const concatList = path.resolve(outputDir, `concat-${Date.now()}.txt`)
  fs.writeFileSync(concatList, sceneClips.map((file: string) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')

  const stitched = path.resolve(outputDir, `stitched-${Date.now()}.mp4`)

  execSync([
    'ffmpeg -y',
    '-f concat -safe 0',
    `-i "${concatList}"`,
    '-c:v libx264',
    '-preset veryfast',
    '-pix_fmt yuv420p',
    '-r 30',
    `"${stitched}"`
  ].join(' '), { stdio: 'inherit' })

  let working = stitched

  if (input.productImage) {
    const productOutput = path.resolve(outputDir, `product-${Date.now()}.mp4`)

    execSync([
      'ffmpeg -y',
      `-i "${working}"`,
      `-loop 1 -i "${input.productImage}"`,
      '-filter_complex "[1:v]scale=430:-1[prod];[0:v][prod]overlay=40:H-h-80:enable=\'between(t,1,999)\'"',
      '-c:v libx264',
      '-preset veryfast',
      '-pix_fmt yuv420p',
      '-shortest',
      `"${productOutput}"`
    ].join(' '), { stdio: 'inherit' })

    working = productOutput
  }

  if (input.overlayText) {
    const overlayOutput = path.resolve(outputDir, `overlay-${Date.now()}.mp4`)
    const safeOverlay = shellEscapeText(input.overlayText)
    execSync([
      'ffmpeg -y',
      `-i "${working}"`,
      `-vf "drawtext=text='${safeOverlay}':fontcolor=white:fontsize=42:borderw=4:bordercolor=black:x=40:y=90:box=1:boxcolor=black@0.35:boxborderw=18"`,
      '-c:v libx264',
      '-preset veryfast',
      '-pix_fmt yuv420p',
      `"${overlayOutput}"`
    ].join(' '), { stdio: 'inherit' })
    working = overlayOutput
  }

  if (input.captionText) {
    const captionOutput = path.resolve(outputDir, `caption-${Date.now()}.mp4`)
    const safeCaption = shellEscapeText(input.captionText)

    execSync([
      'ffmpeg -y',
      `-i "${working}"`,
      `-vf "drawtext=text='${safeCaption}':fontcolor=white:fontsize=52:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h-260:box=1:boxcolor=black@0.25:boxborderw=18"`,
      '-c:v libx264',
      '-preset veryfast',
      '-pix_fmt yuv420p',
      `"${captionOutput}"`
    ].join(' '), { stdio: 'inherit' })

    working = captionOutput
  }

  const finalOutput = path.resolve(outputDir, `${safeFileName(input.outputName || 'vertical-ad', 'mp4')}`)
  fs.copyFileSync(working, finalOutput)

  return finalOutput
}
