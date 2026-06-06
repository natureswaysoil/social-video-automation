"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const openai_1 = __importDefault(require("openai"));
const child_process_1 = require("child_process");
const secret_manager_1 = require("@google-cloud/secret-manager");
const did_provider_1 = require("./lib/did-provider");
const pexels_media_1 = require("./lib/pexels-media");
const ffmpeg_compositor_1 = require("./lib/ffmpeg-compositor");
const product_assets_1 = require("./lib/product-assets");
const retention_engine_1 = require("./lib/retention-engine");
const marketing_engine_1 = require("./lib/marketing-engine");
const video_utils_1 = require("./lib/video-utils");
const ROOT = process.cwd();
const PRODUCTS_PATH = path_1.default.resolve(ROOT, 'config/top-products.json');
const CREATIVE_PATH = path_1.default.resolve(ROOT, 'config/creative-profiles.json');
const OUTPUT_DIR = path_1.default.resolve(ROOT, 'output');
const TEMP_DIR = path_1.default.resolve(ROOT, 'temp-commercial');
const MANIFEST_DIR = path_1.default.resolve(ROOT, 'data/runs');
const FOOTAGE_DIR = path_1.default.resolve(ROOT, process.env.FOOTAGE_DIR || 'footage');
const SECRET_NAMES = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'PEXELS_API_KEY', 'DID_API_KEY', 'DiD'];
function hasValue(name) {
    const value = process.env[name];
    return !!value && !/your-|your_|changeme|placeholder|paste_|replace_|dummy_|example_/i.test(value);
}
function secretCandidates(name) {
    const upper = name.trim().replace(/[\s-]+/g, '_').toUpperCase();
    return [...new Set([name, upper, upper.toLowerCase(), upper.toLowerCase().replace(/_/g, '-')])];
}
async function loadSecrets() {
    if (String(process.env.USE_SECRET_MANAGER || 'true').toLowerCase() === 'false')
        return;
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'natureswaysoil-video';
    const client = new secret_manager_1.SecretManagerServiceClient();
    for (const name of SECRET_NAMES) {
        if (hasValue(name))
            continue;
        for (const candidate of secretCandidates(name)) {
            try {
                const [version] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${candidate}/versions/latest` });
                const value = version.payload?.data?.toString().trim();
                if (value) {
                    process.env[name] = value;
                    process.env[candidate] = value;
                    if (candidate === 'DiD' || name === 'DiD')
                        process.env.DID_API_KEY = value;
                    console.log(`Loaded secret: ${candidate}${candidate === name ? '' : ` -> ${name}`}`);
                    break;
                }
            }
            catch (error) {
                if (Number(error?.code) === 5 || String(error?.message || '').includes('NOT_FOUND'))
                    continue;
                break;
            }
        }
    }
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
        return { fullVoiceover: `${hook}. ${product.description}. Shop Nature's Way Soil today.`, scenes: fallbackQueries(product).slice(0, 5).map((query, i) => ({ name: `Scene ${i + 1}`, seconds: i === 0 ? 3 : 5, voiceover: product.description, brollQuery: query })) };
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
    (0, child_process_1.execSync)(`ffmpeg -y -i "${videoFile}" -ss 00:00:02 -vframes 1 "${thumbnail}"`, { stdio: 'inherit' });
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
async function uploadAutomatically(variants, manifest) {
    if (String(process.env.AUTO_UPLOAD || 'false').toLowerCase() !== 'true')
        return variants.map(v => ({ platform: v.platform, skipped: true, reason: 'AUTO_UPLOAD not enabled', file: v.file }));
    return variants.map(v => ({ platform: v.platform, queued: true, file: v.file }));
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
    const sceneFiles = [];
    for (const file of localFootageCandidates(product).slice(0, 5))
        sceneFiles.push(file);
    const queries = [...(scenePlan.scenes || []).map((s) => s.brollQuery).filter(Boolean), ...(product.brollQueries || []), ...fallbackQueries(product)];
    for (let i = 0; sceneFiles.length < 5 && i < queries.length; i++) {
        const query = queries[i];
        try {
            const file = await (0, pexels_media_1.downloadPexelsVideo)(query, TEMP_DIR, i);
            if (file)
                sceneFiles.push(file);
        }
        catch (error) {
            console.log('Footage ingestion failed', { query, error: error?.message || error });
        }
    }
    if (!sceneFiles.length)
        throw new Error('No footage available. Add .mp4 files to footage/ or check PEXELS_API_KEY.');
    let narratorVideo = '';
    if (String(process.env.ENABLE_NARRATOR || 'true').toLowerCase() !== 'false') {
        const narratorId = await (0, did_provider_1.createDidVideo)(product, scenePlan, profile);
        narratorVideo = await (0, did_provider_1.pollDidVideo)(narratorId);
    }
    const productImage = await (0, product_assets_1.downloadProductImage)(product, TEMP_DIR);
    const master = await (0, ffmpeg_compositor_1.composeVerticalAd)({ outputName: `${(0, video_utils_1.safeFileName)(product.name)}-master.mp4`, sceneFiles, narratorVideo, productImage, captionText: bestHook.hook, overlayText: (0, product_assets_1.productOverlayText)(product) });
    const thumbnail = await makeThumbnail(master, product, bestHook.hook);
    const variants = exportPlatformVariants(master, product);
    const uploadResults = await uploadAutomatically(variants, { product, scenePlan });
    const run = { runId: Date.now(), createdAt: new Date().toISOString(), product, hook: bestHook, scenePlan, sceneFiles, narratorVideo, master, thumbnail, variants, uploadResults };
    const manifestFile = path_1.default.resolve(MANIFEST_DIR, `${run.runId}-${(0, video_utils_1.safeFileName)(product.name)}.json`);
    (0, video_utils_1.writeJson)(manifestFile, run);
    (0, marketing_engine_1.recordPerformance)({ productId: product.id, productName: product.name, hook: bestHook.hook, variant: 'commercial_pipeline', views: 0, likes: 0, comments: 0, clicks: 0, output: master });
    console.log('Commercial pipeline completed', { master, thumbnail, manifestFile, variants: variants.map(v => v.platform) });
}
main().catch((error) => { console.error('Commercial pipeline failed:', error?.message || error); process.exit(1); });
