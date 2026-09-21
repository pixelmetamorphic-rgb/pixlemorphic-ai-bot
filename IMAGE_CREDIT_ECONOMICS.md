# Image credit economics — 2026-09-21

Status: rates configured; new models remain admin-only until customer launch. No paid API tests performed in this review.

## Planning assumptions

- Minimum NET receipts per redeemed bot credit: INR 1, after payment charges, discounts and applicable sales taxes. This is NOT a retail pack commitment.
- Planning conversion: INR 100/USD, not a current FX quote. Replace with actual landed provider cost if greater.
- Provider contingency: 20%; target contribution margin >=50% on that budget. Fixed Railway/Redis/storage, customer acquisition, support and exceptional failures still come out of contribution. This is not net profit.
- Formula: ceil(USD budget * 100 * 1.20 / 0.50), rounded up commercially, minimum 2 credits.
- Do not equate Kie credits with bot credits: 1 Kie credit at the shown $5/1000 package = $0.005.

| Model | Tier | Provider USD basis | Bot credits | Evidence |
|---|---|---:|---:|---|
| Z-Image-Turbo | 2K | .0045 | 2 | User Runware request log |
| FLUX.2 klein 9B | 1K / 2K | .00078 / .00338 | 2 / 2 | Prior request logs |
| Seedream 5 Lite | 2K | .035 | 10 | Prior request log |
| Seedream 5 Pro | 1K / 2K | .04815 / .0963 | 15 / 25 | Prior request logs |
| Qwen Image 3 Pro | 1K / 2K | .04 / .075 | 10 / 20 | Prior request logs |
| Nano Banana 2 generate/edit | 1K / 2K / 4K | .04 / .06 / .09 | 10 / 15 / 25 | User Kie site tests; 4K edit same rate |
| Nano Banana Pro | 1K / 2K / 4K | .138 / .138 / .30 | 35 / 35 / 75 | Runware logs and FAL pricing |
| Nano Banana Pro Edit | 2K | .15 | 40 | Prior test and FAL pricing |
| Ideogram V3 Turbo | Native preset (legacy UI calls it 2K) | .03 | 8 | FAL pricing |
| Kontext Pro Edit | Pro | unverified in this review | 15 | Existing rate retained, needs exact request cost |
| GPT Image 2 | medium / high (legacy 2K / 4K labels) | .12 / .50 PLANNING ONLY | 30 / 125 | Token-variable; .10 observed for earlier medium request; high budget not verified across ratios |
| Nano Banana Pro 8K Master | 4K -> 8K upscale | up to .54 at <=72MP | 150 | .30 base + .24 Topaz; excludes extras |

## Verified public sources

- https://fal.ai/models/fal-ai/nano-banana-pro : .15 standard, .30 4K, optional web search extra.
- https://fal.ai/models/topaz/upscale/image/precision : .08 per started 24MP output.
- https://fal.ai/models/fal-ai/ideogram/v3 : .03 Turbo.
- https://fal.ai/models/openai/gpt-image-2 : token billing; high 3840x2160 example .401 output, input/reasoning may add cost. Not a universal fixed per-image quote.
- Kie prices from user's screenshots/tests at https://kie.ai/nano-banana-2 .

## Examples at the net-credit floor

Nano 2 4K: 25 credits => INR25 net receipts, INR9 base estimate, INR10.80 buffered variable budget, INR14.20 contribution before fixed expenses.
8K Master: 150 credits => INR150 net receipts, INR54 base estimate, INR64.80 buffered budget, INR85.20 contribution before fixed expenses.
A proposed INR2000/1500-credit retail pack has INR1.333 gross receipts/credit. It meets the INR1 floor only if actual deductions from gross remain <=25%. No tax treatment assumed or verified here. Bonus credits count in the denominator.

## Billing changes and remaining gates

Positive customer prices for every configured image tier; admin exempt. Credits reserved atomically before provider request; handled generation/delivery errors refund. Refund/top-up increment is atomic to avoid lost updates. No paid automatic retry added. Credit balance mutations across process crashes or ambiguous delivery still require operational reconciliation; this is not a durable financial ledger.

Not yet final: retail pack value, exact Kontext charge, worst-case GPT token costs, actual landed USD cost, provider failure rates and fixed-cost allocation. Existing customer access was not expanded. All legacy admin model flags remain.

Quality labels corrected: Ideogram displays Native / Turbo; GPT displays High / up to 4K and requested pixel dimensions. GPT high square is 2880x2880 while landscape is 3840x2160. 8K is explicitly upscaled. Topaz stage refuses projected output over 72MP to bound its charge.
