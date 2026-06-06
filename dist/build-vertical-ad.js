"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const ffmpeg_compositor_1 = require("./lib/ffmpeg-compositor");
const pexels_media_1 = require("./lib/pexels-media");
const product_assets_1 = require("./lib/product-assets");
const video_utils_1 = require("./lib/video-utils");
const ROOT = process.cwd();
const OUTPUT_DIR = path_1.default.resolve(ROOT, 'output');
const TEMP_DIR = path_1.default.resolve(ROOT, 'temp-scenes');
const PRODUCTS_PATH = path_1.default.resolve(ROOT, 'config/top-products.json');
function readJson(file, fallback) {
    try {
        return JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
    }
    catch {
        return fallback;
    }
}
function chooseProduct() {
    const raw = readJson(PRODUCTS_PATH, { topProducts: [] });
    const products = raw.topProducts || [];
    if (!products.length)
        throw new Error('No products configured');
    return products[Math.floor(Math.random() * products.length)];
}
function hookCaption(product) {
    const text = `${product.name} ${product.description}`.toLowerCase();
    if (/dog|urine|pet|odor/.test(text))
        return 'DOG URINE RUINING YOUR LAWN?';
    if (/pasture|hay|acre/.test(text))
        return 'YOUR PASTURE MAY NEED THIS';
    if (/worm|biochar|compost/.test(text))
        return 'TIRED SOIL? FIX THE ROOT CAUSE';
    if (/humic|fulvic|kelp/.test(text))
        return 'YELLOW GRASS? START BELOW THE SURFACE';
    return 'SOIL HEALTH CHANGES EVERYTHING';
}
async function build() {
    (0, video_utils_1.ensureDir)(OUTPUT_DIR);
    (0, video_utils_1.ensureDir)(TEMP_DIR);
    const product = chooseProduct();
    console.log('Building vertical marketing ad', { product: product.name });
    const queries = product.brollQueries?.length
        ? product.brollQueries
        : [
            'lush lawn drone shot',
            'spraying lawn with hose sprayer',
            'close-up healthy roots soil',
            'green pasture aerial',
            'garden before after'
        ];
    const sceneFiles = [];
    for (let i = 0; i < Math.min(5, queries.length); i++) {
        try {
            const file = await (0, pexels_media_1.downloadPexelsVideo)(queries[i], TEMP_DIR, i);
            if (file)
                sceneFiles.push(file);
        }
        catch (error) {
            console.log('Scene download failed', { query: queries[i], error: error?.message || error });
        }
    }
    if (!sceneFiles.length)
        throw new Error('No footage downloaded');
    const productImage = await (0, product_assets_1.downloadProductImage)(product, TEMP_DIR);
    const finalVideo = await (0, ffmpeg_compositor_1.composeVerticalAd)({
        outputName: `${(0, video_utils_1.safeFileName)(product.name, 'mp4')}`,
        sceneFiles,
        productImage,
        captionText: hookCaption(product),
        overlayText: (0, product_assets_1.productOverlayText)(product)
    });
    const thumbnail = path_1.default.resolve(OUTPUT_DIR, `${(0, video_utils_1.safeFileName)(product.name, 'jpg')}`);
    const ffmpegThumb = [
        'ffmpeg -y',
        `-i "${finalVideo}"`,
        '-ss 00:00:02',
        '-vframes 1',
        `"${thumbnail}"`
    ].join(' ');
    require('child_process').execSync(ffmpegThumb, { stdio: 'inherit' });
    console.log('Vertical marketing ad completed', {
        finalVideo,
        thumbnail,
        product: product.name,
        scenes: sceneFiles.length
    });
}
build().catch((error) => {
    console.error('Vertical ad build failed:', error?.message || error);
    process.exit(1);
});
