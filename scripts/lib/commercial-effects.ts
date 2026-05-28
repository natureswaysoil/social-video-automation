// @ts-nocheck
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { ensureDir, safeFileName } from './video-utils'

export function ffmpegEscapeText(text: string) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
}

export function animatedCaptionFilter(text: string, style = 'hook') {
  const safe = ffmpegEscapeText(text)
  const size = style === 'hook' ? 74 : 52
  const y = style === 'hook' ? 'h*0.16' : 'h-300'
  return `drawtext=text='${safe}':fontcolor=white:fontsize=${size}:borderw=6:bordercolor=black:x=(w-text_w)/2:y=${y}:enable='between(t,0,5)'`
}

export function ctaFilter(text: string) {
  const safe = ffmpegEscapeText(text)
  return `drawtext=text='${safe}':fontcolor=white:fontsize=48:borderw=5:bordercolor=black:box=1:boxcolor=black@0.45:boxborderw=20:x=(w-text_w)/2:y=h-220:enable='gte(t,4)'`
}

export function circlePipFilter(size = 320) {
  // Practical PIP crop. True circular alpha masks vary by ffmpeg build, so this uses rounded-safe corner placement.
  return `[1:v]scale=${size}:-1[pip];[0:v][pip]overlay=W-w-36:H-h-72`
}

export function buildSplitScreen(beforeFile: string, afterFile: string, outputFile: string) {
  ensureDir(path.dirname(outputFile))
  const cmd = [
    'ffmpeg -y',
    `-i "${beforeFile}"`,
    `-i "${afterFile}"`,
    '-filter_complex "[0:v]scale=540:1920:force_original_aspect_ratio=increase,crop=540:1920[left];[1:v]scale=540:1920:force_original_aspect_ratio=increase,crop=540:1920[right];[left][right]hstack=inputs=2,drawtext=text=BEFORE:fontcolor=white:fontsize=56:borderw=5:bordercolor=black:x=120:y=120,drawtext=text=AFTER:fontcolor=white:fontsize=56:borderw=5:bordercolor=black:x=700:y=120"',
    '-r 30 -pix_fmt yuv420p',
    `"${outputFile}"`
  ].join(' ')
  execSync(cmd, { stdio: 'inherit' })
  return outputFile
}

export function createProductCutoutPlaceholder(productImage: string, outputDir: string) {
  if (!productImage || !fs.existsSync(productImage)) return ''
  ensureDir(outputDir)
  const output = path.resolve(outputDir, `${safeFileName(path.basename(productImage, path.extname(productImage)), 'png')}`)
  // Simple transparent-canvas prep placeholder. True background removal should be handled by an image segmentation API later.
  const cmd = `ffmpeg -y -i "${productImage}" -vf "scale=520:-1" "${output}"`
  execSync(cmd, { stdio: 'inherit' })
  return output
}

export function mixSoundtrack(videoFile: string, musicFile: string, outputFile: string) {
  if (!musicFile || !fs.existsSync(musicFile)) return videoFile
  ensureDir(path.dirname(outputFile))
  const cmd = [
    'ffmpeg -y',
    `-i "${videoFile}"`,
    `-i "${musicFile}"`,
    '-filter_complex "[1:a]volume=0.12[a1];[0:a][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]"',
    '-map 0:v -map "[aout]" -c:v copy -c:a aac -shortest',
    `"${outputFile}"`
  ].join(' ')
  execSync(cmd, { stdio: 'inherit' })
  return outputFile
}
