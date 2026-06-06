"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.localProductImage = localProductImage;
exports.downloadProductImage = downloadProductImage;
exports.productOverlayText = productOverlayText;
// @ts-nocheck
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const video_utils_1 = require("./video-utils");
const ROOT = process.cwd();
const PRODUCT_ASSET_DIR = path_1.default.resolve(ROOT, 'assets/products');
const DEFAULT_SITE_BASE_URL = 'https://www.natureswaysoil.com';
function localProductImage(product) {
    const candidates = [
        path_1.default.resolve(PRODUCT_ASSET_DIR, `${product.id}.png`),
        path_1.default.resolve(PRODUCT_ASSET_DIR, `${product.id}.jpg`),
        path_1.default.resolve(PRODUCT_ASSET_DIR, `${(0, video_utils_1.safeFileName)(product.name, 'png')}`),
        path_1.default.resolve(PRODUCT_ASSET_DIR, `${(0, video_utils_1.safeFileName)(product.name, 'jpg')}`)
    ];
    return candidates.find((file) => fs_1.default.existsSync(file)) || '';
}
function encodeUrlPath(url) {
    try {
        const parsed = new URL(url);
        parsed.pathname = parsed.pathname
            .split('/')
            .map((part) => encodeURIComponent(decodeURIComponent(part)))
            .join('/');
        return parsed.toString();
    }
    catch {
        return url;
    }
}
function productImageSource(product) {
    const source = product.productImageUrl || product.imageUrl || product.amazonImageUrl || product.productImagePath || product.imagePath || '';
    if (!source)
        return '';
    if (/^https?:\/\//i.test(source))
        return encodeUrlPath(source);
    if (String(source).startsWith('/')) {
        const base = (process.env.PRODUCT_IMAGE_BASE_URL || DEFAULT_SITE_BASE_URL).replace(/\/$/, '');
        return encodeUrlPath(`${base}${source}`);
    }
    return source;
}
function imageExtension(url) {
    const clean = String(url || '').split('?')[0].toLowerCase();
    if (clean.endsWith('.png'))
        return 'png';
    if (clean.endsWith('.webp'))
        return 'webp';
    return 'jpg';
}
async function downloadProductImage(product, outputDir) {
    const local = localProductImage(product);
    if (local)
        return local;
    const url = productImageSource(product);
    if (!url)
        return '';
    (0, video_utils_1.ensureDir)(outputDir);
    const ext = imageExtension(url);
    const output = path_1.default.resolve(outputDir, `product-${product.id}.${ext}`);
    try {
        const response = await axios_1.default.get(url, { responseType: 'stream', timeout: 60000 });
        await new Promise((resolve, reject) => {
            const writer = fs_1.default.createWriteStream(output);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        return output;
    }
    catch (error) {
        console.log('Product image skipped; continuing with b-roll only', {
            productId: product.id,
            source: url,
            error: error?.response?.status || error?.message || error
        });
        try {
            if (fs_1.default.existsSync(output))
                fs_1.default.unlinkSync(output);
        }
        catch { }
        return '';
    }
}
function productOverlayText(product) {
    if (/2\.5|pasture|hay|acre/i.test(`${product.name} ${product.description}`))
        return 'COVERS UP TO 2–5 ACRES';
    if (/dog|urine|odor|pet/i.test(`${product.name} ${product.description}`))
        return 'PET-SAFE OUTDOOR SUPPORT';
    if (/worm|biochar|compost|living soil/i.test(`${product.name} ${product.description}`))
        return 'WORM CASTINGS + BIOCHAR';
    if (/humic|fulvic|kelp/i.test(`${product.name} ${product.description}`))
        return 'HUMIC + FULVIC + KELP';
    return 'SOIL-FIRST SUPPORT';
}
