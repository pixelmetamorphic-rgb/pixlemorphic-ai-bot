# PIXLEMORPHIC — FINAL VIDEO API PROVIDER MATRIX (public-price snapshot, 2026-09-24)

Scope: ONE existing Telegram bot, ONE shared credit wallet; no production video changes and NO paid inference authorized. This is a sourced rate-routing shortlist, not an SLA, quality benchmark or guarantee of universal lowest price. Where a provider advertises a 'from' price without disclosing audio/resolution/duration, it is recorded as unqualified, not declared cheaper than a matched endpoint.

## Recommended ROUTES by exact model/tier
| Family | Exact version / mode | Preferred provider | Public USD price | Backup or exception | Official source |
|---|---|---|---:|---|---|
| Kling | VIDEO 3 Standard 720p no audio | Runware (configured) | $0.084/s | fal and WaveSpeed same disclosed rate; Kie claims from $0.07/s but unspecified tier | https://runware.ai/docs/models/klingai-video-3-0-standard |
| Kling | VIDEO 3 Standard 720p with native audio | Runware | $0.126/s | fal matches | https://runware.ai/docs/models/klingai-video-3-0-standard |
| Kling | VIDEO 3 Pro 1080p no audio / audio | Runware | $0.112 / $0.168/s | fal matches | https://runware.ai/docs/models/klingai-video-3-0-pro |
| Kling | Omni O3 Standard 720p video-input edit, no audio | Runware | $0.126/output sec | Omni basic no input no audio $0.084/s | https://runware.ai/docs/models/klingai-video-3-0-omni-standard |
| Kling | Omni O3 Pro 1080p video-input edit, no audio | Runware | $0.168/output sec | Confirm params before launch | https://runware.ai/docs/models/klingai-video-3-0-omni-pro |
| Kling | V3 Motion Control Standard, reference video + character image | Replicate (configured) | $0.07/output sec | Pro $0.12/s; not same path as Kling T2V | https://replicate.com/kwaivgi/kling-v3-motion-control |
| Wan | WAN 3.0 standard 720p / 1080p globally | Alibaba Cloud DIRECT (new key, eligible global region) | $0.082513 / $0.165025/s | Runware configured $0.10 / $0.20/s, fallback | https://www.alibabacloud.com/help/en/model-studio/wan3-0-video |
| Wan | WAN 3.0 Prime 720p globally (optional) | Alibaba Cloud DIRECT | $0.127199/s | Singapore $0.14/s | https://www.alibabacloud.com/help/en/model-studio/model-pricing |
| Wan | WAN 2.7 1080p older HD price alternative | fal (configured) | $0.15/s | 3.0 newer $0.165025 direct; not equivalent quality | https://fal.ai/models/fal-ai/wan/v2.7/text-to-video |
| Happy Horse | 1.1 T2V 720p / 1080p global | Alibaba Cloud DIRECT | $0.123769 / $0.165026/s | Runware $0.14 / $0.18/s and includes I2V/ref support | https://www.alibabacloud.com/help/en/model-studio/happyhorse-1-1-t2v |
| Seedance | 1.0 Lite T2V/I2V 480p / 720p | Replicate (configured) | $0.018 / $0.036/s | 1080p $0.072/s | https://replicate.com/bytedance/seedance-1-lite |
| Seedance | 1.5 Pro 720p with audio | fal (configured) | ~ $0.052/s (official ~$0.26/5s) | Token-priced; depends dimensions, duration, FPS and audio | https://fal.ai/models/fal-ai/bytedance/seedance/v1.5/pro/text-to-video |
| Seedance | 2.0 Fast 480p / 720p | Runware (configured) | $0.06 / $0.13/s | 720p V2V $0.167/s | https://runware.ai/docs/models/bytedance-seedance-2-0-fast |
| Seedance | 2.0 Standard 480p / 720p / 1080p | Runware | $0.07 / $0.16 / $0.40/s | 720p V2V $0.219/s | https://runware.ai/docs/models/bytedance-seedance-2-0 |
| Seedance | 2.0 Mini 480/720 (optional distinct tier) | Runway official direct | $0.16/s, $0.64 minimum | Not priced below Runware 2.0 Fast, but distinct model | https://docs.dev.runwayml.com/guides/pricing/ |
| Seedance | 2.5 Standard 480 / 720 / 1080 T2V/I2V | Runware (configured) | $0.102 / $0.23 / $0.614/s | WaveSpeed standard, fal and Runway standard more expensive on matched visible tiers | https://runware.ai/docs/models/bytedance-seedance-2-5 |
| Seedance | 2.5 TURBO 720p / 1080p T2V without reference videos | WaveSpeedAI (new key) | $0.20 / $0.22/s | DISTINCT faster/budget tier from 2.5 Standard; references add charges | https://wavespeed.ai/models/bytedance/seedance-2.5/text-to-video-turbo |
| Veo | 3.1 Lite 720p no audio / audio | Runware (configured) | $0.03 / $0.05/s | Direct Google 720p audio same $0.05/s | https://runware.ai/docs/models/google-veo-3-1-lite |
| Veo | 3.1 Lite 1080p no audio / audio | Runware | $0.05 / $0.08/s | Direct Google audio same $0.08/s | https://runware.ai/docs/models/google-veo-3-1-lite |
| Veo | 3.1 Fast 720p WITH audio / 1080p WITH audio | Google Gemini DIRECT (new key) | $0.10 / $0.12/s | Runware Fast audio $0.15/s; Runware Fast no audio $0.10/s | https://ai.google.dev/gemini-api/docs/pricing |
| Veo | 3.1 STANDARD/Quality 1080p T2V/I2V | Kie (configured), provisional advertised rate | $1.28 / video (advertised versus Google's $3.20/8s) | Verify live API model ID, 8-sec clip, audio and fulfilled billing; official Google $0.40/s fallback | https://kie.ai/ |
| Veo | 3.1 STANDARD/Quality 4K T2V/I2V | Kie (configured), provisional advertised rate | $1.85 / video (advertised versus Google's $4.80/8s) | Must verify request-specific price/availability before commercial quote | https://kie.ai/ |
| MiniMax | H3 MAX TURBO 480 / 768p | Runware (configured) | Promo $0.0125 / $0.02/s through Sep 30, 2026; then $0.025 / $0.04/s | Prefer stable post-promo cost for wallet pricing | https://runware.ai/docs/models/minimax-h3-max-turbo |
| MiniMax | H3 MAX 480 / 768p | Runware | Promo $0.025 / $0.04/s through Sep 30; then $0.05 / $0.08/s | Separate Max tier | https://runware.ai/docs/models/minimax-h3-max |
| MiniMax | H3 normal 768p / 1440p(2K) | Runware | $0.08 / $0.13/s | Reference video extra $0.13/input sec; images beyond 5 $0.04 each | https://runware.ai/docs/models/minimax-h3 |
| LTX | 2.3 Fast legacy 720 / 1080 | Runware | $0.03 / $0.06/s | Very cheap legacy starter, not latest | https://runware.ai/docs/models/lightricks-ltx-2-3-fast |
| LTX | 2.5 Fast latest 720 / 1080 | Runware | $0.09 / $0.13/s | fal matches listed 720 price | https://runware.ai/docs/models/lightricks-ltx-2-5-fast |
| LTX | 2.5 Pro 720 / 1080 | Runware | $0.12 / $0.17/s | Extra edits/references may change charge | https://runware.ai/docs/models/lightricks-ltx-2-5-pro |
| Runway | Gen4 Turbo older budget (image-to-video; confirm chosen mode) | Runway developer DIRECT | $0.05/s | Output mode restrictions per API schema | https://docs.dev.runwayml.com/guides/pricing/ |
| Runway | Gen4.5 T2V/I2V | Runware (configured) or Runway DIRECT | $0.12/s | Replicate also $0.12/s | https://runware.ai/docs/models/runway-gen-4-5 |
| Runway | Aleph2 video edit | Runway developer DIRECT | $0.28/s ($0.56 minimum) | Separate special edit route | https://docs.dev.runwayml.com/guides/pricing/ |

## Advertised but not comparable to exact matched tier
- Kie homepage: Seedance 2.0 'from $0.057/s', Kling 3.0 'from $0.07/s'. They do NOT specify quality/audio/mode in the promotion. Cannot treat them as a verified 720p with-audio or Pro price. Kie Veo Quality 1080p $1.28/video and 4K $1.85/video are site-listed not account-verified job quotes. https://kie.ai/
- BytePlus ModelArk lists official Seedance 2.5 subscriptions/token plans; public dynamic prices were not visible for an apples-to-apples per-second rate. Need an account quote, do not assume direct provider is cheaper. https://www.byteplus.com/en/product/seedance
- fal/Runware/Replicate/WaveSpeed and direct provider prices cover most needs. Small offshore resellers advertising improbably cheap Veo clips lack proven provenance/SLA and are not approved production defaults.
- Google Gemini DIRECT Veo always creates audio; Runware has different no-audio tiers. 1080/4K Veo output generally requires an 8-second clip; DO NOT sell 10/30 sec native Veo jobs by extrapolating per-second prices. See https://ai.google.dev/gemini-api/docs/veo?hl=en
- Alibaba DIRECT Germany/US/Tokyo/Hong Kong GLOBAL list prices differ from Singapore INTERNATIONAL. 'Limited time 30% off' additionally advertised; listed prices above are BASE list rates, not an unverified post-discount quote; do not stack a discount without a live console receipt. For WAN3 edit with source video input, billing includes input and output video time.

## Provider integration sequence and commercial safeguards
1. Stage A, NO extra API accounts: Runware Kling, Seedance2/2.5 Standard, H3/H3 Turbo, LTX2.5, Veo Lite, Gen4.5, HappyHorse fallback; Replicate Seedance1 Lite and Kling Motion; fal Seedance1.5 and WAN2.7 HD fallback; existing Kie Veo Quality account quote.
2. Stage B, NEW account access only after approval: Alibaba Cloud global region for WAN3 and HappyHorse1.1; WaveSpeed for Seedance2.5 Turbo; Google Gemini for audio Veo Fast; Runway direct for Gen4Turbo/Aleph2/Seedance2Mini.
3. Choose ROUTE separately for model + exact version + capability (T2V/I2V/V2V/edit) + resolution + audio + duration. Backup must have same capability and user-visible specs or disclose downgrade and obtain consent.
4. Display price quote before charge, log provider task idempotently, enforce max USD spend per request and concurrent task budget, avoid re-submitting uncertain jobs, recover delayed completions, refund ONLY verified non-billable failures, handle input/reference-video add-ons and output duration ceilings, reprice promotion after Sep 30.
5. Audit provider distribution/resale permissions, privacy, data retention, account rate limits, copyright/rights-to-media and age/safety policies before exposing paying customers. Provider advertising 'commercial use' for video outputs is not automatically authority to resell API.

Last review: Sep 24, 2026. Public posted prices not account-specific actual receipts. No paid generation performed.