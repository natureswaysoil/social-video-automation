# Deployment Notes

## Core Stack

- OpenAI for scripts
- OpenAI text-to-speech (TTS) for narration
- Pexels for b-roll
- FFmpeg for captions, narration muxing, and rendering
- GitHub Actions for scheduling
- Google Cloud Run for health monitoring

> Narration provider note: OpenAI TTS is the active narration provider and is
> enforced by `scripts/lib/video-provider.ts` regardless of the `VIDEO_PROVIDER`
> value. The older HeyGen / D-ID avatar integrations are dormant and are not
> part of the posting pipeline; no avatar provider key is required.

## Required Secrets

OPENAI_API_KEY
PEXELS_API_KEY
YOUTUBE_CLIENT_ID
YOUTUBE_CLIENT_SECRET
YOUTUBE_REFRESH_TOKEN
INSTAGRAM_ACCESS_TOKEN
INSTAGRAM_IG_ID

## Recommended Video Style

- Strong hook in first 3 seconds
- Large captions
- Real lawn and pasture footage
- Fast pacing
- Product shown early
- Clear call to action

## Suggested Posting Frequency

- 2 to 4 Shorts/Reels daily
- Rotate products frequently
- Reuse winning hooks
