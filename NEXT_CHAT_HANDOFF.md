# PIXLEMORPHIC AI — NEXT CHAT HANDOFF
Checkpoint: 2026-09-22. This is the current handoff. Read live `index.js`, `BOT_PROGRESS.md`, and `tests/runware.test.cjs` from GitHub before making code edits. Older planning discussions do not override the actual current code.

## Current user intent
Continue the existing commercial Telegram image/video-generation bot. The immediate priority is finding and integrating genuinely lower-filter image models for lawful consenting adult 18+ creator workflows, after Runware FLUX/Seedream did not meet the user's expectations. The user has just asked whether Replicate is already integrated and was told YES at adapter level but NO active Replicate model in the Telegram catalog. The user now wants this progress saved for the next work chat. Do not divert to pack planning unless requested.

## Repository and deployment
- GitHub repo: `pixelmetamorphic-rgb/pixlemorphic-ai-bot`, branch `main`.
- At checkpoint, main HEAD: `c1dda1eeb56702a4f0e5ee2bbf9e4640ebb19228` (docs/tests merge; the latest index.js blob SHA was `42e93de5a3e54a79fe40d6f3b4ef851f7f2ee1d5`). Always fetch fresh SHAs before writing.
- Railway: `https://pixlemorphic-ai-bot-production.up.railway.app/health`.
- GitHub commit-status integration reported SUCCESS for main HEAD, with a Railway deployment target; the latest live `/health` body / runtime secret presence was NOT independently checked. Never claim that Replicate live connectivity or NSFW behavior has been verified merely from a status.
- Express Telegram webhook, Redis, fal, Kie and Runware adapters exist. Global generation concurrency default 3. Current working image pathways must be preserved.
- GitHub app access has push permission; earlier work was implemented through feature branches, PRs, and merges.

## 2026-09-22 code changes ALREADY MERGED
PR #2 added two dedicated admin-only test aliases under Telegram IMAGE STUDIO -> `🔥 UNCENSORED • ADMIN TEST`:
1. `flux2klein4buc`: Runware `runware:400@4`, 1K and 2K, nominal customer placeholders 2/2 credits; primary engine `runware_flux2klein4b_uc`.
2. `seedream50prouc`: Runware `bytedance:seedream@5.0-pro`, 1K and 2K, nominal customer placeholders 15/25 credits; primary engine `runware_seedream50pro_uc`.
These *only* pass `safety: { checkContent: false }` on their own test aliases. Ordinary FLUX/Seedream routes were not changed. `adminOnly: true`; admin bot generations use zero bot credits but cost actual provider USD. Health release string: `uncensored-image-admin-test-v1`; health includes a Boolean `runware` key.
PR #3 added offline regression coverage for admin-only category and provider flag, and updated BOT_PROGRESS.md. JavaScript syntax checked; no billable provider calls executed by assistant during integration.

## USER-OBSERVED 1K TEST FEEDBACK (IMPORTANT; supersedes prior unverified "uncensored" claims)
- Runware Seedream 5 Pro rejected the prompt with `invalidProviderContent` / input may contain sensitive information; no image returned in this test.
- Runware FLUX.2 Klein 4B returned an image but altered/omitted the requested adult content; user's requirement was NOT met.
- User clarified an earlier typo: they meant **FLUX**, not fal.ai, when describing the generated-but-altered result. Do not misattribute this observed result to fal.
- A Runware usage screenshot showed successful jobs priced `$0.0006` each, but model identities and current available balance were not established from that screenshot. Do not attribute those entries to a specific model without request details.
- Therefore, existing `uncensored` UI tags are **experimental and misleading as verified behavior**. Next code/UI change when appropriate: relabel these two routes/category as Experimental / Low-filter test, or otherwise flag as unverified; avoid public claims of guaranteed unrestricted output. Keep admin-only. Provider-side moderation can remain even when `checkContent=false`.

## Provider research performed in conversation, NOT integrated
- Replicate public/community checkpoint candidates surfaced: `devgmstudios/pony-realism-v23`, `aisha-ai-official/cyber-realistic-pony-v8`, and Prefect Pony XL v5 (verify exact current owner/model slug via official provider docs before coding).
- fal Pony V7 candidate: `fal-ai/pony-v7` (verify current docs and account permissions).
- Runware community Pony-family models/custom checkpoint availability: search exact AIR identifiers first; don't invent IDs.
- Kie FLUX.2 has reported NSFW-checker setting but no established guarantee of adult generation.
- NONE of the above candidates has had successful unrestricted adult output demonstrated on the user's account; check provider ToS, endpoint permissions, actual current price and supported input schema. Do not describe any as guaranteed uncensored. Apply adult consent/age safeguards and applicable provider rules.

