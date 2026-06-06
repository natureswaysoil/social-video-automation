"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateVoiceover = generateVoiceover;
// @ts-nocheck
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const child_process_1 = require("child_process");
const did_provider_1 = require("./did-provider");
const video_utils_1 = require("./video-utils");
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
async function generateVoiceover(product, scenePlan, profile, outDir) {
    const script = (scenePlan?.fullVoiceover || (scenePlan?.scenes || []).map((s) => s.voiceover).filter(Boolean).join(' ') || '').trim();
    if (!script) {
        console.log('Narration skipped: empty script');
        return '';
    }
    (0, video_utils_1.ensureDir)(outDir);
    const talkMp4 = path_1.default.resolve(outDir, `narration-${(0, video_utils_1.safeFileName)(product.id || product.name, 'mp4')}`);
    const audioOut = path_1.default.resolve(outDir, `voiceover-${(0, video_utils_1.safeFileName)(product.id || product.name, 'm4a')}`);
    try {
        const id = await (0, did_provider_1.createDidVideo)(product, { ...scenePlan, fullVoiceover: script }, profile);
        const resultUrl = await (0, did_provider_1.pollDidVideo)(id);
        if (!resultUrl) {
            console.log('Narration skipped: D-ID returned no result_url');
            return '';
        }
        // download the talk mp4
        const response = await axios_1.default.get(resultUrl, { responseType: 'stream', timeout: 180000 });
        await new Promise((resolve, reject) => {
            const writer = fs_1.default.createWriteStream(talkMp4);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        // extract + loudness-normalise the audio (drop the avatar video)
        (0, child_process_1.execSync)([
            'ffmpeg -y -loglevel error',
            `-i "${talkMp4}"`,
            '-vn',
            '-af "loudnorm=I=-16:TP=-1.5:LRA=11"',
            '-c:a aac -b:a 192k',
            `"${audioOut}"`
        ].join(' '), { stdio: 'inherit' });
        if (fs_1.default.existsSync(audioOut) && fs_1.default.statSync(audioOut).size > 0) {
            console.log('Narration ready', { audioOut });
            try {
                fs_1.default.unlinkSync(talkMp4);
            }
            catch { }
            return audioOut;
        }
        console.log('Narration skipped: audio extraction produced no output');
        return '';
    }
    catch (error) {
        console.log('Narration generation failed; continuing without audio', { error: error?.message || error });
        try {
            if (fs_1.default.existsSync(talkMp4))
                fs_1.default.unlinkSync(talkMp4);
        }
        catch { }
        return '';
    }
}
