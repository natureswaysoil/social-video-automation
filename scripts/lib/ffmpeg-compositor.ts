// @ts-nocheck
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { ensureDir, safeFileName } from './video-utils'

export async function composeVerticalAd(input: any) {
  const outputDir = path.resolve(process.cwd(), 'output')
  ensureDir(outputDir)

  const sceneFiles = input.sceneFiles || []
  if (!sceneFiles.length) throw new Error('No scene files provided to compositor')

  const concatList = path.resolve(outputDir, `concat-${Date.now()}.txt`)
  fs.writeFileSync(concatList, sceneFiles.map((file: string) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')

  const stitched = path.resolve(outputDir, `stitched-${Date.now()}.mp4`)

  execSync([
    'ffmpeg -y',
    '-f concat -safe 0',
    `-i "${concatList}"`,
    '-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"',
    '-r 30',
    '-pix_fmt yuv420p',
    `"${stitched}"`
  ].join(' '), { stdio: 'inherit' })

  let working = stitched

  if (input.narratorVideo) {
    const pipOutput = path.resolve(outputDir, `pip-${Date.now()}.mp4`)

    execSync([
      'ffmpeg -y',
      `-i "${working}"`,
      `-i "${input.narratorVideo}"`,
      '-filter_complex "[1:v]scale=320:-1[narr];[0:v][narr]overlay=W-w-40:H-h-80"',
      '-pix_fmt yuv420p',
      `"${pipOutput}"`
    ].join(' '), { stdio: 'inherit' })

    working = pipOutput
  }

  if (input.productImage) {
    const productOutput = path.resolve(outputDir, `product-${Date.now()}.mp4`)

    execSync([
      'ffmpeg -y',
      `-i "${working}"`,
      `-loop 1 -i "${input.productImage}"`,
      '-filter_complex "[1:v]scale=420:-1[prod];[0:v][prod]overlay=40:H-h-80"',
      '-shortest',
      '-pix_fmt yuv420p',
      `"${productOutput}"`
    ].join(' '), { stdio: 'inherit' })

    working = productOutput
  }

  if (input.captionText) {
    const captionOutput = path.resolve(outputDir, `caption-${Date.now()}.mp4`)

    const safeCaption = String(input.captionText)
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'")
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')

    execSync([
      'ffmpeg -y',
      `-i "${working}"`,
      `-vf "drawtext=text='${safeCaption}':fontcolor=white:fontsize=52:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h-260"`,
      '-pix_fmt yuv420p',
      `"${captionOutput}"`
    ].join(' '), { stdio: 'inherit' })

    working = captionOutput
  }

  const finalOutput = path.resolve(outputDir, `${safeFileName(input.outputName || 'vertical-ad', 'mp4')}`)
  fs.copyFileSync(working, finalOutput)

  return finalOutput
}
