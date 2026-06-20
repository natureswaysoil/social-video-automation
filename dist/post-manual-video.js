"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
require("dotenv/config");
const axios_1 = __importDefault(require("axios"));
const googleapis_1 = require("googleapis");
function pickEnv(keys) {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value)
            return value;
    }
    return '';
}
function enabledPlatforms() {
    return Array.from(new Set(String(process.env.ENABLE_PLATFORMS || 'youtube,facebook')
        .toLowerCase()
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)));
}
function cleanText(value) {
    return String(value || '')
        .replace(/100\s*%\s*organic/gi, 'natural')
        .replace(/100\s*percent\s*organic/gi, 'natural')
        .replace(/one\s+hundred\s+percent\s+organic/gi, 'natural')
        .trim();
}
async function postToYouTube(videoUrl, title, description) {
    const clientId = pickEnv(['YT_CLIENT_ID', 'YOUTUBE_CLIENT_ID']);
    const clientSecret = pickEnv(['YT_CLIENT_SECRET', 'YOUTUBE_CLIENT_SECRET']);
    const refreshToken = pickEnv(['YT_REFRESH_TOKEN', 'YOUTUBE_REFRESH_TOKEN']);
    if (!clientId || !clientSecret || !refreshToken)
        throw new Error('Missing YouTube credentials');
    const oauth2Client = new googleapis_1.google.auth.OAuth2({ clientId, clientSecret });
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const youtube = googleapis_1.google.youtube({ version: 'v3', auth: oauth2Client });
    const body = (await axios_1.default.get(videoUrl, { responseType: 'stream', timeout: 120000 })).data;
    const upload = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
            snippet: { title: title.slice(0, 95), description, categoryId: '22' },
            status: { privacyStatus: (process.env.YT_PRIVACY_STATUS || process.env.YOUTUBE_PRIVACY_STATUS || 'public') },
        },
        media: { body },
    });
    const id = upload.data.id || '';
    if (!id)
        throw new Error('YouTube upload did not return an id');
    return id;
}
async function postToFacebook(videoUrl, caption) {
    const accessToken = pickEnv(['FB_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN']);
    const pageId = pickEnv(['FB_PAGE_ID', 'FACEBOOK_PAGE_ID']);
    if (!accessToken || !pageId)
        throw new Error('Missing Facebook credentials');
    const response = await axios_1.default.post(`https://graph.facebook.com/${process.env.FACEBOOK_API_VERSION || 'v20.0'}/${pageId}/videos`, { file_url: videoUrl, description: caption, published: true }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 120000 });
    const id = response.data?.id || '';
    if (!id)
        throw new Error('Facebook upload did not return an id');
    return id;
}
async function main() {
    const videoUrl = String(process.env.MANUAL_VIDEO_URL || '').trim();
    if (!/^https:\/\//i.test(videoUrl))
        throw new Error('MANUAL_VIDEO_URL must be a public HTTPS video URL');
    const title = cleanText(process.env.MANUAL_VIDEO_TITLE || 'Nature’s Way Soil Video') || 'Nature’s Way Soil Video';
    const caption = cleanText(process.env.MANUAL_VIDEO_CAPTION || `${title}\n\nLearn more at https://www.natureswaysoil.com`);
    const platforms = enabledPlatforms();
    let posted = 0;
    console.log('Manual video posting started', { videoUrl, title, platforms });
    if (platforms.includes('youtube')) {
        try {
            const id = await postToYouTube(videoUrl, title, caption);
            console.log('Posted manual video to YouTube', { id });
            posted++;
        }
        catch (error) {
            console.log('Manual YouTube post failed', error?.message || error);
        }
    }
    if (platforms.includes('facebook')) {
        try {
            const id = await postToFacebook(videoUrl, caption);
            console.log('Posted manual video to Facebook', { id });
            posted++;
        }
        catch (error) {
            console.log('Manual Facebook post failed', error?.message || error);
        }
    }
    if (posted === 0)
        throw new Error('No manual video posts succeeded');
    console.log('Manual video posting completed', { posted });
}
main().catch((error) => {
    console.error('Manual video posting failed:', error?.message || error);
    process.exit(1);
});
