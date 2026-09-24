# PIXLEMORPHIC AI — PROJECT HANDOFF
## Work Progress & Future Development Roadmap

**Last updated:** 25 September 2026  
**GitHub:** pixelmetamorphic-rgb/pixlemorphic-ai-bot  
**Hosting:** Railway  
**Database:** Redis  
**Backend:** Node.js / Express  
**Initial budget target:** ₹10,000

**MAIN OBJECTIVE**

Develop one commercial Telegram AI bot offering image and video generation through a shared credit wallet.

Our immediate priority is to develop and test the complete video-generation infrastructure using Kling before integrating the remaining video model families.

---

# 1. COMPLETED WORK

## A. Existing Telegram bot

Our bot already has:

- Railway deployment and GitHub integration.
- Redis-based customer credits and user state.
- Image-generation functionality.
- Admin-only experimental model access.
- Existing FAL, Runware, Replicate and Kie API integrations.
- A Video Studio entry point.

The existing image models and customer credits must remain unchanged during video development.

## B. Image Studio

The existing Image Studio is frozen while video development takes priority.

The saved image configuration includes GPT Image, Nano Banana, FLUX, Seedream, Qwen and other established image routes.

The private research menu contains Realism XL, Pony Realism v2.3 and CyberRealistic Pony v8. Realism XL is locked and must not be modified accidentally. The other two are research candidates, not approved commercial models.

An admin-only Runware model-discovery command is also available for checking relevant checkpoint metadata.

**Current decision:** Do not modify Image Studio unless explicitly requested.

## C. Video model research

We researched published API prices and availability across:

- FAL
- Runware
- Replicate
- Kie
- Google direct API
- Alibaba Cloud
- WaveSpeedAI
- OpenRouter
- reAPI

The research found that there is no single cheapest provider for every model and configuration.

Our strategy is to use existing provider accounts wherever possible and add new providers only when there are meaningful, verified savings.

Advertised starting prices must not be treated as confirmed costs for every resolution, audio or editing configuration.

---

# 2. FINAL VIDEO STUDIO MODEL LIST

We agreed on nine customer-facing model groups.

| # | Model group | Planned variants |
|---|---|---|
| 1 | Kling 3.0 | Standard, Pro, image-to-video, audio |
| 2 | Kling O3 | Standard, Pro, references, editing |
| 3 | Seedance 2.0 | Mini, Fast, Standard |
| 4 | Seedance 2.5 | Budget, Turbo, Standard |
| 5 | Google Video | Veo 3.1 Fast, Gemini Omni |
| 6 | Wan | Latest verified version, Standard and optional Prime |
| 7 | LTX | Latest Fast and Pro |
| 8 | Happy Horse | Text, image and reference-to-video |
| 9 | MiniMax | Latest H3 family |

One menu group may contain several backend API endpoints.

**Seedance exclusions:** Do not include Seedance 1.0 or 1.5.

Seedance 2.5 Lite remains a research candidate until its exact model identity and API availability are verified.

---

# 3. PLANNED API ROUTING

| Model | Planned provider |
|---|---|
| Kling 3.0 | FAL, Runware backup |
| Kling O3 | FAL, Runware backup |
| Kling Motion Control | Replicate |
| Seedance 2.0 Mini/Fast | Runware |
| Seedance 2.5 Budget/Standard | Runware |
| Seedance 2.5 Turbo | WaveSpeedAI |
| Veo 3.1 Fast with audio | Google direct, subject to account verification |
| Gemini Omni | Google or verified available provider |
| Wan | Alibaba Cloud, Runware backup |
| LTX | Runware |
| Happy Horse | Alibaba Cloud, Runware backup |
| MiniMax | Runware |

Kie, OpenRouter and reAPI remain potential alternatives.

reAPI offers some advertised savings, but we have not established sufficient independent reliability, privacy assurances or commercial integration permissions to make it a production default.

The exact API endpoint, pricing and provider authorization must be verified before activating a new route.

---

# 4. CURRENT DEVELOPMENT: KLING

**Priority: Build and test Kling first.**

We selected Kling because its model family allows us to test the four main video-generation workflows before integrating other providers.

### Four planned workflows

1. Text-to-video
2. Image-to-video
3. Reference-to-video
4. Video editing

Motion Control will be added through Replicate as a separate advanced Kling workflow.

### Existing development progress

GitHub draft PR #18 contains an admin-only Kling menu and preliminary price previews.

The prepared variants include:

- Kling 3.0 Standard
- Kling 3.0 Pro
- Kling O3 Standard
- Kling O3 Video Edit

The PR is a development draft, not a completed video-generation integration.

**Important:** The preview does not perform paid API generation, deduct credits or deliver generated videos. Its endpoint mapping, code and pricing require review before production deployment.

---

# 5. IMMEDIATE NEXT TASKS

## Phase 1 — Kling architecture

Audit and review PR #18.

Verify all exact FAL endpoint IDs, request schemas, supported capabilities and applicable prices against current official documentation.

Develop the following common components:

- Admin-only Kling selection.
- Prompt and media input handling.
- Provider-specific generation settings.
- Credit-cost quotation.
- API spending limits.
- Persistent asynchronous job tracking.
- Telegram video delivery.
- Failure recovery and billing reconciliation.

Do not activate billable generation or change customer credit prices during the initial development stage.

## Phase 2 — Kling text-to-video

Implement Kling 3.0 Standard first.

Expected flow:

Video Studio → Kling → Text-to-Video → Quality → Duration → Audio → Prompt → Cost Preview → Generate.

