"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanFootage = scanFootage;
exports.pickFootage = pickFootage;
exports.recommendedFootageChecklist = recommendedFootageChecklist;
// @ts-nocheck
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const video_utils_1 = require("./video-utils");
const ROOT = process.cwd();
const FOOTAGE_DIR = path_1.default.resolve(ROOT, process.env.FOOTAGE_DIR || 'footage');
const INDEX_FILE = path_1.default.resolve(ROOT, process.env.FOOTAGE_INDEX || 'data/footage-index.json');
function scanFootage() {
    (0, video_utils_1.ensureDir)(FOOTAGE_DIR);
    const files = fs_1.default.readdirSync(FOOTAGE_DIR)
        .filter((file) => /\.(mp4|mov|mkv|webm)$/i.test(file))
        .map((file) => {
        const full = path_1.default.resolve(FOOTAGE_DIR, file);
        const stat = fs_1.default.statSync(full);
        return {
            file,
            full,
            bytes: stat.size,
            modifiedAt: stat.mtime.toISOString()
        };
    });
    const payload = {
        updatedAt: new Date().toISOString(),
        files
    };
    fs_1.default.mkdirSync(path_1.default.dirname(INDEX_FILE), { recursive: true });
    fs_1.default.writeFileSync(INDEX_FILE, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
}
function pickFootage(product) {
    const payload = fs_1.default.existsSync(INDEX_FILE)
        ? JSON.parse(fs_1.default.readFileSync(INDEX_FILE, 'utf8'))
        : scanFootage();
    const files = payload.files || [];
    if (!files.length)
        return null;
    const keywords = `${product.name} ${product.category} ${(product.keywords || []).join(' ')}`.toLowerCase();
    const ranked = files
        .map((item) => {
        const name = item.file.toLowerCase();
        let score = 0;
        if (/lawn|grass|yard/.test(name) && /lawn|grass|yard/.test(keywords))
            score += 5;
        if (/pasture|field|hay/.test(name) && /pasture|field|hay/.test(keywords))
            score += 5;
        if (/spray|sprayer|hose/.test(name))
            score += 4;
        if (/before|after/.test(name))
            score += 6;
        return { ...item, score };
    })
        .sort((a, b) => b.score - a.score);
    return ranked[0] || files[0];
}
function recommendedFootageChecklist() {
    return [
        'spraying lawn footage',
        'dry grass before footage',
        'green lawn after footage',
        'close-up soil footage',
        'hose-end sprayer footage',
        'pasture field drone footage',
        'root-zone closeups',
        'walking application footage'
    ];
}
