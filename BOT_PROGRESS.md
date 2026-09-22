# PIXLEMORPHIC bot — continuation checkpoint
Updated 2026-09-22. Read this and current index.js before continuing.

## User and rules
Harsh; prefers concise Hinglish and autonomous implementation. Initial budget INR10,000. Telegram bot first, video integration and credit pricing before public launch/UI polish.
NO paid generation/edit tests without new explicit authorization: website tests already performed. Offline mock tests and read-only health checks allowed. Never request API keys in chat; Railway Variables only. Do not expose provider URLs in customer messages. Do not spawn agents unless requested.

## Source and deployment
GitHub: pixelmetamorphic-rgb/pixlemorphic-ai-bot, main.
Railway health: https://pixlemorphic-ai-bot-production.up.railway.app/health
Last verified deployed release: image-credit-economics-v1; ok/redis/fal/kie/telegram true.
Last code commit: 0d646bc688617065daee1a4a58f4b2ad304fec0f.
Tests commit: 4180d1ecc563e07af1f771762a2e9af3ccb6fef1.
Economics doc update: 5f681c8ec84f80742f190b9a9415868623060a2b.
Fetch fresh file SHA before GitHub update. Local bot folder was NOT a git checkout.
Local scratch index.js and tests/runware.test.cjs matched GitHub before pack work.
17 offline tests passed. Command: node --check index.js; node --test tests/runware.test.cjs.

## IMPORTANT newest pack decision — NOT YET IMPLEMENTED
User explicitly said: “image ke 5000 mei 2000 credit” => INR5,000 for 2,000 bot credits (INR2.50 gross/credit).
Assistant announced retaining currently deployed model rates, not the discussed smaller-credit proposal.
Only inspected files; NO pack edits/push yet. paid default STILL 1200 in PLAN_DEFAULT_CREDITS.
Next task: implement/store this pack configuration coherently, update economics doc; don't reset existing balances.
No payment gateway or automatic INR collection currently implemented.
A separate proposed 5x smaller credit system (Nano2 2/3/5, 8K30; packs499/60,999/140,1999/300) was DISCUSSION ONLY and never deployed. Do not accidentally mix its units with current rates.

## Deployed image customer rates
Model | qualities | credits
Nano Banana2 generation and edit | 1K/2K/4K | 10/15/25 each
Nano Banana Pro | 1K/2K/4K | 35/35/75
Nano Pro Edit | 2K | 40
Nano Pro 8K Master | 8K upscale | 150
Z-Image-Turbo | 2K | 2
FLUX2 klein9B | 1K/2K | 2/2
Seedream5Lite | 2K | 10
Seedream5Pro | 1K/2K | 15/25
Qwen Image3Pro | 1K/2K | 10/20
IdeogramV3 Turbo | native (internal key2k) | 8
Kontext Pro edit | pro | 15
GPT Image2 | 2K medium / high up to4K | 30/125

Rates centralized in IMAGE_CREDIT_RATES; initial MODELS literals overridden at startup. All tiers validated positive.
Admin exempt; displays Used0 credits even though provider charges real money.
New models adminOnly=true. Customer access has NOT been expanded: trial GPT2; promo/paid GPT2+Kontext. This is intentional prelaunch.
Legacy Cinematic, Realism, Ultra8K, FLUX1Dev, Seedream4/4.5 removed from config/UI/access. New Seedream5 models remain.

## Integrations
Nano Banana2 Kie: nanobanana2 and nanobanana2edit; 1K/2K/4K, ratios1:1,4:5,3:4,16:9,9:16. KIE_API_KEY configured and health confirmed.
POST https://api.kie.ai/api/v1/jobs/createTask model nano-banana-2; input prompt,resolution uppercase,aspect_ratio,output_format png,image_input array.
Poll GET /api/v1/jobs/recordInfo?taskId=; state success/fail, resultJson.resultUrls.
One create only, no paid retries/fallback. 8min polling deadline; request timeout30sec.
Edit source downloaded by bot from its validated Telegram file URL, uploaded as base64 via https://kieai.redpandaai.co/api/file-base64-upload (official documented upload service); Telegram token not forwarded.
Edit flow preserves selected quality and ratio through source-photo/instruction.
Output original PNG document via Telegram, no supplier URL in caption.
No paid bot test performed, user expressly declined. Offline request/flow verification only.

NanoPro: Runware google:4@2 for1K/2K; FAL fal-ai/nano-banana-pro for4K; FAL /edit for2K edit.
Runware seedImage NanoPro failed; FAL edit now preserves source person (old wrong-person output fixed).
GPT2: FAL openai/gpt-image-2; medium2K, high larger dimensions.
ZTurbo: Runware runware:z-image@turbo,8steps.
Ideogram: FAL fal-ai/ideogram/v3 TURBO; native preset output, NOT guaranteed2K.
Runware also FLUX2klein,Seedream5Lite/Pro,Qwen3Pro.
Comfy explicitly sidelined. Kie selected for Nano2 cost.

## 8K pipeline / downloads
FAL NanoPro4K PNG -> verify IHDR dimensions/aspect -> Topaz upscale/image/precision High Fidelity V3,2x,face_enhancement=false -> verify exact doubled dimensions.
Requires source longest>=3840; projected output<=72MP bounds Topaz cost. No paid resubmission.
User saw8192x8192 successfully. Caption explicit 4K->8K upscale, not native.
Document delivery when<=49MiB; oversized/failure uses own expiring download.
PRIVATE URL: /download/randomUUID, Redis mapping TTL86400. Origin PUBLIC_BASE_URL or RAILWAY_PUBLIC_DOMAIN. Streams FAL PNG (no browser redirect); allows fal.media subdomains only; branded filename. Old already-sent provider links remain unchanged.
Latest deployed health proven but private oversized download not separately live-tested.

