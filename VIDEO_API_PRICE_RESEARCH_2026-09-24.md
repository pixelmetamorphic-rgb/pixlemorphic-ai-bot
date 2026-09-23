# Video Studio API price research — 2026-09-24 (partial, no paid tests)

User wants one Telegram bot / shared wallet and: latest Kling incl. edit, WAN, Happy Horse, Seedance incl. lite, Veo, latest MiniMax/Hailuo, latest LTX, Runway. Compare fal, Runware, Replicate, Kie and additional genuine API vendors. Prices below are public listed rates, **NOT verified cheapest across every vendor**, and must be rechecked against live endpoint/region, quality, audio, and duration before quoting customers.

## Verified public endpoint prices

| Model / endpoint | Provider | Published USD | 10s equivalent | Source |
|---|---|---:|---:|---|
| LTX-2.3 Fast text-to-video 1080p | fal | $0.04/s | $0.40 | https://fal.ai/models/fal-ai/ltx-2.3/text-to-video/fast |
| LTX-2.3 image-to-video 1080p | fal | $0.08/s shown in live example; model page also describes $0.06/s — **recheck checkout** | $0.60–0.80 | https://fal.ai/models/fal-ai/ltx-2.3/image-to-video |
| LTX-2.3 22B text-to-video, 1280×720×121 frames | fal | $0.001605/MP generated frame data | ~$0.179/5s example | https://fal.ai/models/fal-ai/ltx-2.3-22b/text-to-video |
| Wan 2.7 | fal | $0.10/s | $1.00 | https://fal.ai/wan-2.7 |
| Wan 2.7 edit-video 720p/1080p | fal | $0.10/$0.15 per output sec | $1.00/$1.50 | https://fal.ai/models/fal-ai/wan/v2.7/edit-video |
| Happy Horse 1.1 T2V/reference 720p | fal | $0.14/s | $1.40 | https://fal.ai/models/alibaba/happy-horse/v1.1/text-to-video |
| Happy Horse 1.1 T2V/reference 1080p | fal | $0.18/s | $1.80 | https://fal.ai/models/alibaba/happy-horse/v1.1/reference-to-video |
| Veo 3.1 Fast 720/1080p without/with audio | fal | $0.10/$0.15/s | $1.00/$1.50 | https://fal.ai/models/fal-ai/veo3.1 |
| Veo 3.1 standard 720/1080p without/with audio | fal | $0.20/$0.40/s | $2.00/$4.00 | https://fal.ai/models/fal-ai/veo3.1 |
| Seedance 2.0 720p fast audio | fal | $0.2419/s | $2.419 | https://fal.ai/models/bytedance/seedance-2.0/text-to-video |
| Seedance 2.0 720p standard audio | fal | $0.3034/s | $3.034 | https://fal.ai/models/bytedance/seedance-2.0/text-to-video |
| Seedance 2.5 480p/720p with audio | fal | ~$0.2205/$0.473/s (token-based; 16:9 approximate) | ~$2.205/$4.73 | https://fal.ai/models/bytedance/seedance-2.5/text-to-video |

## Pending exact vendor comparison
Kling latest family + video edit; WAN 3.0 vs 2.7; MiniMax H3/Hailuo; Seedance lite and all popular variants; Runway Gen-4.5; Happy Horse 1.1 alternatives; LTX 2.3 vs 2.5; **fal vs Runware vs Replicate vs Kie vs official Google/BytePlus/MiniMax/Runway and reputable aggregators**. For each, confirm official model ID, video mode, audio, resolution, duration, USD per generated second or fixed job, async polling and commercial reseller terms. Third-party rate claims are leads only, not verified cheapest. No billable generation, no changes to existing image models or credit ledger.

## Bot implementation design
One VIDEO STUDIO menu, subcategories by model family; model+quality+duration+audio key maps to provider routing with hard spend cap. Calculate USD estimated max before starting; require sufficient credits and idempotent pending job ledger; use webhook/poll status, recover late completions, refund only confirmed provider failure; avoid retrying an ambiguous paid job. Start with admin-only low-cost tests after explicit spend approval.
