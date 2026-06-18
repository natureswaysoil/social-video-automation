import fs from 'fs'
import path from 'path'
import { ensureDir, safeFileName, wrapCaption } from './video-utils'
import { ffmpegInstalled } from './ffmpeg'

const ROOT = process.cwd()
const OUTPUT = path.resolve(ROOT, 'output')

export { ffmpegInstalled }

export function buildSubtitleFile(scenes: any[], title: string): string {
  ensureDir(OUTPUT)
  const file = path.resolve(OUTPUT, safeFileName(title, 'srt'))
  let cursor = 0
  let srt = ''

  scenes.forEach((scene: any, index: number) => {
    const start = cursor
    const end = cursor + Number(scene.seconds || 6)
    cursor = end

    const format = (seconds: number) => {
      const h = String(Math.floor(seconds / 3600)).padStart(2, '0')
      const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
      const s = String(Math.floor(seconds % 60)).padStart(2, '0')
      return `${h}:${m}:${s},000`
    }

    srt += `${index + 1}\n`
    srt += `${format(start)} --> ${format(end)}\n`
    srt += `${wrapCaption(scene.voiceover || title)}\n\n`
  })

  fs.writeFileSync(file, srt, 'utf8')
  return file
}

export function buildThumbnailPrompt(product: any) {
  return {
    headline: `SOIL-FIRST SUPPORT`,
    subheadline: product.name,
    visual: 'healthy lawn or pasture with visible product usage'
  }
}

export function buildFfmpegCaptionCommand(videoFile: string, subtitleFile: string, outputFile: string) {
  return `ffmpeg -y -i "${videoFile}" -vf subtitles="${subtitleFile}" -c:a copy "${outputFile}"`
}