## Billing implementation / limitations
Atomic credit reservation BEFORE provider generation; handled generation or delivery failures refund via atomic Redis INCRBY, preserves concurrent top-ups.
Busy600sec (8K1500); heartbeat renews user/global locks for ALL generation, not just admin.
17 mocks include all tiers positive, no duplicate Kie jobs, edit flow settings, reservations/refunds.
Not a durable financial ledger: process crash / ambiguous Telegram delivery needs reconciliation. Do not claim exactly-once billing across crashes.
No customer balance migration has happened.

## Evidence / economics
Detailed source-backed repo doc: IMAGE_CREDIT_ECONOMICS.md.
Rates originally budgeted at INR100/USD planning rate (NOT live exchange),20% contingency,minimum INR1 NET receipts/credit,~50% buffered contribution target. Net profit must still account fixed hosting, fees,taxes,support,marketing,failures.
Newest INR5000/2000 pack needs doc update; old docs still describe unconfirmed INR2000/1500 example.
Observed USD:
ZTurbo2K .0045/6.73sec
FLUXklein1K .00078;2K .00338
Seedream5Lite2K .035
Seedream5Pro1K .04815;2K .0963
Qwen3Pro1K .04;2K .075
NanoPro Runware1K/2K .138 each;FAL4K .30
NanoProEdit FAL2K .15
IdeogramTurbo .03
Nano2 Kie1K8 credits=.04 (32sec);2K12=.06;4K18=.09;4K edit18=.09 confirmed by USER WEBSITE tests.
8K .30 + Topaz .08/started24MP;<=72MP total .54 max listed base cost. User balance movement matched .54, not isolated request log.
GPT2 FAL2K observed balance delta~.10;Runware test .42873/111sec, NOT identical-settings comparison.
GPT costs token-variable; budget .12 medium/.50 high provisional. High3840x2160 documented output example .401 plus input/reasoning. Kontext exact billing not verified in this review; retained15credits.
Don't claim cheapest worldwide, guaranteed profit, or all costs verified.

## Resolution honesty fixes deployed
Ideogram displays Native/Turbo.
GPT high displays “High • up to4K”, caption requested pixel size; square2880x2880,4:5 2560x3200,3:4 2304x3072,landscape3840x2160,portrait2160x3840.
8K explicitly upscale.

## 2026-09-22 uncensored image admin-test integration
Merged to main via PR #2, commit 7df73735df830ba3abbb36f130f1deb8ce3a5830.
Added admin-only IMAGE STUDIO category: 🔥 UNCENSORED • ADMIN TEST.
Dedicated Runware aliases:
- FLUX.2 [klein] 4B => runware:400@4 => 1K/2K => safety.checkContent=false only on this alias.
- Seedream 5.0 Pro => bytedance:seedream@5.0-pro => 1K/2K => safety.checkContent=false only on this alias.
Existing regular FLUX/Seedream routes were not changed.
Customer credit placeholders remain FLUX 2/2 and Seedream Pro 15/25; admin tests consume 0 bot credits but provider billing still applies.
Health release changed to uncensored-image-admin-test-v1 and now exposes runware Boolean.
No paid generation was executed during integration. Paid uncensored-behavior testing still requires explicit user authorization under the project rule.
Syntax of merged main index.js was checked successfully.

## Pending work order
1. Implement latest INR5000/2000 pack and update economics document. Keep current credit units unless user explicitly changes them.
2. Close remaining image economic caveats (GPT variable cost, Kontext actual bill) without paid retests; clarify launch access later.
3. Video model provider selection/integration, offline validation then paid tests only if expressly authorized. No video engines implemented; visible SOON list not proof of integration.
4. Price video using same wallet deliberately; packs/bonus/expiry policy not assumed.
5. Customer UX/branding polish after integrations/rates. Launch only after video ready.
6. Consider durable credit ledger/reconciliation before broader paid launch.

## Seven Replicate 1K admin-image models (2026-09-22)
PR #5 adds five models to existing Pony Realism v2.3 and CyberRealistic Pony v8: Pony SDXL, NoobAI Real SDXL v0.1, Realism XL, Juggernaut XL v7, and RealVisXL4. Adult Image menu becomes seven Replicate entries and no longer displays the two failed Runware experimental aliases; underlying Runware engines remain to avoid disturbing other paths. All seven restricted by adminOnly and canAccess; 1K only and nominal 10 customer credits each, admin usage 0 bot credits but actual provider billing applies. Existing production models and credit rates unchanged. Offline regression tests and GitHub Actions check added. **Provider requests, actual account permissions, content moderation and costs are untested**; no paid tests without renewed user authorization. See NEXT_CHAT_HANDOFF.md and current index.js; PR #5 must be checked for merge/deployment.

## Natural Skin XL (new admin-only photoreal/lower-filter experiment, 2026-09-23)
One new `naturalskinxl` 1K route is configured on Replicate's published `adirik/realvisxl-v4.0` version `85a58cc7...`, using its documented API-only `disable_safety_checker=true`. This is **not** evidence of unlimited or unrestricted output. The experiment uses low CFG (2.5), 30 steps and negative prompts against plastic/waxy/airbrushed skin and unsafe age/nonconsent terms. It's adminOnly, 1K, 10 **unvalidated placeholder** credits (admin bot credits=0, actual provider charge remains). Does not modify locked Realism XL, existing 7 Replicate aliases, other provider routes, customer credits, or plans. Provider actual cost, successful execution, desired fidelity, moderation, model license and potential commercial use remain pending confirmation. Source: Replicate's model API schema and safety-checking docs. No paid generation tests without fresh permission.
