# Nature's Way Soil Social Video Automation

Standalone scheduled product video automation for Nature's Way Soil.

This repo is separate from `natureswaysoil/video` so daily posting does not conflict with product-video testing, lease demos, or development work.

## What it does

- Rotates through the top 5 Nature's Way Soil products
- Generates a fresh 25-35 second script with OpenAI
- Pulls portrait B-roll from Pexels when available
- Creates a vertical b-roll video with OpenAI text-to-speech (TTS) narration
- Renders narration locally with FFmpeg (no avatar provider polling required)
- Posts to YouTube and Instagram when credentials are configured
- Runs 5 scheduled slots per day through GitHub Actions

## Products

Edit:

```text
config/top-products.json
```

Current rotation:

1. Dog Urine Neutralizer & Lawn Revitalizer
2. Liquid Humic & Fulvic Acid with Kelp
3. Enhanced Living Compost with Worm Castings & Biochar
4. Hay, Pasture & Lawn Fertilizer
5. Seaweed & Humic Acid Lawn Treatment

## Facebook groups

If you want to post to Facebook groups, add the approved group IDs to:

```text
config/facebook-groups.json
```

The script will only post to group IDs that appear in that allowlist.

The same file also contains topic-based educational routes for pasture, garden,
and lawn content. Fill in the `groupId` values for the routes you want to use.

The scheduled workflow now prefers `NWS_021` on a reset run so the next post
starts with pasture content instead of repeating the compost creative.

## Local test

```bash
npm install
npm run test:dry
```

To run live posting locally:

```bash
npm run post:scheduled
```

## GitHub Action

Workflow:

```text
.github/workflows/scheduled-posting.yml
```

Default schedule: 5 times per day.

GitHub Actions uses UTC. Current approximate ET slots:

- 7:00 AM
- 8:15 AM
- 11:30 AM
- 1:00 PM
- 6:15 PM

## Required GitHub repo secrets

Add one of these service-account secrets so the Action can read Google Secret Manager:

```text
GOOGLE_CREDENTIALS
```

or:

```text
GOOGLE_SERVICE_ACCOUNT_JSON
```

Optional:

```text
GOOGLE_CLOUD_PROJECT
```

## Required Google Secret Manager secrets

The script can load these common naming styles, for example `OPENAI_API_KEY` or `openai-api-key`.

Minimum required:

```text
OPENAI_API_KEY
PEXELS_API_KEY
```

Narration uses OpenAI text-to-speech (TTS); no separate avatar/voice
provider key is required. The TTS model/voice can be tuned with the optional
`TTS_MODEL` and `TTS_VOICE` variables (see Controls below).

For YouTube posting:

```text
YOUTUBE_CLIENT_ID
YOUTUBE_CLIENT_SECRET
YOUTUBE_REFRESH_TOKEN
```

or:

```text
YT_CLIENT_ID
YT_CLIENT_SECRET
YT_REFRESH_TOKEN
```

For Instagram posting:

```text
INSTAGRAM_ACCESS_TOKEN
INSTAGRAM_IG_ID
```

or:

```text
INSTAGRAM_USER_ID
INSTAGRAM_ACCOUNT_ID
```

## Controls

Useful environment variables:

```text
SEED_PRODUCT_LIMIT=5
VARIATIONS_PER_PRODUCT=5
ENABLE_PLATFORMS=youtube,instagram
YT_PRIVACY_STATUS=public
DRY_RUN_LOG_ONLY=false

# Narration provider is enforced to OpenAI TTS regardless of VIDEO_PROVIDER.
VIDEO_PROVIDER=openai_tts
TTS_MODEL=gpt-4o-mini-tts
TTS_VOICE=alloy
ENABLE_NARRATOR=true
```

> Note: OpenAI TTS is the active narration provider. The legacy D-ID / HeyGen
> avatar integrations are dormant and are not used by the posting pipeline.
> Setting `VIDEO_PROVIDER` to anything other than `openai_tts` logs a notice
> and still falls back to OpenAI TTS.

## Important

Do not commit `.env`, API keys, OAuth tokens, generated private videos, or customer credentials.
