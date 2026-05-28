// @ts-nocheck
import axios from 'axios'

export async function postToTikTok(videoUrl: string, caption: string) {
  if (!process.env.TIKTOK_ACCESS_TOKEN) {
    console.log('TikTok posting skipped: missing TIKTOK_ACCESS_TOKEN')
    return { skipped: true }
  }

  return {
    platform: 'tiktok',
    queued: true,
    videoUrl,
    caption
  }
}

export async function postToFacebookReels(videoUrl: string, caption: string) {
  if (!process.env.FACEBOOK_PAGE_ACCESS_TOKEN || !process.env.FACEBOOK_PAGE_ID) {
    console.log('Facebook Reels skipped: missing page credentials')
    return { skipped: true }
  }

  return {
    platform: 'facebook_reels',
    queued: true,
    videoUrl,
    caption
  }
}

export async function autoReplyTemplates() {
  return [
    'Thanks for checking out Nature\'s Way Soil.',
    'We appreciate the support.',
    'Let us know if you have application questions.',
    'Thanks for supporting a small family business.'
  ]
}

export async function fetchBasicMetrics() {
  return {
    youtube: { views: 0, likes: 0 },
    instagram: { views: 0, likes: 0 },
    tiktok: { views: 0, likes: 0 },
    facebook: { views: 0, likes: 0 }
  }
}
