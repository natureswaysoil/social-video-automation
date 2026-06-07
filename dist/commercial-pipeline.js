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
const pexels_media_1 = require("./lib/pexels-media");
const ffmpeg_compositor_1 = require("./lib/ffmpeg-compositor");
const product_assets_1 = require("./lib/product-assets");
const retention_engine_1 = require("./lib/retention-engine");
const ffmpeg_builder_1 = require("./lib/ffmpeg-builder");
const marketing_engine_1 = require("./lib/marketing-engine");
const caption_formatter_1 = require("./lib/caption-formatter");
const social_platforms_1 = require("./lib/social-platforms");
const video_provider_1 = require("./lib/video-provider");
const video_utils_1 = require("./lib/video-utils");
const ROOT = process.cwd();
const PRODUCTS_PATH = path_1.default.resolve(ROOT, 'config/top-products.json');
const CREATIVE_PATH = path_1.default.resolve(ROOT, 'config/creative-profiles.json');
const OUTPUT_DIR = path_1.default.resolve(ROOT, 'output');
const TEMP_DIR = path_1.default.resolve(ROOT, 'temp-commercial');
const MANIFEST_DIR = path_1.default.resolve(ROOT, 'data/runs');
const FOOTAGE_DIR = path_1.default.resolve(ROOT, process.env.FOOTAGE_DIR || 'footage');
const DEFAULT_PUBLIC_VIDEO_BUCKET = 'natureswaysoil-social-videos';
const PLATFORM_VARIANT_MAP = {
    youtube_shorts: 'youtube',
    instagram_reels: 'instagram',
    facebook_reels: 'facebook',
    tiktok: 'tiktok'
};
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
    'TIKTOK_ACCESS_TOKEN',
    'TIKTOK_OPEN_ID',
    'GCS_PUBLIC_BUCKET',
    'VIDEO_PUBLIC_BUCKET',
    'VIDEO_PUBLIC_URL_BASE'
];
function hasValue(name) {
    const value = process.env[name];
    return !!value && !/your-|your_|changeme|placeholder|paste_|replace_|dummy_|example_/i.test(value);
}
function secretCandidates(name) {
    const upper = name.trim().replace(/[\s-]+/g, '_').toUpperCase();
    return [...new Set([name, upper, upper.toLowerCase(), upper.toLowerCase().replace(/_/g, '-')])];
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
        console.log('Secret Manager lookup skipped for local dry run without ADC credentials');
        return;
    }
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'natureswaysoil-video';
    const client = new secret_manager_1.SecretManagerServiceClient();
    for (const name of SECRET_NAMES) {
        if (hasValue(name) && !enforceSecretManagerAccess)
            continue;
        for (const candidate of secretCandidates(name)) {
            try {
                const [version] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${candidate}/versions/latest` });
                const value = version.payload?.data?.toString().trim();
                if (value) {
                    process.env[name] = value;
                    process.env[candidate] = value;
                    console.log(`Loaded secret: ${candidate}${candidate === name ? '' : ` -> ${name}`}`);
                    break;
                }
            }
            catch (error) {
                if (isNotFoundSecretError(error))
                    continue;
                if (isPermissionDeniedSecretError(error)) {
                    throw new Error(`Secret Manager permission denied for ${candidate}: ${error?.message || error}`);
                }
                console.log(`Could not load secret ${candidate}: ${error?.message || error}`);
                break;
            }
        }
    }
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
function publicBucketName() {
    return pickEnv(['GCS_PUBLIC_BUCKET', 'VIDEO_PUBLIC_BUCKET']) || DEFAULT_PUBLIC_VIDEO_BUCKET;
}
function publicBucketUrlBase(bucket) {
    const explicit = process.env.VIDEO_PUBLIC_URL_BASE?.replace(/\/$/, '') || '';
    return explicit || `https://storage.googleapis.com/${bucket}`;
}
function authHeader(token) {
    return { Authorization: 'Bearer ' + token };
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
        console.log('Could not make uploaded video public. Bucket may use uniform public access.', error?.message || error);
    }
    return `${publicBucketUrlBase(bucketName)}/${objectName.split('/').map(encodeURIComponent).join('/')}`;
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
    const requestBody = {
        snippet: { title: title.slice(0, 95), description, categoryId: '22' },
        status: { privacyStatus: process.env.YT_PRIVACY_STATUS || 'public' }
    };
    const upload = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody,
        media: { body }
    });
    const id = upload.data.id || '';
    if (!id)
        throw new Error('YouTube upload did not return video id');
    if (thumbnailFile && fs_1.default.existsSync(thumbnailFile)) {
        try {
            await youtube.thumbnails.set({ videoId: id, media: { body: fs_1.default.createReadStream(thumbnailFile) } });
        }
        catch (error) {
            console.log('YouTube thumbnail upload failed', error?.message || error);
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
    const container = await axios_1.default.post(`${baseUrl}/${igId}/media`, { media_type: process.env.IG_MEDIA_TYPE || 'REELS', video_url: publicVideoUrl, caption: captionText }, { headers: authHeader(accessToken), timeout: 120000 });
    const creationId = container.data?.id;
    if (!creationId)
        throw new Error('Instagram did not return creation id');
    for (let i = 0; i < 24; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const status = await axios_1.default.get(`${baseUrl}/${creationId}?fields=status_code`, { headers: authHeader(accessToken), timeout: 30000 });
        const code = status.data?.status_code;
        if (code === 'FINISHED')
            break;
        if (code === 'ERROR' || code === 'EXPIRED')
            throw new Error(`Instagram container ${code}`);
    }
    const published = await axios_1.default.post(`${baseUrl}/${igId}/media_publish`, { creation_id: creationId }, { headers: authHeader(accessToken), timeout: 120000 });
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
    }, { headers: authHeader(accessToken), timeout: 120000 });
    const id = response.data?.id || '';
    if (!id)
        throw new Error(`Facebook did not return video id: ${JSON.stringify(response.data)}`);
    return id;
}
function pickProduct() {
    const raw = (0, video_utils_1.readJson)(PRODUCTS_PATH, { topProducts: [] });
    const products = raw.topProducts || [];
    if (!products.length)
        throw new Error('No products configured');
    const requested = process.env.PRODUCT_ID;
    return requested ? products.find((p) => p.id === requested) || products[0] : products[Math.floor(Math.random() * products.length)];
}
function creativeFor(product) {
    const raw = (0, video_utils_1.readJson)(CREATIVE_PATH, { defaults: {}, profiles: {} });
    return { ...(raw.defaults || {}), ...((raw.profiles || {})[product.id] || {}) };
}
function fallbackQueries(product) {
    const text = `${product.name} ${product.description} ${product.category}`.toLowerCase();
    if (/dog|urine|pet|odor/.test(text))
        return ['dog on green lawn', 'yellow lawn patch', 'spraying backyard lawn', 'clean patio dog', 'lush backyard grass'];
    if (/pasture|hay|acre|field/.test(text))
        return ['green pasture field', 'spraying farm field', 'hay field grass', 'lush grass close up', 'farm pasture sunset'];
    if (/compost|worm|biochar|soil revitalizer/.test(text))
        return ['hands holding rich soil', 'raised bed garden soil', 'compost close up', 'vegetable garden raised bed', 'healthy plant roots'];
    return ['lush green lawn', 'spraying lawn', 'healthy soil close up', 'garden watering plants', 'green grass close up'];
}
function normalizedScenes(scenePlan, fallbackSceneQueries) {
    if (Array.isArray(scenePlan?.scenes) && scenePlan.scenes.length)
        return scenePlan.scenes.slice(0, 5);
    return fallbackSceneQueries.slice(0, 5).map((query, idx) => ({
        name: `Scene ${idx + 1}`,
        seconds: idx === 0 ? 3 : 5,
        brollQuery: query
    }));
}
function localFootageCandidates(product) {
    if (!fs_1.default.existsSync(FOOTAGE_DIR))
        return [];
    const files = fs_1.default.readdirSync(FOOTAGE_DIR).filter((f) => /\.(mp4|mov|mkv|webm)$/i.test(f)).map((f) => path_1.default.resolve(FOOTAGE_DIR, f));
    const text = `${product.name} ${product.category}`.toLowerCase();
    return files.sort((a, b) => {
        const an = path_1.default.basename(a).toLowerCase();
        const bn = path_1.default.basename(b).toLowerCase();
        const score = (name) => {
            let s = 0;
            if (/dog|pet|urine/.test(text) && /dog|pet|urine|lawn/.test(name))
                s += 5;
            if (/pasture|hay|field/.test(text) && /pasture|hay|field|farm/.test(name))
                s += 5;
            if (/compost|biochar|worm/.test(text) && /compost|soil|worm|garden/.test(name))
                s += 5;
            if (/spray|hose|before|after/.test(name))
                s += 3;
            return s;
        };
        return score(bn) - score(an);
    });
}
async function generateScenePlan(product, profile, hook) {
    if (!process.env.OPENAI_API_KEY) {
        return { fullVoiceover: `${hook}. ${product.description}. See full product details at natureswaysoil.com.`, scenes: fallbackQueries(product).slice(0, 5).map((query, i) => ({ name: `Scene ${i + 1}`, seconds: i === 0 ? 3 : 5, voiceover: product.description, brollQuery: query })) };
    }
    const client = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Build a commercial short-form ad scene plan for Nature's Way Soil.
Product: ${product.name}
Description: ${product.description}
Hook: ${hook}
Audience: ${profile.audience || 'lawn care, gardeners, land owners, homesteaders'}
Use five scenes, 22-32 seconds total.
Use simple stock-video search queries like "green lawn", "spraying lawn", "rich soil", "pasture field". Avoid complex sentence queries.
Require: product visible early, b-roll focused, narrator as support only, bold captions, CTA.
Avoid guaranteed results, disease claims, pesticide claims.
Return JSON only: {"fullVoiceover":"...","scenes":[{"name":"...","seconds":5,"voiceover":"...","brollQuery":"...","caption":"..."}]}`;
    const res = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 800 });
    const text = res.choices[0]?.message?.content || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match)
        throw new Error('OpenAI did not return JSON scene plan');
    return JSON.parse(match[0]);
}
async function makeThumbnail(videoFile, product, hook) {
    const thumbnail = path_1.default.resolve(OUTPUT_DIR, `${(0, video_utils_1.safeFileName)(product.name)}-thumbnail.jpg`);
    if (process.env.OPENAI_API_KEY && String(process.env.USE_DALLE_THUMBNAIL || 'true').toLowerCase() === 'true') {
        try {
            const client = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
            const promptParts = (0, ffmpeg_builder_1.buildThumbnailPrompt)(product);
            const prompt = [
                `Create a product-focused vertical social thumbnail for Nature's Way Soil.`,
                `Headline: ${promptParts.headline}`,
                `Subheadline: ${promptParts.subheadline}`,
                `Visual style: ${promptParts.visual}`,
                `Hook context: ${hook}`,
                `Brand CTA should direct viewers to natureswaysoil.com.`,
                'No text clutter, no claims of guaranteed results.'
            ].join('\n');
            const image = await client.images.generate({
                model: process.env.THUMBNAIL_IMAGE_MODEL || 'dall-e-3',
                prompt,
                size: '1024x1024',
                quality: 'standard'
            });
            const b64 = image.data?.[0]?.b64_json;
            if (b64) {
                fs_1.default.writeFileSync(thumbnail, Buffer.from(b64, 'base64'));
                return thumbnail;
            }
        }
        catch (error) {
            console.log('DALL-E thumbnail generation failed; using frame extract fallback', { error: error?.message || error });
        }
    }
    (0, child_process_1.execSync)(`ffmpeg -y -loglevel error -i "${videoFile}" -ss 00:00:02 -vframes 1 "${thumbnail}"`, { stdio: 'inherit' });
    return thumbnail;
}
function exportPlatformVariants(masterFile, product) {
    const variants = [];
    const specs = [
        { platform: 'youtube_shorts', suffix: 'shorts', maxSeconds: 60 },
        { platform: 'instagram_reels', suffix: 'reels', maxSeconds: 90 },
        { platform: 'tiktok', suffix: 'tiktok', maxSeconds: 60 },
        { platform: 'facebook_reels', suffix: 'facebook', maxSeconds: 90 }
    ];
    for (const spec of specs) {
        const out = path_1.default.resolve(OUTPUT_DIR, `${(0, video_utils_1.safeFileName)(product.name)}-${spec.suffix}.mp4`);
        (0, child_process_1.execSync)(`ffmpeg -y -i "${masterFile}" -t ${spec.maxSeconds} -c copy "${out}"`, { stdio: 'inherit' });
        variants.push({ ...spec, file: out });
    }
    return variants;
}
async function uploadAutomatically(variants, context) {
    if (String(process.env.AUTO_UPLOAD || 'false').toLowerCase() !== 'true') {
        return variants.map(v => ({ platform: v.platform, skipped: true, reason: 'AUTO_UPLOAD not enabled', file: v.file }));
    }
    const enabled = String(process.env.ENABLE_PLATFORMS || 'youtube,instagram,facebook,tiktok')
        .toLowerCase()
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    const captions = {
        youtube: (0, caption_formatter_1.formatCaption)(context.product, context.scenePlan, 'youtube'),
        instagram: (0, caption_formatter_1.formatCaption)(context.product, context.scenePlan, 'instagram'),
        facebook: (0, caption_formatter_1.formatCaption)(context.product, context.scenePlan, 'facebook'),
        tiktok: (0, caption_formatter_1.formatCaption)(context.product, context.scenePlan, 'tiktok')
    };
    const results = [];
    for (const variant of variants) {
        const target = PLATFORM_VARIANT_MAP[variant.platform] || variant.platform;
        if (!enabled.includes(target)) {
            results.push({ platform: variant.platform, skipped: true, reason: `Platform ${target} not enabled`, file: variant.file });
            continue;
        }
        try {
            if (target === 'youtube') {
                const id = await postToYouTube(variant.file, context.product.name, captions.youtube, context.thumbnail);
                results.push({ platform: variant.platform, posted: true, id, file: variant.file });
                continue;
            }
            const publicUrl = await uploadVideoForSocial(variant.file);
            if (target === 'instagram') {
                const id = await postToInstagram(publicUrl, captions.instagram);
                results.push({ platform: variant.platform, posted: true, id, file: variant.file, publicUrl });
            }
            else if (target === 'facebook') {
                const id = await postToFacebook(publicUrl, captions.facebook);
                results.push({ platform: variant.platform, posted: true, id, file: variant.file, publicUrl });
            }
            else if (target === 'tiktok') {
                const result = await (0, social_platforms_1.postToTikTok)(publicUrl, captions.tiktok);
                results.push({ platform: variant.platform, posted: true, ...result, file: variant.file, publicUrl });
            }
            else {
                results.push({ platform: variant.platform, skipped: true, reason: `No posting handler for ${target}`, file: variant.file });
            }
        }
        catch (error) {
            results.push({ platform: variant.platform, failed: true, error: error?.message || error, file: variant.file });
        }
    }
    return results;
}
async function main() {
    await loadSecrets();
    (0, video_utils_1.ensureDir)(OUTPUT_DIR);
    (0, video_utils_1.ensureDir)(TEMP_DIR);
    (0, video_utils_1.ensureDir)(MANIFEST_DIR);
    (0, video_utils_1.ensureDir)(FOOTAGE_DIR);
    const product = pickProduct();
    const profile = creativeFor(product);
    const baseHook = product.hook || `${product.name} can help support better soil.`;
    const bestHook = (0, retention_engine_1.chooseBestHook)(baseHook);
    console.log('Commercial pipeline selected product', { product: product.name, hook: bestHook });
    const scenePlan = await generateScenePlan(product, profile, bestHook.hook);
    const local = localFootageCandidates(product);
    const usedLocal = new Set();
    const scenes = [];
    const productImage = await (0, product_assets_1.downloadProductImage)(product, TEMP_DIR);
    const fallbackSceneQueries = fallbackQueries(product);
    const localScore = (file, text) => {
        const fileName = path_1.default.basename(file).toLowerCase();
        return text
            .split(/\s+/)
            .filter(Boolean)
            .reduce((score, token) => score + (fileName.includes(token) ? 1 : 0), 0);
    };
    for (const [i, rawScene] of normalizedScenes(scenePlan, fallbackSceneQueries).entries()) {
        const scene = rawScene || {};
        const seconds = Number(scene.seconds || 5);
        if (scene.useProductImage && productImage) {
            scenes.push({ file: productImage, seconds, kind: 'product' });
            continue;
        }
        const queryText = `${scene.name || ''} ${scene.caption || ''} ${scene.brollQuery || ''} ${(scene.brollQueries || []).join(' ')}`.toLowerCase();
        const localCandidate = local
            .filter((file) => !usedLocal.has(file))
            .map((file) => ({ file, score: localScore(file, queryText) }))
            .sort((a, b) => b.score - a.score)[0];
        if (localCandidate?.score > 0) {
            usedLocal.add(localCandidate.file);
            scenes.push({ file: localCandidate.file, seconds, kind: 'video' });
            continue;
        }
        const fetched = await (0, pexels_media_1.fetchBrollForScene)(scene, product, TEMP_DIR, i);
        if (fetched?.file) {
            scenes.push({ file: fetched.file, seconds, kind: fetched.kind });
            continue;
        }
        if (productImage)
            scenes.push({ file: productImage, seconds, kind: 'product' });
    }
    if (!scenes.length)
        throw new Error('No footage available. Add .mp4 files to footage/ or check PEXELS_API_KEY.');
    let voiceoverFile = '';
    if (String(process.env.ENABLE_NARRATOR || 'true').toLowerCase() !== 'false')
        voiceoverFile = await (0, video_provider_1.createNarration)(product, scenePlan, profile, TEMP_DIR);
    const master = await (0, ffmpeg_compositor_1.composeVerticalAd)({ outputName: `${(0, video_utils_1.safeFileName)(product.name)}-master.mp4`, scenes, voiceoverFile, productImage, captionText: bestHook.hook, overlayText: (0, product_assets_1.productOverlayText)(product) });
    const thumbnail = await makeThumbnail(master, product, bestHook.hook);
    const variants = exportPlatformVariants(master, product);
    const uploadResults = await uploadAutomatically(variants, { product, scenePlan, thumbnail });
    const run = { runId: Date.now(), createdAt: new Date().toISOString(), product, hook: bestHook, scenePlan, scenes, voiceoverFile, master, thumbnail, variants, uploadResults };
    const manifestFile = path_1.default.resolve(MANIFEST_DIR, `${run.runId}-${(0, video_utils_1.safeFileName)(product.name)}.json`);
    (0, video_utils_1.writeJson)(manifestFile, run);
    (0, marketing_engine_1.recordPerformance)({ productId: product.id, productName: product.name, hook: bestHook.hook, variant: 'commercial_pipeline', views: 0, likes: 0, comments: 0, clicks: 0, output: master });
    console.log('Commercial pipeline completed', { master, thumbnail, manifestFile, variants: variants.map(v => v.platform) });
}
main().catch((error) => { console.error('Commercial pipeline failed:', error?.message || error); process.exit(1); });
