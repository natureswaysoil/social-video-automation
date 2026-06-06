"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDir = ensureDir;
exports.slugify = slugify;
exports.wrapCaption = wrapCaption;
exports.safeFileName = safeFileName;
exports.readJson = readJson;
exports.writeJson = writeJson;
exports.pickHook = pickHook;
exports.recordHookUse = recordHookUse;
// @ts-nocheck
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function ensureDir(dir) {
    fs_1.default.mkdirSync(dir, { recursive: true });
}
function slugify(input) {
    return String(input || 'video')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'video';
}
function wrapCaption(text, max = 28) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (next.length > max && line) {
            lines.push(line);
            line = word;
        }
        else {
            line = next;
        }
    }
    if (line)
        lines.push(line);
    return lines.slice(0, 3).join('\\n');
}
function safeFileName(input, ext = '') {
    const base = slugify(input);
    return ext ? `${base}.${ext.replace(/^\./, '')}` : base;
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
    ensureDir(path_1.default.dirname(file));
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function pickHook(product, profile, analytics) {
    const hooks = Array.isArray(profile?.hooks) && profile.hooks.length
        ? profile.hooks
        : [
            `Stop treating the grass. Start feeding the soil.`,
            `Your lawn problem may actually be a soil problem.`,
            `This is a better way to support stressed grass.`,
            `For better growth, start below the surface.`
        ];
    const scores = analytics?.hookScores || {};
    const ranked = hooks
        .map((hook, index) => ({ hook, index, score: Number(scores[hook]?.score || 0), uses: Number(scores[hook]?.uses || 0) }))
        .sort((a, b) => (b.score - a.score) || (a.uses - b.uses) || (a.index - b.index));
    return ranked[0]?.hook || hooks[0];
}
function recordHookUse(analyticsFile, hook, productId) {
    const analytics = readJson(analyticsFile, { hookScores: {}, productRuns: {} });
    analytics.hookScores[hook] = analytics.hookScores[hook] || { uses: 0, score: 0 };
    analytics.hookScores[hook].uses += 1;
    analytics.productRuns[productId] = analytics.productRuns[productId] || { runs: 0 };
    analytics.productRuns[productId].runs += 1;
    analytics.lastUpdatedAt = new Date().toISOString();
    writeJson(analyticsFile, analytics);
    return analytics;
}
