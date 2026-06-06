"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ffmpegInstalled = ffmpegInstalled;
exports.buildSubtitleFile = buildSubtitleFile;
exports.buildThumbnailPrompt = buildThumbnailPrompt;
exports.buildFfmpegCaptionCommand = buildFfmpegCaptionCommand;
// @ts-nocheck
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const video_utils_1 = require("./video-utils");
const ROOT = process.cwd();
const OUTPUT = path_1.default.resolve(ROOT, 'output');
function ffmpegInstalled() {
    try {
        (0, child_process_1.execSync)('ffmpeg -version', { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
function buildSubtitleFile(scenes, title) {
    (0, video_utils_1.ensureDir)(OUTPUT);
    const file = path_1.default.resolve(OUTPUT, (0, video_utils_1.safeFileName)(title, 'srt'));
    let cursor = 0;
    let srt = '';
    scenes.forEach((scene, index) => {
        const start = cursor;
        const end = cursor + Number(scene.seconds || 6);
        cursor = end;
        const format = (seconds) => {
            const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
            const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
            const s = String(Math.floor(seconds % 60)).padStart(2, '0');
            return `${h}:${m}:${s},000`;
        };
        srt += `${index + 1}\n`;
        srt += `${format(start)} --> ${format(end)}\n`;
        srt += `${(0, video_utils_1.wrapCaption)(scene.voiceover || title)}\n\n`;
    });
    fs_1.default.writeFileSync(file, srt, 'utf8');
    return file;
}
function buildThumbnailPrompt(product) {
    return {
        headline: `SOIL-FIRST SUPPORT`,
        subheadline: product.name,
        visual: 'healthy lawn or pasture with visible product usage'
    };
}
function buildFfmpegCaptionCommand(videoFile, subtitleFile, outputFile) {
    return `ffmpeg -y -i "${videoFile}" -vf subtitles="${subtitleFile}" -c:a copy "${outputFile}"`;
}
