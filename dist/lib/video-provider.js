"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNarration = createNarration;
const narration_1 = require("./narration");
async function createNarration(product, scenePlan, profile, outDir) {
    const requested = String(process.env.VIDEO_PROVIDER || 'openai_tts').toLowerCase();
    if (requested !== 'openai_tts') {
        console.log(`VIDEO_PROVIDER=${requested} requested but OpenAI TTS is enforced for this automation`);
    }
    return await (0, narration_1.generateVoiceover)(product, scenePlan, profile, outDir);
}
