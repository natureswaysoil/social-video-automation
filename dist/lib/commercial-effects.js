"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ffmpegEscapeText = ffmpegEscapeText;
exports.animatedCaptionFilter = animatedCaptionFilter;
exports.ctaFilter = ctaFilter;
exports.circlePipFilter = circlePipFilter;
exports.buildSplitScreen = buildSplitScreen;
exports.createProductCutoutPlaceholder = createProductCutoutPlaceholder;
exports.mixSoundtrack = mixSoundtrack;
// @ts-nocheck
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const video_utils_1 = require("./video-utils");
function ffmpegEscapeText(text) {
    return String(text || '')
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'")
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/,/g, '\\,');
}
function animatedCaptionFilter(text, style = 'hook') {
    const safe = ffmpegEscapeText(text);
    const size = style === 'hook' ? 74 : 52;
    const y = style === 'hook' ? 'h*0.16' : 'h-300';
    return `drawtext=text='${safe}':fontcolor=white:fontsize=${size}:borderw=6:bordercolor=black:x=(w-text_w)/2:y=${y}:enable='between(t,0,5)'`;
}
function ctaFilter(text) {
    const safe = ffmpegEscapeText(text);
    return `drawtext=text='${safe}':fontcolor=white:fontsize=48:borderw=5:bordercolor=black:box=1:boxcolor=black@0.45:boxborderw=20:x=(w-text_w)/2:y=h-220:enable='gte(t,4)'`;
}
function circlePipFilter(size = 320) {
    // Practical PIP crop. True circular alpha masks vary by ffmpeg build, so this uses rounded-safe corner placement.
    return `[1:v]scale=${size}:-1[pip];[0:v][pip]overlay=W-w-36:H-h-72`;
}
function buildSplitScreen(beforeFile, afterFile, outputFile) {
    (0, video_utils_1.ensureDir)(path_1.default.dirname(outputFile));
    const cmd = [
        'ffmpeg -y',
        `-i "${beforeFile}"`,
        `-i "${afterFile}"`,
        '-filter_complex "[0:v]scale=540:1920:force_original_aspect_ratio=increase,crop=540:1920[left];[1:v]scale=540:1920:force_original_aspect_ratio=increase,crop=540:1920[right];[left][right]hstack=inputs=2,drawtext=text=BEFORE:fontcolor=white:fontsize=56:borderw=5:bordercolor=black:x=120:y=120,drawtext=text=AFTER:fontcolor=white:fontsize=56:borderw=5:bordercolor=black:x=700:y=120"',
        '-r 30 -pix_fmt yuv420p',
        `"${outputFile}"`
    ].join(' ');
    (0, child_process_1.execSync)(cmd, { stdio: 'inherit' });
    return outputFile;
}
function createProductCutoutPlaceholder(productImage, outputDir) {
    if (!productImage || !fs_1.default.existsSync(productImage))
        return '';
    (0, video_utils_1.ensureDir)(outputDir);
    const output = path_1.default.resolve(outputDir, `${(0, video_utils_1.safeFileName)(path_1.default.basename(productImage, path_1.default.extname(productImage)), 'png')}`);
    // Simple transparent-canvas prep placeholder. True background removal should be handled by an image segmentation API later.
    const cmd = `ffmpeg -y -i "${productImage}" -vf "scale=520:-1" "${output}"`;
    (0, child_process_1.execSync)(cmd, { stdio: 'inherit' });
    return output;
}
function mixSoundtrack(videoFile, musicFile, outputFile) {
    if (!musicFile || !fs_1.default.existsSync(musicFile))
        return videoFile;
    (0, video_utils_1.ensureDir)(path_1.default.dirname(outputFile));
    const cmd = [
        'ffmpeg -y',
        `-i "${videoFile}"`,
        `-i "${musicFile}"`,
        '-filter_complex "[1:a]volume=0.12[a1];[0:a][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]"',
        '-map 0:v -map "[aout]" -c:v copy -c:a aac -shortest',
        `"${outputFile}"`
    ].join(' ');
    (0, child_process_1.execSync)(cmd, { stdio: 'inherit' });
    return outputFile;
}
