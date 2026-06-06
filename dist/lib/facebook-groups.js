"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.postToFacebookGroup = postToFacebookGroup;
exports.postToFacebookGroups = postToFacebookGroups;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const ROOT = process.cwd();
const GROUPS_CONFIG = path_1.default.resolve(ROOT, 'config/facebook-groups.json');
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
function inferTopics(product) {
    const text = `${product?.name || ''} ${product?.category || ''} ${(product?.keywords || []).join(' ')}`.toLowerCase();
    const topics = new Set();
    if (/pasture|hay|field|farm|horse|cattle/.test(text))
        topics.add('pasture');
    if (/garden|compost|worm|biochar|vegetable|flower|plant/.test(text))
        topics.add('garden');
    if (/lawn|grass|turf|dog|urine|humic|fulvic|kelp/.test(text))
        topics.add('lawn');
    if (!topics.size)
        topics.add('lawn');
    return Array.from(topics);
}
async function postToFacebookGroup(groupId, publicVideoUrl, captionText) {
    const accessToken = process.env.FACEBOOK_GROUPS_ACCESS_TOKEN;
    if (!accessToken)
        throw new Error('Missing FACEBOOK_GROUPS_ACCESS_TOKEN');
    if (!/^https?:\/\//i.test(String(publicVideoUrl || '')))
        throw new Error('Facebook group posting requires a public HTTPS video URL');
    const apiVersion = process.env.FACEBOOK_API_VERSION || 'v20.0';
    const host = process.env.FACEBOOK_API_HOST || 'graph.facebook.com';
    const url = `https://${host}/${apiVersion}/${groupId}/videos`;
    const response = await axios_1.default.post(url, {
        file_url: publicVideoUrl,
        description: captionText,
        published: true
    }, { headers: { Authorization: 'Bearer ' + accessToken }, timeout: 120000 });
    const id = response.data?.id || '';
    if (!id)
        throw new Error(`Facebook group ${groupId} did not return video id`);
    return id;
}
async function postToFacebookGroups(product, publicVideoUrl, captionText) {
    const config = readJson(GROUPS_CONFIG, { allowedGroupIds: [], routes: [] });
    const allowed = new Set((config.allowedGroupIds || []).map((id) => String(id)));
    const topics = inferTopics(product);
    const routes = (config.routes || []).filter((route) => {
        const routeTopics = Array.isArray(route.topics) ? route.topics : [];
        const groupId = String(route.groupId || '');
        return groupId && allowed.has(groupId) && routeTopics.some((topic) => topics.includes(topic));
    });
    const results = [];
    for (const route of routes) {
        try {
            const id = await postToFacebookGroup(String(route.groupId), publicVideoUrl, captionText);
            results.push({ groupId: String(route.groupId), label: route.label, id, ok: true });
        }
        catch (error) {
            results.push({ groupId: String(route.groupId), label: route.label, ok: false, error: error?.message || error });
        }
    }
    return results;
}
