"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const axios_1 = __importDefault(require("axios"));
const video_utils_1 = require("./lib/video-utils");
const ROOT = process.cwd();
const PRODUCTS_FILE = path_1.default.resolve(ROOT, 'config/top-products.json');
const OUTPUT_DIR = path_1.default.resolve(ROOT, 'assets/products');
const SITE_BASE = 'https://www.natureswaysoil.com';
function buildUrl(source) {
    if (!source)
        return '';
    if (/^https?:\/\//i.test(source))
        return source;
    if (source.startsWith('/'))
        return `${SITE_BASE}${source}`;
    return source;
}
function extFor(url) {
    const clean = String(url || '').split('?')[0].toLowerCase();
    if (clean.endsWith('.png'))
        return 'png';
    if (clean.endsWith('.webp'))
        return 'webp';
    return 'jpg';
}
async function download(url, outputFile) {
    const response = await axios_1.default.get(url, { responseType: 'stream', timeout: 60000 });
    await new Promise((resolve, reject) => {
        const writer = fs_1.default.createWriteStream(outputFile);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}
async function main() {
    (0, video_utils_1.ensureDir)(OUTPUT_DIR);
    const products = (0, video_utils_1.readJson)(PRODUCTS_FILE, { topProducts: [] }).topProducts || [];
    let ok = 0;
    let failed = 0;
    for (const product of products) {
        const source = buildUrl(product.productImageUrl || product.imageUrl || product.amazonImageUrl || product.productImagePath || product.imagePath || '');
        if (!source)
            continue;
        const output = path_1.default.resolve(OUTPUT_DIR, `${product.id}.${extFor(source)}`);
        try {
            await download(source, output);
            ok++;
            console.log('Downloaded product image', { productId: product.id, output });
        }
        catch (error) {
            failed++;
            console.log('Failed product image download', { productId: product.id, source, error: error?.message || error });
        }
    }
    console.log(`Product image download complete. success=${ok} failed=${failed}`);
}
main().catch((error) => {
    console.error('download-product-images failed:', error?.message || error);
    process.exit(1);
});