## Replicate scan — latest specific finding
Read current `index.js`:
- `const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;` exists.
- `replicateSDXLGenerate(prompt)` exists, calls `https://api.replicate.com/v1/predictions`, sends Bearer token and a hardcoded legacy `REPLICATE_SDXL_VERSION`, polls returned prediction URL.
- `runEngine` has a `case "replicate_sdxl"` adapter.
- BUT there is no active `MODELS` registry entry pointing at `replicate_sdxl`; Replicate is not selectable in current Telegram IMAGE STUDIO UI.
- `/health` and admin stats expose `replicate: Boolean(REPLICATE_API_TOKEN)`. Live Railway value/token validity/balance has NOT been independently verified in the latest turn. Don't request secrets in chat; use Railway Variables.
- `package.json` has no Replicate SDK dependency: existing adapter uses `node-fetch`, so model-specific routing can be implemented without necessarily adding a new package.

## Next actionable development (only once the user requests continuing)
1. Confirm current official model endpoint docs, input schema, model version/current deployment, pricing, and terms for the selected Replicate adult-oriented community checkpoints. Do not invent unverified API IDs.
2. Integrate one or two chosen Replicate candidates as admin-only *experimental* image models in the existing MODELS registry, UI category, and engine router; keep current production models and credit code intact. No unapproved API spending.
3. Add offline tests for correct payload, no credential leaks, no duplicate paid prediction creation after uncertain failures, and Telegram delivery/refund. Existing `tests/runware.test.cjs` provides the offline VM harness.
4. After explicit user approval for billed testing, test 1K provider behavior and costs, record model/rejection/result honestly. Never claim fully uncensored solely because a safety toggle exists.
5. Later, return to video endpoint mapping/integration. User's 12-family planned video catalogue is in previous project context; no working video engines live yet.
6. Separate deferred business decision: INR5,000 -> 2,000 user credits was chosen but `PLAN_DEFAULT_CREDITS.paid` still reads 1200; no pack-payment implementation or existing-balance migration has been made.

## Operating rules
- User prefers direct Hinglish and autonomous implementation with real GitHub access. Address as Harsh, not Gyani Baba.
- NO new billable tests without fresh explicit permission; the user performed the two recent 1K tests themselves.
- Never promise self-hosting or uncensored access that providers don't authorize. No minors, ambiguous-age sexual content, non-consensual sexual content or sexual deepfakes of real people.
- Keep existing working image generation, credits, admin access, Railway webhook, Redis locks and model menu intact when adding providers.
- To resume, user can say: "NEXT_CHAT_HANDOFF.md padhkar Replicate experimental image model integration continue karo".

## 2026-09-22 latest: seven-model Replicate admin-only expansion
- Current user request: remove the two unsuccessful Runware adult experimental aliases from the **Adult Image menu** and show seven Replicate-only admin test 1K entries: Pony Realism v2.3, CyberRealistic Pony v8, Pony SDXL, NoobAI Real SDXL v0.1, Realism XL, Juggernaut XL v7, RealVisXL4.
- The prior Runware aliases are **hidden from this menu**, not deleted from backend configuration; ordinary Runware production/admin entries elsewhere are unchanged.
- Existing two Pony Replicate entries were preserved; five more entries, API schema mappings, private catalog lines and nominal rate entries were added. All seven `adminOnly: true`, 1K and nominal 10-credit placeholders; actual admin wallet deduction remains zero. These rates are **not** validated for public pricing.
- Specific official Replicate slugs: `devgmstudios/pony-realism-v23`, `aisha-ai-official/cyber-realistic-pony-v8`, `charlesmccarthy/pony-sdxl`, `aisha-ai-official/noobai-real-sdxl-v0.1`, `asiryan/realism-xl`, `asiryan/juggernaut-xl-v7`, `zelenioncode/realvisxl4`. Version IDs pinned where verified; Realism XL calls the official version-independent model prediction endpoint.
- Added offline mocking regressions and GitHub Actions check `node --check index.js`, `node --check tests/runware.test.cjs`, `node --test tests/runware.test.cjs`.
- **No billable Replicate requests** were made. Actual Railway Replicate token validity, per-run charges, output behavior and provider restrictions remain unverified; obtain explicit consent before paid tests. Admin-only preview is not public launch.
- PR: https://github.com/pixelmetamorphic-rgb/pixlemorphic-ai-bot/pull/5 . Verify merge/deploy/health independently; this file is not a substitute for current `index.js`.
