# Social Video Automation Improvements

This repo now has a stronger creative test workflow and a documented production improvement path for Nature's Way Soil short-form videos.

## What was improved

- Added support for the Google Secret Manager secret named `DiD`.
- Maps `DiD` to `DID_API_KEY` for future D-ID migration work.
- Improved Pexels clip selection to prefer higher-resolution portrait clips.
- Improved script prompting so videos open with a stronger first-three-second hook.
- Added better fallback scene structure for lawn, garden, soil, and pasture products.
- Cleaned up provider logging in the creative test script.
- Made the creative prompt more compliant by avoiding guaranteed-result language.

## Recommended production direction

For Nature's Way Soil, the strongest video mix should be:

1. Real product footage and field footage.
2. Pexels b-roll for supplemental scenes.
3. Limited avatar/spokesperson use for explanation clips.
4. Large burned-in captions for Reels, Shorts, and TikTok.
5. A clear CTA to the website or Amazon listing.

## Best-performing video structure

Use this default sequence:

1. Hook: show the problem immediately.
2. Product hero: bottle, bag, jug, or label shot.
3. Mechanism: soil biology, biochar, humic/fulvic, kelp, yucca, or fertilizer benefit.
4. Application: spraying, watering, spreading, hose-end use, or field application.
5. Result/CTA: healthy lawn, garden, pasture, or improved soil image.

## Next technical upgrades

- Add a provider abstraction layer so the app can switch between HeyGen, D-ID, or FFmpeg assembly.
- Add native FFmpeg video assembly with caption burn-in.
- Add a thumbnail generator.
- Add an analytics loop that tracks hooks, products, and post performance.
- Add platform-specific caption formatting for YouTube Shorts, Instagram Reels, TikTok, and Facebook.
- Add dry-run validation that confirms secrets, products, Pexels access, and social credentials before rendering.

## Suggested env variables

```bash
VIDEO_PROVIDER=heygen
# Future options: did, ffmpeg

DID_API_KEY=
# Google Secret Manager alias currently supported: DiD

PEXELS_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
DRY_RUN_LOG_ONLY=true
ENABLE_PLATFORMS=youtube,instagram
```

## Content guidance

Avoid claims like:

- Guaranteed repair
- Kills disease
- Instant fix
- Pesticide-style claims
- Cure language

Prefer claims like:

- Helps support soil health
- Supports root development
- Helps improve water movement
- Supports nutrient availability
- Designed for lawn, garden, pasture, and soil care routines
