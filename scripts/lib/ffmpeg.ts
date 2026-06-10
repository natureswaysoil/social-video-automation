import { execFileSync } from 'child_process'

/**
 * Centralized, shell-free FFmpeg / FFprobe execution helpers.
 *
 * SECURITY: All callers pass arguments as an ARRAY. Arguments are handed to the
 * binary directly via execFileSync WITHOUT a shell, so file paths, caption text,
 * and filter graphs cannot break out of quoting or inject shell commands. This
 * replaces the previous pattern of building one big shell string with
 * `execSync(\`ffmpeg ... "${userText}" ...\`)`, which was vulnerable to command
 * injection / breakage when text contained quotes or shell metacharacters.
 *
 * NOTE: Values used INSIDE an FFmpeg filtergraph (e.g. drawtext text) must still
 * be escaped for FFmpeg's own filter parser via `escapeFilterText` — that is a
 * separate concern from shell safety, which the array form already guarantees.
 */

export function runFfmpeg(args: string[]): void {
  execFileSync('ffmpeg', args, { stdio: 'inherit' })
}

export function runFfprobe(args: string[]): string {
  return execFileSync('ffprobe', args, { encoding: 'utf8' }).toString().trim()
}

export function ffmpegInstalled(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Escape a string for safe use as the value of an FFmpeg filter option such as
 * `drawtext=text='<value>'`. This is FFmpeg filter-syntax escaping, NOT shell
 * escaping (the array-based exec already removes the shell from the equation).
 */
export function escapeFilterText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

/** Probe a media file's duration in seconds (0 if unknown). */
export function probeDuration(file: string): number {
  try {
    const out = runFfprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
    const n = Number(out)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}
