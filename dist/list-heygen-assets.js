"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
require("dotenv/config");
const axios_1 = __importDefault(require("axios"));
const secret_manager_1 = require("@google-cloud/secret-manager");
const SECRET_NAMES = ['HEYGEN_API_KEY', 'HEYGEN_API_ENDPOINT'];
function good(value) {
    return !!value && !/your_|your-|changeme|placeholder|paste_|replace_/i.test(value);
}
function variants(name) {
    const upper = name.replace(/[\s-]+/g, '_').toUpperCase();
    return [...new Set([upper, upper.toLowerCase().replace(/_/g, '-'), upper.toLowerCase()])];
}
async function loadSecrets() {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'natureswaysoil-video';
    const client = new secret_manager_1.SecretManagerServiceClient();
    for (const name of SECRET_NAMES) {
        if (good(process.env[name]))
            continue;
        for (const candidate of variants(name)) {
            try {
                const [version] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${candidate}/versions/latest` });
                const value = version.payload?.data?.toString().trim();
                if (value) {
                    process.env[name] = value;
                    console.log(`Loaded secret: ${candidate}`);
                    break;
                }
            }
            catch (error) {
                if (Number(error?.code) === 5)
                    continue;
                console.log(`Could not load ${candidate}: ${error?.message || error}`);
                break;
            }
        }
    }
}
function printRows(title, rows, pick) {
    console.log(`\n${title}`);
    console.log('='.repeat(title.length));
    rows.slice(0, Number(process.env.LIMIT || 60)).forEach((row, index) => {
        console.log(`${index + 1}. ${JSON.stringify(pick(row), null, 2)}`);
    });
}
async function main() {
    await loadSecrets();
    if (!process.env.HEYGEN_API_KEY)
        throw new Error('Missing HEYGEN_API_KEY');
    const endpoint = process.env.HEYGEN_API_ENDPOINT || 'https://api.heygen.com';
    const headers = { 'X-Api-Key': process.env.HEYGEN_API_KEY };
    const avatarRes = await axios_1.default.get(`${endpoint}/v2/avatars`, { headers, timeout: 60000 });
    const voiceRes = await axios_1.default.get(`${endpoint}/v2/voices`, { headers, timeout: 60000 });
    const avatars = avatarRes.data?.data?.avatars || avatarRes.data?.avatars || [];
    const voices = voiceRes.data?.data?.voices || voiceRes.data?.voices || [];
    printRows('Available HeyGen Avatars', avatars, (a) => ({
        avatar_id: a.avatar_id,
        avatar_name: a.avatar_name,
        gender: a.gender,
        preview: a.preview_image_url || a.preview_image,
    }));
    printRows('Available HeyGen Voices', voices, (v) => ({
        voice_id: v.voice_id,
        name: v.name,
        gender: v.gender,
        language: v.language,
        preview: v.preview_audio,
    }));
    console.log('\nUse the avatar_id and voice_id you like in config/creative-profiles.json.');
}
main().catch((error) => {
    console.error('HeyGen asset listing failed:', error?.message || error);
    process.exit(1);
});
