"use strict";
// @ts-nocheck
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreHook = scoreHook;
exports.hookVariants = hookVariants;
exports.chooseBestHook = chooseBestHook;
function scoreHook(text) {
    const t = String(text || '').toLowerCase();
    let score = 50;
    if (/you|your/.test(t))
        score += 8;
    if (/fix|stop|boost|recover|destroying|ruining|dead|yellow/.test(t))
        score += 12;
    if (/\?/.test(t))
        score += 6;
    if (t.length < 90)
        score += 6;
    if (/before|after/.test(t))
        score += 8;
    if (/dog|lawn|grass|pasture|soil/.test(t))
        score += 10;
    if (/guarantee|cure|instant/.test(t))
        score -= 25;
    return Math.max(1, Math.min(100, score));
}
function hookVariants(base) {
    return [
        base,
        `${base} 👀`,
        `Most people ignore THIS lawn problem...`,
        `This is why your grass keeps struggling`,
        `The problem may be UNDER your lawn`,
        `Your pasture may need this`,
        `Tired soil? Watch this`,
        `Before you reseed your lawn, try this`
    ];
}
function chooseBestHook(base) {
    const variants = hookVariants(base);
    const scored = variants.map((hook) => ({ hook, score: scoreHook(hook) }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0];
}
