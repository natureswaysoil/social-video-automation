"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const openai_1 = __importDefault(require("openai"));
const child_process_1 = require("child_process");
const googleapis_1 = require("googleapis");
const storage_1 = require("@google-cloud/storage");
const secret_manager_1 = require("@google-cloud/secret-manager");
const ffmpeg_compositor_1 = require("./lib/ffmpeg-compositor");
const pexels_media_1 = require("./lib/pexels-media");
const product_assets_1 = require("./lib/product-assets");
const video_utils_1 = require("./lib/video-utils");
const video_provider_1 = require("./lib/video-provider");
const caption_formatter_1 = require("./lib/caption-formatter");
const social_platforms_1 = require("./lib/social-platforms");
const facebook_groups_1 = require("./lib/facebook-groups");
const marketing_engine_1 = require("./lib/marketing-engine");
const ROOT = process.cwd();
const CONFIG_PATH = path_1.default.resolve(ROOT, 'config/top-products.json');
const STATE_PATH = path_1.default.resolve(ROOT, process.env.ROTATION_STATE_FILE || 'data/rotation-state.json');
const CREATIVE_PATH = path_1.default.resolve(ROOT, 'config/creative-profiles.json');
const OUTPUT_DIR = path_1.default.resolve(ROOT, 'output');
const TEMP_DIR = path_1.default.resolve(ROOT, 'temp-scheduled');
const FOOTAGE_DIR = path_1.default.resolve(ROOT, process.env.FOOTAGE_DIR || 'footage');
const DEFAULT_PUBLIC_VIDEO_BUCKET = 'natureswaysoil-social-videos';
const DEFAULT_STATE = { cursor: -1, variationByProduct: {} };
const VIDEO_ANALYTICS_FILE = path_1.default.resolve(ROOT, process.env.VIDEO_ANALYTICS_FILE || 'data/video-analytics.json');
const SECRET_NAMES = [
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'PEXELS_API_KEY',
    'YT_CLIENT_ID',
    'YT_CLIENT_SECRET',
    'YT_REFRESH_TOKEN',
    'YOUTUBE_CLIENT_ID',
    'YOUTUBE_CLIENT_SECRET',
    'YOUTUBE_REFRESH_TOKEN',
    'INSTAGRAM_ACCESS_TOKEN',
    'INSTAGRAM_IG_ID',
    'INSTAGRAM_USER_ID',
    'INSTAGRAM_ACCOUNT_ID',
    'FB_PAGE_ACCESS_TOKEN',
    'FB_PAGE_ID',
    'FACEBOOK_PAGE_ACCESS_TOKEN',
    'FACEBOOK_PAGE_ID',
    'FACEBOOK_GROUPS_ACCESS_TOKEN',
    'TIKTOK_ACCESS_TOKEN',
    'TIKTOK_OPEN_ID',
    'GCS_PUBLIC_BUCKET',
    'VIDEO_PUBLIC_BUCKET',
    'VIDEO_PUBLIC_URL_BASE'
];
function log(message, data) {
    if (data === undefined)
        console.log(message);
    else
        console.log(message, data);
}
function hasValue(name) {
    const value = process.env[name];
    if (!value)
        return false;
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && !/your-|your_|changeme|placeholder|paste_|replace_|dummy_|example_/i.test(normalized);
}
function secretCandidates(name) {
    const upper = name.trim().replace(/[\s-]+/g, '_').toUpperCase();
    const lowerHyphen = upper.toLowerCase().replace(/_/g, '-');
    const lowerUnderscore = upper.toLowerCase();
    return [...new Set([upper, lowerHyphen, name, name.replace(/_/g, '-'), lowerUnderscore])];
}
function isNotFoundSecretError(error) {
    return Number(error?.code) === 5 || String(error?.message || '').toUpperCase().includes('NOT_FOUND');
}
function isPermissionDeniedSecretError(error) {
    const message = String(error?.message || '').toUpperCase();
    return Number(error?.code) === 7 || message.includes('PERMISSION_DENIED') || message.includes('PERMISSION DENIED');
}
async function loadSecrets() {
    const useSecretManager = String(process.env.USE_SECRET_MANAGER || 'true').toLowerCase() !== 'false';
    if (!useSecretManager)
        return;
    const enforceSecretManagerAccess = String(process.env.REQUIRE_SECRET_MANAGER_ACCESS || process.env.CI || '').toLowerCase() === 'true';
    const dryRun = String(process.env.DRY_RUN_LOG_ONLY || '').toLowerCase() === 'true';
    const hasAdc = !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !!process.env.GOOGLE_GHA_CREDS_PATH;
    if (dryRun && !hasAdc) {
        log('Secret Manager lookup skipped for local dry run without ADC credentials');
        return;
    }
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'natureswaysoil-video';
    const client = new secret_manager_1.SecretManagerServiceClient();
    for (const secretName of SECRET_NAMES) {
        if (hasValue(secretName) && !enforceSecretManagerAccess)
            continue;
        for (const candidate of secretCandidates(secretName)) {
            try {
                const [version] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${candidate}/versions/latest` });
                const value = version.payload?.data?.toString().trim();
                if (value) {
                    process.env[secretName] = value;
                    process.env[candidate] = value;
                    log(`Loaded secret: ${candidate}${candidate === secretName ? '' : ` -> ${secretName}`}`);
                    break;
                }
            }
            catch (error) {
                if (isNotFoundSecretError(error))
                    continue;
                if (isPermissionDeniedSecretError(error)) {
                    throw new Error(`Secret Manager permission denied for ${candidate}: ${error?.message || error}`);
                }
                log(`Could not load secret ${candidate}: ${error?.message || error}`);
                break;
            }
        }
    }
}
function readJson(file, fallback) {
    try {
        if (!fs_1.default.existsSync(file))
            return fallback;
        return JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
    }
    catch {
        return fallback;
    }
}
function writeJson(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function loadProducts() {
    const raw = readJson(CONFIG_PATH, { topProducts: [] });
    return Array.isArray(raw.topProducts) ? raw.topProducts.slice(0, Number(process.env.SEED_PRODUCT_LIMIT || 20)) : [];
}
function websiteCtaUrl(product) {
    if (String(product.websiteUrl || '').trim())
        return product.websiteUrl;
    return 'https://www.natureswaysoil.com';
}
async function restoreRotationStateFromGcs() {
    if (String(process.env.ROTATION_STATE_PERSIST_TO_GCS || 'true').toLowerCase() === 'false')
        return;
    try {
        const bucketName = process.env.ROTATION_STATE_GCS_BUCKET || publicBucketName();
        const objectName = process.env.ROTATION_STATE_GCS_OBJECT || 'state/rotation-state.json';
        const storage = new storage_1.Storage();
        const bucket = storage.bucket(bucketName);
        const file = bucket.file(objectName);
        const [exists] = await file.exists();
        if (!exists)
            return;
        fs_1.default.mkdirSync(path_1.default.dirname(STATE_PATH), { recursive: true });
        await file.download({ destination: STATE_PATH });
        log('Restored rotation state from GCS', { bucketName, objectName, statePath: STATE_PATH });
    }
    catch (error) {
        log('Rotation state restore skipped', error?.message || error);
    }
}
async function persistRotationStateToGcs() {
    if (!fs_1.default.existsSync(STATE_PATH))
        return;
    if (String(process.env.ROTATION_STATE_PERSIST_TO_GCS || 'true').toLowerCase() === 'false')
        return;
    try {
        const bucketName = process.env.ROTATION_STATE_GCS_BUCKET || publicBucketName();
        const objectName = process.env.ROTATION_STATE_GCS_OBJECT || 'state/rotation-state.json';
        const storage = new storage_1.Storage();
        await storage.bucket(bucketName).upload(STATE_PATH, { destination: objectName, resumable: false, metadata: { contentType: 'application/json' } });
        log('Persisted rotation state to GCS', { bucketName, objectName });
    }
    catch (error) {
        log('Rotation state persistence skipped', error?.message || error);
    }
}
function pickProduct(products) {
    const state = readJson(STATE_PATH, { ...DEFAULT_STATE });
    const preferredId = process.env.NEXT_PRODUCT_PREFERRED_ID?.trim();
    const preferredIndex = preferredId ? products.findIndex((p) => p.id === preferredId) : -1;
    const nextCursor = preferredIndex >= 0 ? preferredIndex : (Number(state.cursor || -1) + 1) % products.length;
    const product = products[nextCursor];
    const variationCount = Number(process.env.VARIATIONS_PER_PRODUCT || 5);
    const lastVariation = state.variationByProduct?.[product.id];
    const variationIndex = typeof lastVariation === 'number' ? (lastVariation + 1) % variationCount : 0;
    state.cursor = nextCursor;
    state.variationByProduct = state.variationByProduct || {};
    state.variationByProduct[product.id] = variationIndex;
    state.lastRunAt = new Date().toISOString();
    writeJson(STATE_PATH, state);
    return { product, variationIndex, variationCount };
}
function productCreativeProfile(product) {
    const creative = readJson(CREATIVE_PATH, { defaults: {}, profiles: {} });
    return { ...(creative.defaults || {}), ...((creative.profiles || {})[product.id] || {}) };
}
function sceneQueries(scene, product, index) {
    return (0, pexels_media_1.buildSceneQueryPriority)(scene, product, index);
}
function curatedScenePlan(product, profile) {
    if (!Array.isArray(profile.scenes) || !profile.scenes.length)
        return null;
    const scenes = profile.scenes.slice(0, 5).map((scene, index) => ({
        name: scene.name || `scene-${index + 1}`,
        seconds: Number(scene.seconds || 6),
        voiceover: scene.voiceover || '',
        brollQuery: sceneQueries(scene, product, index)[0] || product.category,
        brollQueries: sceneQueries(scene, product, index),
        caption: scene.caption || scene.name || product.name,
        useProductImage: Boolean(scene.useProductImage) || index === 1 || index === profile.scenes.length - 1
    }));
    const fallbackVoice = `${profile.hooks?.[0] || product.name}. ${product.description} ${profile.cta || 'See full product details at natureswaysoil.com.'}`;
    const voiceover = scenes.map((scene) => scene.voiceover).filter(Boolean).join(' ') || fallbackVoice;
    return { fullVoiceover: voiceover, scenes };
}
function fallbackScenes(product, profile) {
    const base = product.brollQueries?.length ? product.brollQueries : [product.category];
    return [
        { name: 'Problem', seconds: 5, voiceover: `${profile.hooks?.[0] || 'Your lawn or soil problem may start below the surface.'}`, brollQuery: base[0] || product.category },
        { name: 'Product', seconds: 5, voiceover: `${product.name} is designed to support healthier soil and stronger-looking growth.`, brollQuery: base[1] || product.name, useProductImage: true },
        { name: 'Application', seconds: 6, voiceover: 'Use it as part of your regular lawn, garden, pasture, or soil care routine according to label directions.', brollQuery: base[2] || 'spraying lawn' },
        { name: 'Field Result', seconds: 6, voiceover: 'The goal is better soil support, root-zone activity, and nutrient availability.', brollQuery: base[3] || 'healthy soil close up' },
        { name: 'CTA', seconds: 6, voiceover: profile.cta || 'See full product details at natureswaysoil.com.', brollQuery: base[4] || 'healthy green lawn', useProductImage: true }
    ];
}
function parseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        const match = String(text || '').match(/\{[\s\S]*\}/);
        if (!match)
            return null;
        try {
            return JSON.parse(match[0]);
        }
        catch {
            return null;
        }
    }
}
async function generateScenePlan(product, profile, variationIndex, variationCount) {
    const curated = curatedScenePlan(product, profile);
    if (curated)
        return curated;
    const fallback = fallbackScenes(product, profile);
    if (String(process.env.USE_OPENAI_SCENE_PLAN || 'false').toLowerCase() !== 'true')
        return { fullVoiceover: fallback.map(s => s.voiceover || '').join(' '), scenes: fallback };
    if (!hasValue('OPENAI_API_KEY'))
        return { fullVoiceover: fallback.map(s => s.voiceover || '').join(' '), scenes: fallback };
    const client = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Create a practical 25-30 second vertical product video script for Nature's Way Soil.
Product: ${product.name}
Description: ${product.description}
Category: ${product.category}
Website: ${websiteCtaUrl(product)}
Variation: ${variationIndex + 1} of ${variationCount}
Audience: ${profile.audience || 'homeowners, gardeners, lawn care, land owners'}
Angle: ${profile.angle || 'soil-first product explanation'}
Tone: ${profile.tone || 'plainspoken and practical'}
Rules:
- No fantasy visuals, no cartoons, no "animation highlighting ingredients", no screen recordings.
- Use realistic farm, lawn, soil, sprayer, pasture, garden, and product visuals only.
- No guaranteed results.
- No pesticide, disease, or cure claims.
- Product should be visible by scene 2.
- End with a direct CTA.
- Return only JSON: {"fullVoiceover":"...","scenes":[{"name":"...","seconds":6,"voiceover":"...","brollQuery":"...","caption":"...","useProductImage":false}]}
- Provide exactly 5 scenes.`;
    const response = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.25, max_tokens: 700 });
    const parsed = parseJson(response.choices[0]?.message?.content?.trim() || '');
    if (parsed?.scenes?.length) {
        const scenes = parsed.scenes.slice(0, 5).map((scene, index) => ({
            name: String(scene?.name || fallback[index]?.name || `scene-${index + 1}`),
            seconds: Number(scene?.seconds || fallback[index]?.seconds || 6),
            voiceover: String(scene?.voiceover || fallback[index]?.voiceover || '').trim(),
            brollQuery: String(scene?.brollQuery || fallback[index]?.brollQuery || product.category),
            caption: String(scene?.caption || scene?.name || fallback[index]?.name || '').trim(),
            useProductImage: Boolean(scene?.useProductImage) || index === 1 || index === 4
        }));
        return { fullVoiceover: String(parsed.fullVoiceover || scenes.map((s) => s.voiceover || '').join(' ')), scenes };
    }
    return { fullVoiceover: fallback.map(s => s.voiceover || '').join(' '), scenes: fallback };
}
function pickEnv(keys) {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value)
            return value;
    }
    return '';
}
function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
}
function isCiMandatoryPlatformMode() {
    if (String(process.env.CI_MANDATORY_PLATFORMS || '').toLowerCase() === 'all')
        return true;
    if (String(process.env.CI_MANDATORY_PLATFORMS || '').toLowerCase() === 'enabled')
        return true;
    return String(process.env.CI || '').toLowerCase() === 'true';
}
function publicBucketName() {
    return pickEnv(['GCS_PUBLIC_BUCKET', 'VIDEO_PUBLIC_BUCKET']) || DEFAULT_PUBLIC_VIDEO_BUCKET;
}
function publicBucketUrlBase(bucket) {
    const explicit = process.env.VIDEO_PUBLIC_URL_BASE?.replace(/\/$/, '') || '';
    return explicit || `https://storage.googleapis.com/${bucket}`;
}
async function uploadVideoForSocial(videoFileOrUrl) {
    if (isHttpUrl(videoFileOrUrl))
        return videoFileOrUrl;
    const bucketName = publicBucketName();
    const storage = new storage_1.Storage();
    const objectName = `social-videos/${Date.now()}-${(0, video_utils_1.safeFileName)(path_1.default.basename(videoFileOrUrl), 'mp4')}`;
    await storage.bucket(bucketName).upload(videoFileOrUrl, {
        destination: objectName,
        resumable: false,
        metadata: {
            contentType: 'video/mp4',
            cacheControl: 'public, max-age=604800'
        }
    });
    try {
        await storage.bucket(bucketName).file(objectName).makePublic();
    }
    catch (error) {
        log('Could not make uploaded video public. Bucket may use uniform public access; verify allUsers objectViewer or public bucket policy.', error?.message || error);
    }
    const publicUrl = `${publicBucketUrlBase(bucketName)}/${objectName.split('/').map(encodeURIComponent).join('/')}`;
    log('Uploaded video for social platforms', { bucketName, objectName, publicUrl });
    return publicUrl;
}
function createThumbnail(videoFile, product) {
    (0, video_utils_1.ensureDir)(OUTPUT_DIR);
    const output = path_1.default.resolve(OUTPUT_DIR, `${(0, video_utils_1.safeFileName)(`${product.name}-thumbnail`, 'jpg')}`);
    (0, child_process_1.execSync)(`ffmpeg -y -loglevel error -i "${videoFile}" -ss 00:00:02 -vframes 1 "${output}"`, { stdio: 'inherit' });
    return output;
}
async function postToYouTube(videoFileOrUrl, title, description, thumbnailFile) {
    const clientId = pickEnv(['YT_CLIENT_ID', 'YOUTUBE_CLIENT_ID']);
    const clientSecret = pickEnv(['YT_CLIENT_SECRET', 'YOUTUBE_CLIENT_SECRET']);
    const refreshToken = pickEnv(['YT_REFRESH_TOKEN', 'YOUTUBE_REFRESH_TOKEN']);
    if (!clientId || !clientSecret || !refreshToken)
        throw new Error('Missing YouTube OAuth credentials');
    const oauth2Client = new googleapis_1.google.auth.OAuth2({ clientId, clientSecret });
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const youtube = googleapis_1.google.youtube({ version: 'v3', auth: oauth2Client });
    const body = isHttpUrl(videoFileOrUrl)
        ? (await axios_1.default.get(videoFileOrUrl, { responseType: 'stream', timeout: 120000 })).data
        : fs_1.default.createReadStream(videoFileOrUrl);
    const upload = await youtube.videos.insert({ part: ['snippet', 'status'], requestBody: { snippet: { title: title.slice(0, 95), description, categoryId: '22' }, status: { privacyStatus: process.env.YT_PRIVACY_STATUS || 'public' } }, media: { body } });
    const id = upload.data.id || '';
    if (!id)
        throw new Error('YouTube upload did not return video id');
    if (thumbnailFile && fs_1.default.existsSync(thumbnailFile)) {
        try {
            await youtube.thumbnails.set({ videoId: id, media: { body: fs_1.default.createReadStream(thumbnailFile) } });
        }
        catch (error) {
            log('YouTube thumbnail upload failed', error?.message || error);
        }
    }
    return id;
}
async function postToInstagram(publicVideoUrl, captionText) {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const igId = pickEnv(['INSTAGRAM_IG_ID', 'INSTAGRAM_USER_ID', 'INSTAGRAM_ACCOUNT_ID']);
    if (!accessToken || !igId)
        throw new Error('Missing Instagram access token or IG ID');
    if (!isHttpUrl(publicVideoUrl))
        throw new Error('Instagram requires a public HTTPS video URL.');
    const apiVersion = process.env.INSTAGRAM_API_VERSION || 'v20.0';
    const host = process.env.INSTAGRAM_API_HOST || 'graph.facebook.com';
    const baseUrl = `https://${host}/${apiVersion}`;
    const container = await axios_1.default.post(`${baseUrl}/${igId}/media`, { media_type: process.env.IG_MEDIA_TYPE || 'REELS', video_url: publicVideoUrl, caption: captionText }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 120000 });
    const creationId = container.data?.id;
    if (!creationId)
        throw new Error('Instagram did not return creation id');
    for (let i = 0; i < 24; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const status = await axios_1.default.get(`${baseUrl}/${creationId}?fields=status_code`, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000 });
        const code = status.data?.status_code;
        log('Instagram media status', { creationId, code });
        if (code === 'FINISHED')
            break;
        if (code === 'ERROR' || code === 'EXPIRED')
            throw new Error(`Instagram container ${code}`);
    }
    const published = await axios_1.default.post(`${baseUrl}/${igId}/media_publish`, { creation_id: creationId }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 120000 });
    const mediaId = published.data?.id || '';
    if (!mediaId)
        throw new Error('Instagram publish did not return media id');
    return mediaId;
}
async function postToFacebook(publicVideoUrl, captionText) {
    const accessToken = pickEnv(['FB_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN']);
    const pageId = pickEnv(['FB_PAGE_ID', 'FACEBOOK_PAGE_ID']);
    if (!accessToken || !pageId)
        throw new Error('Missing Facebook page access token or page ID');
    if (!isHttpUrl(publicVideoUrl))
        throw new Error('Facebook requires a public HTTPS video URL.');
    const apiVersion = process.env.FACEBOOK_API_VERSION || process.env.INSTAGRAM_API_VERSION || 'v20.0';
    const host = process.env.FACEBOOK_API_HOST || 'graph.facebook.com';
    const baseUrl = `https://${host}/${apiVersion}`;
    const response = await axios_1.default.post(`${baseUrl}/${pageId}/videos`, {
        file_url: publicVideoUrl,
        description: captionText,
        published: true
    }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 120000 });
    const id = response.data?.id || '';
    if (!id)
        throw new Error(`Facebook did not return video id: ${JSON.stringify(response.data)}`);
    return id;
}
function localFootageCandidates(product) {
    if (!fs_1.default.existsSync(FOOTAGE_DIR))
        return [];
    const files = fs_1.default.readdirSync(FOOTAGE_DIR)
        .filter((f) => /\.(mp4|mov|mkv|webm|png|jpe?g|webp)$/i.test(f))
        .map((f) => path_1.default.resolve(FOOTAGE_DIR, f));
    const text = `${product.name} ${product.category} ${(product.keywords || []).join(' ')}`.toLowerCase();
    return files.sort((a, b) => {
        const score = (file) => {
            const name = path_1.default.basename(file).toLowerCase();
            let s = 0;
            if (/dog|pet|urine|odor|kennel/.test(text) && /dog|pet|urine|odor|lawn|grass/.test(name))
                s += 6;
            if (/pasture|hay|field|farm|acre/.test(text) && /pasture|hay|field|farm|acre/.test(name))
                s += 6;
            if (/compost|biochar|worm|soil|garden/.test(text) && /compost|biochar|worm|soil|garden|plant/.test(name))
                s += 6;
            if (/spray|hose|before|after|product|bottle|jug/.test(name))
                s += 3;
            return s;
        };
        return score(b) - score(a);
    });
}
async function collectSceneFiles(product, scenePlan) {
    (0, video_utils_1.ensureDir)(OUTPUT_DIR);
    (0, video_utils_1.ensureDir)(TEMP_DIR);
    (0, video_utils_1.ensureDir)(FOOTAGE_DIR);
    const productImage = await (0, product_assets_1.downloadProductImage)(product, TEMP_DIR);
    const local = localFootageCandidates(product);
    const usedLocal = new Set();
    const scenes = [];
    const hasKeywordMatch = (text, fileName, textPattern, filePattern, weight) => textPattern.test(text) && filePattern.test(fileName) ? weight : 0;
    function pickLocalForScene(scene, index) {
        const queries = sceneQueries(scene, product, index);
        const sceneText = `${scene.name || ''} ${scene.caption || ''} ${queries.join(' ')}`.toLowerCase();
        const words = sceneText.match(/[a-z0-9]+/g) || [];
        const keywords = words.filter((word) => word.length >= 4);
        const rank = (file) => {
            const name = path_1.default.basename(file).toLowerCase();
            let score = 0;
            for (const word of keywords)
                if (name.includes(word))
                    score += 3;
            score += hasKeywordMatch(sceneText, name, /dog|pet|urine|odor|kennel/, /dog|pet|urine|odor|kennel/, 8);
            score += hasKeywordMatch(sceneText, name, /pasture|hay|field|farm|acre/, /pasture|hay|field|farm|acre/, 8);
            score += hasKeywordMatch(sceneText, name, /compost|biochar|worm|soil|garden/, /compost|biochar|worm|soil|garden|plant/, 8);
            if (/spray|hose|before|after|product|bottle|jug/.test(name))
                score += 2;
            return score;
        };
        const candidate = local
            .filter((file) => !usedLocal.has(file))
            .map((file) => ({ file, score: rank(file) }))
            .sort((a, b) => b.score - a.score)[0];
        return candidate && candidate.score > 0 ? candidate.file : '';
    }
    for (const [index, rawScene] of (scenePlan.scenes || []).slice(0, 5).entries()) {
        const scene = rawScene || {};
        const seconds = Number(scene.seconds || 6);
        if (scene.useProductImage && productImage) {
            scenes.push({ file: productImage, seconds, kind: 'product', source: 'product_image' });
            continue;
        }
        const localFile = pickLocalForScene(scene, index);
        if (localFile) {
            usedLocal.add(localFile);
            scenes.push({ file: localFile, seconds, kind: 'video', source: 'local', query: sceneQueries(scene, product, index)[0] || '' });
            continue;
        }
        const fetched = await (0, pexels_media_1.fetchBrollForScene)(scene, product, TEMP_DIR, index);
        if (fetched?.file) {
            scenes.push({
                file: fetched.file,
                seconds,
                kind: fetched.kind,
                query: fetched.query,
                source: fetched.kind === 'photo' ? 'pexels_photo' : 'pexels_video'
            });
            continue;
        }
        if (productImage) {
            scenes.push({ file: productImage, seconds, kind: 'product', source: 'product_image' });
            continue;
        }
        log('No media source available for scene', { index: index + 1, name: scene.name, queries: sceneQueries(scene, product, index) });
    }
    if (!scenes.length)
        throw new Error('No b-roll or product images available. Add files to footage/, add productImageUrl, or configure PEXELS_API_KEY.');
    return { scenes, productImage };
}
function hookText(product, scenePlan) {
    const firstScene = scenePlan.scenes?.[0];
    return String(firstScene?.caption || firstScene?.name || product.name).slice(0, 80).toUpperCase();
}
async function renderVideo(product, profile, scenePlan) {
    const { scenes, productImage } = await collectSceneFiles(product, scenePlan);
    const voiceoverFile = await (0, video_provider_1.createNarration)(product, scenePlan, profile, TEMP_DIR);
    const videoFile = await (0, ffmpeg_compositor_1.composeVerticalAd)({
        outputName: `${(0, video_utils_1.safeFileName)(product.name)}-scheduled.mp4`,
        scenes,
        productImage,
        voiceoverFile,
        captionText: hookText(product, scenePlan),
        overlayText: (0, product_assets_1.productOverlayText)(product)
    });
    log('Rendered b-roll Ken Burns video', {
        videoFile,
        scenes: scenes.map((scene) => ({ kind: scene.kind, source: scene.source, query: scene.query, seconds: scene.seconds })),
        productImage: !!productImage,
        hasNarration: !!voiceoverFile
    });
    return videoFile;
}
async function main() {
    process.env.VIDEO_STYLE = String(process.env.VIDEO_STYLE || 'broll_ken_burns').toLowerCase();
    process.env.VIDEO_PROVIDER = String(process.env.VIDEO_PROVIDER || 'openai_tts').toLowerCase();
    await loadSecrets();
    await restoreRotationStateFromGcs();
    const products = loadProducts();
    if (!products.length)
        throw new Error('No products configured');
    const { product, variationIndex, variationCount } = pickProduct(products);
    await persistRotationStateToGcs();
    const profile = productCreativeProfile(product);
    log('Scheduled product selected', { videoStyle: process.env.VIDEO_STYLE, product: product.name, id: product.id, variation: `${variationIndex + 1}/${variationCount}` });
    log('Creative mapping selected', { hasScenePlan: !!profile.scenes?.length, hasProductImage: !!product.productImageUrl, brollQueries: product.brollQueries?.length || 0 });
    const scenePlan = await generateScenePlan(product, profile, variationIndex, variationCount);
    log('Generated scene plan', { fullVoiceoverLength: scenePlan.fullVoiceover.length, scenes: scenePlan.scenes.map((scene, index) => ({ idx: index + 1, name: scene.name, seconds: scene.seconds, useProductImage: !!scene.useProductImage, brollQuery: scene.brollQuery })) });
    const platforms = Array.from(new Set((process.env.ENABLE_PLATFORMS || 'youtube,instagram,facebook').toLowerCase().split(',').map((p) => p.trim()).filter(Boolean)));
    const mandatoryPlatformMode = isCiMandatoryPlatformMode();
    const captions = {
        youtube: (0, caption_formatter_1.formatCaption)(product, scenePlan, 'youtube'),
        instagram: (0, caption_formatter_1.formatCaption)(product, scenePlan, 'instagram'),
        facebook: (0, caption_formatter_1.formatCaption)(product, scenePlan, 'facebook'),
        tiktok: (0, caption_formatter_1.formatCaption)(product, scenePlan, 'tiktok'),
        facebookGroups: (0, caption_formatter_1.formatCaption)(product, scenePlan, 'facebook_groups')
    };
    if (String(process.env.DRY_RUN_LOG_ONLY || '').toLowerCase() === 'true') {
        log('Dry run enabled; skipping render and social posting', {
            videoStyle: process.env.VIDEO_STYLE,
            videoProvider: process.env.VIDEO_PROVIDER,
            platforms,
            captions,
            voiceover: scenePlan.fullVoiceover
        });
        return;
    }
    const videoFile = await renderVideo(product, profile, scenePlan);
    const thumbnailFile = createThumbnail(videoFile, product);
    let publicVideoUrl = '';
    if (platforms.includes('instagram') || platforms.includes('facebook') || platforms.includes('tiktok') || platforms.includes('facebook_groups')) {
        publicVideoUrl = await uploadVideoForSocial(videoFile);
    }
    let posted = 0;
    const videoIds = {};
    const platformSuccess = {};
    const platformErrors = {};
    if (platforms.includes('youtube')) {
        try {
            const id = await postToYouTube(videoFile, product.name, captions.youtube, thumbnailFile);
            posted++;
            videoIds.youtubeId = id;
            platformSuccess.youtube = true;
            log('Posted to YouTube', { id });
        }
        catch (error) {
            platformSuccess.youtube = false;
            platformErrors.youtube = String(error?.message || error);
            log('YouTube post failed', error?.message || error);
        }
    }
    if (platforms.includes('instagram')) {
        try {
            const id = await postToInstagram(publicVideoUrl, captions.instagram);
            posted++;
            videoIds.instagramId = id;
            platformSuccess.instagram = true;
            log('Posted to Instagram', { id });
        }
        catch (error) {
            platformSuccess.instagram = false;
            platformErrors.instagram = String(error?.message || error);
            log('Instagram post failed', error?.message || error);
        }
    }
    if (platforms.includes('facebook')) {
        try {
            const id = await postToFacebook(publicVideoUrl, captions.facebook);
            posted++;
            videoIds.facebookId = id;
            platformSuccess.facebook = true;
            log('Posted to Facebook', { id });
        }
        catch (error) {
            platformSuccess.facebook = false;
            platformErrors.facebook = String(error?.message || error);
            log('Facebook post failed', error?.message || error);
        }
    }
    if (platforms.includes('tiktok')) {
        try {
            const result = await (0, social_platforms_1.postToTikTok)(publicVideoUrl, captions.tiktok);
            const skipped = !!result?.skipped;
            if (!skipped)
                posted++;
            platformSuccess.tiktok = !skipped;
            if (skipped)
                platformErrors.tiktok = 'TikTok posting skipped';
            log('Posted to TikTok', result);
        }
        catch (error) {
            platformSuccess.tiktok = false;
            platformErrors.tiktok = String(error?.message || error);
            log('TikTok post failed', error?.message || error);
        }
    }
    if (platforms.includes('facebook_groups')) {
        try {
            const results = await (0, facebook_groups_1.postToFacebookGroups)(product, publicVideoUrl, captions.facebookGroups);
            const successes = results.filter((item) => item.ok).length;
            if (successes > 0)
                posted += successes;
            platformSuccess.facebook_groups = successes > 0;
            if (successes === 0)
                platformErrors.facebook_groups = 'No Facebook group posts succeeded';
            log('Facebook group posting completed', { attempts: results.length, successes });
        }
        catch (error) {
            platformSuccess.facebook_groups = false;
            platformErrors.facebook_groups = String(error?.message || error);
            log('Facebook groups post failed', error?.message || error);
        }
    }
    const metrics = await (0, social_platforms_1.fetchBasicMetrics)(videoIds);
    (0, marketing_engine_1.recordPerformance)({
        productId: product.id,
        productName: product.name,
        hook: hookText(product, scenePlan),
        variant: `scheduled_v${variationIndex + 1}`,
        views: Number(metrics.youtube?.views || metrics.instagram?.views || metrics.facebook?.views || 0),
        likes: Number((metrics.youtube?.likes || 0) + (metrics.instagram?.likes || 0) + (metrics.facebook?.likes || 0)),
        comments: Number((metrics.youtube?.comments || 0) + (metrics.instagram?.comments || 0) + (metrics.facebook?.comments || 0)),
        clicks: 0,
        videoIds,
        analyticsFile: VIDEO_ANALYTICS_FILE
    });
    if (mandatoryPlatformMode) {
        const failedMandatory = platforms.filter((platform) => !platformSuccess[platform]);
        if (failedMandatory.length) {
            const detail = failedMandatory.map((platform) => `${platform}: ${platformErrors[platform] || 'post did not succeed'}`).join('; ');
            throw new Error(`Mandatory enabled platform posting failed (${detail})`);
        }
    }
    if (posted === 0)
        throw new Error('No platform posts succeeded');
    log('Scheduled post completed', { posted, videoFile, publicVideoUrl, thumbnailFile, videoIds, metrics });
}
main().catch((error) => { console.error('Scheduled post failed:', error?.message || error); process.exit(1); });
