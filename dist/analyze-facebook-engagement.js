"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const ACTIVE_GROUPS_FILE = 'data/active-facebook-groups.json';
const POSTS_LOG_FILE = 'data/facebook-posts-log.json';
async function analyzeFacebookGroups() {
    console.log('🔍 Starting Facebook Group Engagement Analysis for Nature’s Way Soil\n');
    // Load active groups
    let groups = [];
    if (fs_1.default.existsSync(ACTIVE_GROUPS_FILE)) {
        groups = JSON.parse(fs_1.default.readFileSync(ACTIVE_GROUPS_FILE, 'utf-8'));
    }
    else {
        console.log('⚠️ No active-facebook-groups.json found. Run discovery first.');
        return;
    }
    // Load post logs
    let posts = [];
    if (fs_1.default.existsSync(POSTS_LOG_FILE)) {
        posts = JSON.parse(fs_1.default.readFileSync(POSTS_LOG_FILE, 'utf-8'));
    }
    console.log(`📊 Analyzing ${groups.length} active groups...\n`);
    const analysis = groups.map(group => {
        const groupPosts = posts.filter(p => p.groupId === group.groupId);
        let totalComments = 0;
        let totalLikes = 0;
        let totalShares = 0;
        let postCount = groupPosts.length;
        groupPosts.forEach(post => {
            totalComments += post.engagement?.comments || 0;
            totalLikes += post.engagement?.likes || 0;
            totalShares += post.engagement?.shares || 0;
        });
        const avgComments = postCount > 0 ? Math.round(totalComments / postCount) : 0;
        const avgLikes = postCount > 0 ? Math.round(totalLikes / postCount) : 0;
        // Simple engagement score (0-100)
        let score = 50;
        if (avgComments >= 15)
            score += 30;
        else if (avgComments >= 8)
            score += 15;
        if (avgLikes >= 80)
            score += 20;
        else if (avgLikes >= 40)
            score += 10;
        if (group.activityScore)
            score = Math.max(score, group.activityScore);
        const engagementRate = group.members > 0 ? Math.round((avgComments + avgLikes) / group.members * 1000) / 10 : 0; // rough %
        return {
            name: group.name,
            members: group.members,
            activityScore: group.activityScore || 'N/A',
            postsAnalyzed: postCount,
            avgComments,
            avgLikes,
            avgShares: Math.round(totalShares / postCount) || 0,
            estimatedEngagementRate: engagementRate + '%',
            score: Math.min(100, Math.round(score)),
            recommended: score >= 75
        };
    });
    // Sort by score descending
    analysis.sort((a, b) => b.score - a.score);
    // Output results
    console.log('🏆 Top Facebook Groups by Engagement Score\n');
    analysis.forEach((group, index) => {
        const rec = group.recommended ? '✅ RECOMMENDED' : '   ';
        console.log(`${index + 1}. ${rec} ${group.name}`);
        console.log(`   Members: ${group.members.toLocaleString()} | Activity: ${group.activityScore}`);
        console.log(`   Avg Comments: ${group.avgComments} | Avg Likes: ${group.avgLikes}`);
        console.log(`   Score: ${group.score}/100 | Est. Engagement: ${group.estimatedEngagementRate}`);
        console.log('');
    });
    if (analysis.length === 0) {
        console.log('No groups to analyze yet. Post some videos first!');
    }
}
analyzeFacebookGroups().catch(console.error);