Verify API submission, queued-task status, successful delivery and actual billed amount.

Begin with one inexpensive admin-only generation after a fixed test budget is approved.

## Phase 3 — Kling image-to-video

Add Telegram image uploads and compatible media transfer to the chosen Kling endpoint.

Test subject consistency, successful media processing, output delivery and actual cost.

## Phase 4 — Kling reference-to-video

Add the specific reference media supported by the selected endpoint.

Verify reference constraints, character or scene consistency, input-media processing and generation cost.

Do not assume that every Kling 3.0 or O3 endpoint supports identical reference capabilities.

## Phase 5 — Kling video editing

Integrate the verified Kling O3 editing endpoint.

Support source-video upload, prompt instructions, allowed input duration and output settings.

Account for possible extra billing related to reference or input-video duration.

Video editing should be tested after simpler generation and upload workflows are functioning.

## Phase 6 — Motion Control

Integrate Replicate's Kling Motion Control Standard and Pro routes.

This is a separate workflow using reference motion and supported character inputs.

It should reuse the existing persistent job, delivery and credit system.

---

# 6. CONTROLLED TESTING STRATEGY

We intend to run one carefully selected test for each of the first four Kling workflows.

Start with the lowest supported, usable resolution and duration for each exact endpoint.

Turn audio off for initial tests where supported.

Use simple inputs that allow us to identify whether problems arise from the API, input handling or generation quality.

Record:

- Provider and exact model ID.
- Generation mode and configuration.
- Submitted task ID.
- Actual API charge.
- Generation time.
- Output delivery result.
- Output quality.
- Failure or refund behavior.

Four tests are an initial target, not a guarantee that every workflow can be validated in a single attempt.

**No paid tests without explicit approval and a maximum spending cap.**

---

# 7. CREDIT AND BILLING ARCHITECTURE

All image and video models must share the existing bot credit wallet.

Before a video job starts:

1. Validate the selected model's capabilities and generation settings.
2. Calculate the maximum estimated API cost.
3. Display the required customer credits.
4. Check and reserve the necessary credits.
5. Submit the generation request only after validation.

During generation, persist the provider's task ID and job status.

After completion, deliver the video and finalize the credit transaction.

If a job fails, reconcile the provider's actual billing status before releasing or refunding credits.

A network timeout must not automatically trigger another potentially billable submission.

Railway restarts must not permanently lose pending jobs.

---

# 8. BUDGET STRATEGY

**Initial budget target: ₹10,000**

| Purpose | Proposed amount |
|---|---:|
| Kling controlled testing | ₹500 |
| Future model testing | ₹1,000 |
| Customer-generation capacity | ₹6,000 |
| Emergency reserve | ₹2,500 |
| **Total** | **₹10,000** |

This is a planning allocation, not an instruction to deposit money.

Existing usable API balances must be checked before adding funds.

The emergency reserve should remain available for billing problems, operational expenses and unexpected failures.

Customer credit prices must account for API cost, foreign-exchange conversion, payment fees, taxes where applicable, operational overhead and profit margin.

Temporary API discounts must not be treated as permanent pricing.

---

# 9. DEVELOPMENT AFTER KLING

Once all four Kling workflows and the associated credit infrastructure operate reliably, proceed with the remaining models.

**Wave 2: Budget generation**

Integrate Seedance 2.0 Mini/Fast, economical Wan and MiniMax, reusing the proven Kling job infrastructure.

**Wave 3: Premium generation**

Integrate Seedance 2.5, Veo 3.1 Fast, LTX and Happy Horse. Add additional tiers and capabilities only after verifying exact API availability and cost.

**Wave 4: Optimization**

Compare real billing receipts, generation success rates, provider latency and customer usage.

Enable equivalent backup providers where commercially and technically appropriate.

Consider additional API providers only when their measurable savings justify the integration and operational overhead.

---

# 10. NON-NEGOTIABLE PROJECT RULES

- Keep one existing Telegram bot and one shared credit system.
- Preserve all existing Image Studio functionality.
- Do not alter locked Realism XL.
- Never expose untested models to paying customers.
- Never run paid generation without an approved spending cap.
- Never assume a provider's advertised starting rate applies to every configuration.
- Never blindly retry an ambiguous paid API job.
- Obtain appropriate provider and commercial-use permissions before customer launch.
- Keep advanced models admin-only until testing is complete.
- Review code changes and regression tests before production deployment.

---

# 11. PROJECT LINKS

**Repository:**  
https://github.com/pixelmetamorphic-rgb/pixlemorphic-ai-bot

**Current Kling development:**  
https://github.com/pixelmetamorphic-rgb/pixlemorphic-ai-bot/pull/18

**Saved video-model shortlist:**  
https://github.com/pixelmetamorphic-rgb/pixlemorphic-ai-bot/blob/main/VIDEO_STUDIO_FINAL_9_MENU_SLOTS.md

**Saved API pricing research:**  
https://github.com/pixelmetamorphic-rgb/pixlemorphic-ai-bot/blob/main/VIDEO_API_FINAL_PROVIDER_MATRIX_2026-09-24.md

**Existing project handoff:**  
https://github.com/pixelmetamorphic-rgb/pixlemorphic-ai-bot/blob/main/NEXT_CHAT_HANDOFF.md

---

# NEXT ACTION

Review Kling PR #18 and verify its API endpoints. Implement Kling 3.0 Standard text-to-video with persistent job tracking and admin-only access.

Do not initiate paid tests or deploy unfinished video functionality without approval.

After text-to-video works, continue sequentially with image-to-video, reference-to-video and O3 video editing.