"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const video_utils_1 = require("./lib/video-utils");
const social_platforms_1 = require("./lib/social-platforms");
const ROOT = process.cwd();
const ANALYTICS_FILE = path_1.default.resolve(ROOT, process.env.VIDEO_ANALYTICS_FILE || 'data/video-analytics.json');
async function main() {
    const analytics = (0, video_utils_1.readJson)(ANALYTICS_FILE, { hooks: {}, videos: [] });
    const videos = Array.isArray(analytics.videos) ? analytics.videos : [];
    let updated = 0;
    for (const video of videos) {
        if (!video || !video.videoIds)
            continue;
        const ageMs = Date.now() - new Date(video.recordedAt || 0).getTime();
        if (!Number.isFinite(ageMs) || ageMs < 24 * 60 * 60 * 1000)
            continue;
        if (video.metricsFetchedAt)
            continue;
        const metrics = await (0, social_platforms_1.fetchBasicMetrics)(video.videoIds);
        video.views = Number(metrics.youtube?.views || metrics.instagram?.views || metrics.facebook?.views || video.views || 0);
        video.likes = Number((metrics.youtube?.likes || 0) + (metrics.instagram?.likes || 0) + (metrics.facebook?.likes || 0));
        video.comments = Number((metrics.youtube?.comments || 0) + (metrics.instagram?.comments || 0) + (metrics.facebook?.comments || 0));
        video.metrics = metrics;
        video.metricsFetchedAt = new Date().toISOString();
        updated++;
    }
    analytics.lastUpdatedAt = new Date().toISOString();
    (0, video_utils_1.writeJson)(ANALYTICS_FILE, analytics);
    console.log(`Analytics refresh complete: updated ${updated} record(s).`);
}
main().catch((error) => {
    console.error('fetch-analytics failed:', error?.message || error);
    process.exit(1);
});
