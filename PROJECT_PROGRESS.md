# PIXLEMORPHIC AI — Project Progress Log
Updated: 2026-09-19

## Current production status
- Railway production is green.
- Main production commit: 5824ae41fbeca90f1c8f85621d549111ddfb7b03
- Telegram bot image-generation flow is live.
- Redis, FAL, Replicate and Telegram are configured.
- Admin can access all test models; normal plan access remains conservative.

## Image models verified working
- Cinematic
- Realism
- Ultra 8K
- Kontext Pro / EDIT
- Seedream 4.0
- Seedream 4.5
- FLUX.1 [dev]
- GPT Image 2

## Important fixes completed
- Ultra 8K Telegram delivery fallback: direct URL -> streamed multipart upload.
- Ultra 8K output tuned to JPEG and high-fidelity Topaz path.
- GPT Image 2 moved from direct 120s request to FAL Queue submit/poll/result flow.
- GPT Image 2 Telegram delivery hardened with streamed photo upload + document fallback.
- GPT Image 2 output switched from PNG to JPEG for safer 4K delivery.

## Tested FAL provider costs
Observed from before/after FAL balance:
- Seedream 4.0 4K: about $0.03
- Seedream 4.5 4K: about $0.04
- FLUX.1 [dev] test: about $0.10
- GPT Image 2 4K High successful test: about $0.57
- Previous failed GPT Image 2 delivery still incurred provider cost: about $0.56
- Current displayed FAL balance before old-model billing settles: $19.41

## Old-model cost recheck in progress
Sequence already run after $19.41 baseline:
1. Cinematic 4K x1
2. Realism 4K x1
FAL balance had not updated yet. User chose to pause ~1 hour before more tests so billing can settle.
Do not claim individual Cinematic/Realism cost until FAL updates or usage detail isolates them.

## Next cost-test order after billing settles
1. Read updated FAL balance / usage
2. Record combined or isolated Cinematic + Realism cost
3. Ultra 8K x1
4. Kontext Pro x1
5. Build final image-model economics / credit pricing

## Current provider architecture intent
- Nano Banana 2 -> WaveSpeed later
- Nano Banana Pro -> WaveSpeed later
- Kontext -> FAL
- Realism -> FAL for now
- Ultra 8K -> FAL for now
- Seedance 2.0 -> FAL
- Veo 3.1 -> FAL
- Other video mostly WaveSpeed / Segmind

## Cost-protection reality
- Full HELD/COMMITTED credit state machine is NOT implemented yet.
- Current behavior: provider failure does not charge bot credits; successful generation deducts; Telegram delivery failure attempts credit refund.
- Provider-side charges may still occur even if Telegram delivery fails.

## Backup branches
- stable-before-seedream-45
- pre-8k-telegram-delivery-fix
- stable-ui-before-fal-image-integration
- stable-before-gpt-image-2-queue-fix
- stable-before-gpt-image-2-delivery-fix

## Current research direction
Find genuine, lower-cost image APIs/providers and compare same-resolution, same-quality outputs before switching production provider. Priority candidates include Runware, Replicate, Black Forest Labs direct, and Stability AI direct.
