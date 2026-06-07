"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateVoiceover = generateVoiceover;
// @ts-nocheck
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const openai_1 = __importDefault(require("openai"));
const child_process_1 = require("child_process");
const video_utils_1 = require("./video-utils");
/**
 * Generate a voiceover audio file using OpenAI TTS only.
 */
async function generateVoiceover(product, scenePlan, profile, outDir) {
    const script = (scenePlan?.fullVoiceover || (scenePlan?.scenes || []).map((s) => s.voiceover).filter(Boolean).join(' ') || '').trim();
    if (!script) {
        console.log('Narration skipped: empty script');
        return '';
    }
    if (!process.env.OPENAI_API_KEY) {
        console.log('Narration skipped: missing OPENAI_API_KEY');
        return '';
    }
    (0, video_utils_1.ensureDir)(outDir);
    const ttsMp3 = path_1.default.resolve(outDir, `tts-${(0, video_utils_1.safeFileName)(product.id || product.name, 'mp3')}`);
    const audioOut = path_1.default.resolve(outDir, `voiceover-${(0, video_utils_1.safeFileName)(product.id || product.name, 'm4a')}`);
    try {
        const client = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
        const model = process.env.TTS_MODEL || 'gpt-4o-mini-tts';
        const voice = process.env.TTS_VOICE || 'alloy';
        const response = await client.audio.speech.create({
            model,
            voice: voice,
            input: script,
            format: 'mp3'
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        fs_1.default.writeFileSync(ttsMp3, buffer);
        (0, child_process_1.execSync)([
            'ffmpeg -y -loglevel error',
            `-i "${ttsMp3}"`,
            '-af "loudnorm=I=-16:TP=-1.5:LRA=11"',
            '-c:a aac -b:a 192k',
            `"${audioOut}"`
        ].join(' '), { stdio: 'inherit' });
        if (fs_1.default.existsSync(audioOut) && fs_1.default.statSync(audioOut).size > 0) {
            console.log('Narration ready', { audioOut });
            try {
                fs_1.default.unlinkSync(ttsMp3);
            }
            catch { }
            return audioOut;
        }
        if (fs_1.default.existsSync(ttsMp3) && fs_1.default.statSync(ttsMp3).size > 0) {
            console.log('Narration fallback: using raw mp3 output');
            return ttsMp3;
        }
        console.log('Narration skipped: TTS produced no output');
        return '';
    }
    catch (error) {
        console.log('Narration generation failed; continuing without audio', { error: error?.message || error });
        try {
            if (fs_1.default.existsSync(ttsMp3))
                fs_1.default.unlinkSync(ttsMp3);
        }
        catch { }
        return '';
    }
}
