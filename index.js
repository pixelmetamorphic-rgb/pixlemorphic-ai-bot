"use strict";

/**
 * PIXELMETA AI - Production Index (UPDATED + FIXED)
 * Admin ID: 1078816855
 *
 * ✅ Fixes + Upgrades:
 * - Telegram 429 flood limit safe: global throttle + retry_after auto retry
 * - Global generation concurrency limiter (handles 50–100+ users better)
 * - Ultra 8K is REAL 8K: Flux Ultra base + Topaz upscale 4× (never empty model)
 * - Pixlemeta Realism upgraded to DSLR-level realism (Flux Ultra RAW + Topaz for 4K)
 * - Pixlemeta Shark V1 (8K Killer): Nano Banana Pro Edit + Topaz 4× upscale to 8K
 * - Shark supports image-to-image: user sends image, then /shark <prompt>
 * - Admin stats + broadcast (safe, no 429 crashes)
 * - Credits are deducted ONLY after success
 *
 * NOTE:
 * - "Better than Midjourney" is a subjective claim. What we implement here is a
 *   premium-quality pipeline designed for *flagship-grade* edits + 8K output.
 */

const express = require("express");
const Redis = require("ioredis");

const app = express();
app.use(express.json({ limit: "4mb" }));
app.disable("x-powered-by");

// ------------------ ENV ------------------
const TG_TOKEN = process.env.TG_TOKEN;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const FAL_API_KEY = (process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
const REDIS_URL = process.env.REDIS_URL;

const TG_SECRET_TOKEN = process.env.TG_SECRET_TOKEN; // optional webhook protection

// ✅ Hard fallback so model never becomes empty
const FAL_FLUX_PRO_MODEL =
  (process.env.FAL_FLUX_PRO_MODEL || "").trim() || "fal-ai/flux-pro/v1.1-ultra";

const PORT = process.env.PORT || 8080;

// Admin
const ADMIN_ID = "1078816855";

// Replicate SDXL version (your current)
const REPLICATE_SDXL_VERSION =
  "39ed52f2a78e934b3ba6f1f50c7b07c7a1c77d9b29b19a70c2b6c38b1f86c7c5";

// Limits
const MAX_PROMPT_LEN = 900;
const BUSY_LOCK_SECONDS = 180;

// ✅ Global generation concurrency (safe for big user load)
const GLOBAL_GEN_LIMIT = parseInt(process.env.GLOBAL_GEN_LIMIT || "3", 10);

// ✅ Telegram throttle (avoid 429)
const TG_MIN_GAP_MS = parseInt(process.env.TG_MIN_GAP_MS || "70", 10);

// ------------------ FETCH (Node18+ or fallback) ------------------
const fetchFn =
  global.fetch?.bind(global) ||
  ((...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args)));

// ------------------ REDIS ------------------
const redis = REDIS_URL ? new Redis(REDIS_URL) : null;
if (redis) {
  redis.on("error", (e) => console.error("Redis error:", e?.message || e));
} else {
  console.warn("⚠️ REDIS_URL missing. Bot will not work correctly without Redis.");
}

// ------------------ PLANS ------------------
const PLAN_DEFAULT_CREDITS = {
  trial: 40,
  promo: 100,
  paid: 1200,
  admin: 999999999
};

/**
 * MODELS:
 * - cinematic: quick fast cinematic
 * - realism: DSLR realism 2K/4K
 * - ultra8k: true 8K (Flux Ultra base + Topaz 4×)
 * - shark: premium edit pipeline 2K/4K/8K
 */
const MODELS = {
  cinematic: {
    key: "cinematic",
    label: "🎬 Pixlemeta Cinematic",
    type: "t2i",
    qualities: {
      "2k": { cost: 2 },
      "4k": { cost: 4 }
    },
    engines: { primary: "fal_schnell", backup: null }
  },

  realism: {
    key: "realism",
    label: "📸 Pixlemeta Realism (DSLR)",
    type: "t2i",
    qualities: {
      "2k": { cost: 6 },  // upgraded
      "4k": { cost: 15 }  // your target
    },
    engines: { primary: "fal_flux_ultra_realism", backup: "replicate_sdxl" }
  },

  ultra8k: {
    key: "ultra8k",
    label: "🟪 Pixlemeta Ultra 8K (True)",
    type: "t2i",
    qualities: {
      "8k": { cost: 30 } // realistic premium pricing
    },
    engines: { primary: "fal_flux_pro_8k", backup: null }
  },

  // ✅ Shark V1 - premium i2i edit + upscale (2K/4K/8K)
  shark: {
    key: "shark",
    label: "🦈 Pixlemeta SHARK V1 (Premium Edit)",
    type: "i2i",
    qualities: {
      "2k": { cost: 15 },
      "4k": { cost: 25 },
      "8k": { cost: 45 } // 8K killer tier
    },
    engines: { primary: "shark_v1_edit", backup: null }
  }
};

const PLAN_ACCESS = {
  trial: new Set(["cinematic", "realism"]),
  promo: new Set(Object.keys(MODELS)),
  paid: new Set(Object.keys(MODELS)),
  admin: new Set(Object.keys(MODELS))
};

// ------------------ UTIL ------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

function clampPrompt(text) {
  const t = (text || "").toString().trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > MAX_PROMPT_LEN ? t.slice(0, MAX_PROMPT_LEN) : t;
}

function isAdmin(chatId) {
  return String(chatId) === ADMIN_ID;
}

function safeInt(x, fallback = 0) {
  const n = parseInt(String(x ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

// ------------------ TELEGRAM API (SAFE) ------------------
let TG_NEXT_ALLOWED_TS = 0;
async function tgThrottle() {
  const minGapMs = TG_MIN_GAP_MS;
  const t = Date.now();
  if (t < TG_NEXT_ALLOWED_TS) await sleep(TG_NEXT_ALLOWED_TS - t);
  TG_NEXT_ALLOWED_TS = Date.now() + minGapMs;
}

function extractRetryAfterSec(j) {
  return (
    j?.parameters?.retry_after ||
    j?.response_parameters?.retry_after ||
    null
  );
}

async function tgCall(method, payload, attempt = 0) {
  if (!TG_TOKEN) throw new Error("Missing TG_TOKEN");

  // throttle to reduce 429
  await tgThrottle();

  const r = await fetchFn(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const j = await r.json().catch(() => ({}));

  if (r.ok && j.ok !== false) return j.result;

  const retryAfter = extractRetryAfterSec(j);

  if (r.status === 429 && retryAfter && attempt < 6) {
    // metrics
    await rIncrBy("m:tg_429", 1).catch(() => {});
    console.warn(`⚠️ Telegram 429: retry_after=${retryAfter}s method=${method}`);
    await sleep((retryAfter + 1) * 1000);
    return tgCall(method, payload, attempt + 1);
  }

  throw new Error(`Telegram ${method} failed: ${r.status} ${JSON.stringify(j)}`);
}

async function sendMessage(chatId, text, replyMarkup) {
  const payload = { chat_id: chatId, text };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return tgCall("sendMessage", payload);
}

async function sendPhoto(chatId, photoUrl, caption) {
  return tgCall("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption || ""
  });
}

async function sendDocument(chatId, fileUrl, caption) {
  return tgCall("sendDocument", {
    chat_id: chatId,
    document: fileUrl,
    caption: caption || ""
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
  const payload = { callback_query_id: callbackQueryId };
  if (text) payload.text = text;
  return tgCall("answerCallbackQuery", payload);
}

async function tgGetFileUrl(fileId) {
  const file = await tgCall("getFile", { file_id: fileId });
  const path = file?.file_path;
  if (!path) throw new Error("getFile returned no file_path");
  return `https://api.telegram.org/file/bot${TG_TOKEN}/${path}`;
}

// ------------------ REDIS HELPERS ------------------
async function rGet(key) {
  if (!redis) return null;
  return redis.get(key);
}
async function rSet(key, val, opts = {}) {
  if (!redis) return null;
  if (opts.ex && opts.nx) return redis.set(key, val, "EX", opts.ex, "NX");
  if (opts.ex) return redis.set(key, val, "EX", opts.ex);
  return redis.set(key, val);
}
async function rDel(key) {
  if (!redis) return null;
  return redis.del(key);
}
async function rIncrBy(key, n) {
  if (!redis) return null;
  return redis.incrby(key, n);
}

// ------------------ USER DATA ------------------
async function ensureUser(chatId) {
  const id = String(chatId);

  // track all users for broadcast/statistics
  if (redis) await redis.sadd("users", id);

  if (isAdmin(id)) {
    await rSet(`plan:${id}`, "admin");
    return;
  }

  const plan = (await rGet(`plan:${id}`)) || "trial";
  await rSet(`plan:${id}`, plan);

  const hasCredits = await rGet(`credits:${id}`);
  if (hasCredits === null) {
    await rSet(`credits:${id}`, String(PLAN_DEFAULT_CREDITS[plan] ?? 0));
  }
}

async function getPlan(chatId) {
  const id = String(chatId);
  if (isAdmin(id)) return "admin";
  return (await rGet(`plan:${id}`)) || "trial";
}

async function setPlan(chatId, plan, opts = {}) {
  const id = String(chatId);
  if (isAdmin(id)) return;

  await rSet(`plan:${id}`, plan);

  const credits = PLAN_DEFAULT_CREDITS[plan] ?? 0;
  await rSet(`credits:${id}`, String(credits));

  if (opts.expiresAt) await rSet(`planexp:${id}`, String(opts.expiresAt));
  else await rDel(`planexp:${id}`);
}

async function getCredits(chatId) {
  const id = String(chatId);
  if (isAdmin(id)) return Infinity;
  const v = await rGet(`credits:${id}`);
  return safeInt(v, 0);
}

async function addCredits(chatId, amount) {
  const id = String(chatId);
  if (isAdmin(id)) return;
  await rIncrBy(`credits:${id}`, amount);
}

async function deductCredits(chatId, amount) {
  const id = String(chatId);
  if (isAdmin(id)) return;
  await rIncrBy(`credits:${id}`, -amount);
}

async function isBanned(chatId) {
  const id = String(chatId);
  if (isAdmin(id)) return false;
  const v = await rGet(`ban:${id}`);
  return v === "1";
}

async function setBan(chatId, on) {
  const id = String(chatId);
  if (on) await rSet(`ban:${id}`, "1");
  else await rDel(`ban:${id}`);
}

// ------------------ LOCKS / RATE LIMIT ------------------
async function rateLimit(chatId) {
  const id = String(chatId);
  const key = `rl:${id}`;
  const ok = await rSet(key, "1", { ex: 1, nx: true });
  return ok === "OK";
}

async function acquireBusy(chatId) {
  const id = String(chatId);
  const key = `busy:${id}`;
  const ok = await rSet(key, "1", { ex: BUSY_LOCK_SECONDS, nx: true });
  return ok === "OK";
}

async function releaseBusy(chatId) {
  const id = String(chatId);
  await rDel(`busy:${id}`);
}

// ✅ global concurrency slots (prevents overload)
async function acquireGlobalSlot() {
  const key = "glob:gen";
  for (let i = 0; i < 60; i++) {
    const current = safeInt(await rGet(key), 0);
    if (current < GLOBAL_GEN_LIMIT) {
      await rIncrBy(key, 1);
      return true;
    }
    await sleep(400);
  }
  return false;
}
async function releaseGlobalSlot() {
  await rIncrBy("glob:gen", -1);
  // guard negative
  const v = safeInt(await rGet("glob:gen"), 0);
  if (v < 0) await rSet("glob:gen", "0");
}

// ------------------ CREDIT COST ------------------
function getCost(modelKey, qualityKey) {
  const m = MODELS[modelKey];
  if (!m) return null;

  if (m.type === "t2i" || m.type === "i2i") {
    const q = m.qualities?.[qualityKey];
    return q?.cost ?? null;
  }
  return null;
}

function canAccess(plan, modelKey) {
  const set = PLAN_ACCESS[plan] || PLAN_ACCESS.trial;
  return set.has(modelKey);
}

// ------------------ SMART PROMPT (UPGRADED) ------------------
function inferModelQualityFromText(rawText, plan) {
  let text = clampPrompt(rawText);
  const lower = text.toLowerCase();

  // Detect quality
  let quality = null;
  const qMatch = lower.match(/\b(2k|4k|8k)\b/);
  if (qMatch) quality = qMatch[1];

  // Score intent
  let scoreC = 0;
  let scoreR = 0;
  let scoreU = 0;

  const addIf = (cond, c, r, u) => {
    if (cond) {
      scoreC += c;
      scoreR += r;
      scoreU += u;
    }
  };

  addIf(/\b(anime|manga|fantasy|illustration|digital art|comic)\b/.test(lower), 4, 0, 0);
  addIf(/\b(cinematic|movie|film still|dramatic|hollywood|trailer)\b/.test(lower), 4, 1, 0);

  addIf(/\b(realistic|photoreal|photo|dslr|portrait|skin|face|product|headshot)\b/.test(lower), 0, 6, 0);
  addIf(/\b(pores|freckles|skin tone|texture|wrinkles|natural light|canon|nikon|sony|fuji|leica|a7r|85mm)\b/.test(lower), 0, 7, 0);

  addIf(/\b(studio|print|ultra sharp|poster|billboard)\b/.test(lower), 0, 1, 4);
  addIf(/\b(8k)\b/.test(lower), 0, 1, 8);

  // Choose model
  let model = "cinematic";
  if (scoreR >= scoreC && scoreR >= scoreU) model = "realism";
  if (scoreU > scoreR && scoreU > scoreC) model = "ultra8k";

  // Apply plan locks
  if (!canAccess(plan, model)) {
    model = plan === "trial" ? "cinematic" : "realism";
    if (!canAccess(plan, model)) model = "cinematic";
  }

  // Default quality
  if (!quality) {
    quality = model === "ultra8k" ? "8k" : model === "realism" ? "4k" : "2k";
  }

  // Clamp quality to supported
  const supported = Object.keys(MODELS[model].qualities || {});
  if (!supported.includes(quality)) {
    quality = supported.includes("2k") ? "2k" : supported[0];
  }

  // Remove routing tokens only
  text = text
    .replace(/\b(2k|4k|8k)\b/gi, "")
    .replace(/\b(pixlemeta|pixelmeta)\b/gi, "")
    .trim()
    .replace(/\s+/g, " ");

  return { model, quality, prompt: text };
}

function parseStructuredPrompt(userText) {
  const raw = (userText || "").toString();
  const parts = raw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);

  const kv = {};
  const free = [];

  for (const p of parts) {
    const m = p.match(/^([a-zA-Z ]{2,20})\s*:\s*(.+)$/);
    if (!m) {
      free.push(p);
      continue;
    }
    const key = m[1].toLowerCase().trim();
    const val = m[2].trim();
    kv[key] = val;
  }

  return { kv, free: free.join(", ") };
}

function buildPrompt(modelKey, qualityKey, userPrompt) {
  const base = clampPrompt(userPrompt);
  if (!base) return "";

  const { kv, free } = parseStructuredPrompt(base);

  const subject = kv.subject || kv.character || kv.person || kv.animal || free || base;
  const background = kv.background || kv.environment || kv.scene || "";
  const lighting = kv.lighting || "";
  const camera = kv.camera || kv.lens || "";
  const mood = kv.mood || "";
  const styleUser = kv.style || "";

  const qualityTag =
    qualityKey === "8k"
      ? "ultra sharp, print ready, extremely detailed"
      : qualityKey === "4k"
      ? "high detail, sharp, professional quality"
      : "high detail, sharp";

  const commonNo =
    "no watermark, no logo, no text, no signature, not blurry, no low quality, no oversmooth, no plastic skin, no CGI look";

  let preset = "";
  if (modelKey === "cinematic") {
    preset =
      styleUser ||
      "cinematic movie still, dramatic lighting, volumetric light, depth of field, masterpiece, high contrast";
  } else if (modelKey === "realism") {
    preset =
      styleUser ||
      "photorealistic DSLR photo, natural skin texture, realistic pores, accurate skin tone, sharp focus, natural lighting, high dynamic range, filmic tone mapping";
  } else if (modelKey === "ultra8k") {
    preset =
      styleUser ||
      "premium commercial photography, extremely detailed, studio quality, ultra clean, sharp micro-texture, high dynamic range";
  } else if (modelKey === "shark") {
    preset =
      styleUser ||
      "flagship photo edit, preserve realism, ultra clean DSLR look, accurate skin texture, high fidelity, professional retouching, natural";
  } else {
    preset = styleUser || "high quality, detailed";
  }

  const blocks = [
    preset,
    qualityTag,
    subject,
    background ? `background: ${background}` : "",
    lighting ? `lighting: ${lighting}` : "",
    mood ? `mood: ${mood}` : "",
    camera ? `camera: ${camera}` : "",
    commonNo
  ].filter(Boolean);

  return blocks.join(", ");
}

// ------------------ ENGINES ------------------
function pickFirstImageUrl(output) {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output[0] || null;
  if (typeof output === "object") {
    if (typeof output.url === "string") return output.url;
    if (Array.isArray(output.images) && output.images[0]?.url) return output.images[0].url;
    if (output.image?.url) return output.image.url;
  }
  return null;
}

async function falRun(modelId, input) {
  if (!FAL_API_KEY) throw new Error("FAL_API_KEY missing");
  const r = await fetchFn(`https://fal.run/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`fal error ${r.status}: ${j?.detail || j?.error || JSON.stringify(j)}`);
  return j;
}

// ✅ Topaz Upscale
async function falTopazUpscale(imageUrl, upscaleFactor) {
  const j = await falRun("fal-ai/topaz/upscale/image", {
    image_url: imageUrl,
    upscale_factor: upscaleFactor
  });

  const url = pickFirstImageUrl(j?.image) || j?.image?.url || j?.images?.[0]?.url;
  const out = url || pickFirstImageUrl(j);
  if (!out) throw new Error("topaz returned no image");
  return out;
}

async function falSchnellGenerate(prompt) {
  const j = await falRun("fal-ai/flux/schnell", { prompt, num_images: 1 });
  const url = j?.images?.[0]?.url;
  if (!url) throw new Error("fal_schnell returned no image");
  return url;
}

// ✅ DSLR Realism engine: Flux Ultra (RAW) + Topaz for 4K
async function falFluxUltraRealism(prompt, qualityKey) {
  const j = await falRun("fal-ai/flux-pro/v1.1-ultra", {
    prompt,
    num_images: 1,
    raw: true,
    enable_safety_checker: true,
    safety_tolerance: 2
  });

  const baseUrl = j?.images?.[0]?.url;
  if (!baseUrl) throw new Error("flux ultra realism returned no image");

  if (qualityKey === "4k") {
    return falTopazUpscale(baseUrl, 2);
  }
  return baseUrl;
}

// ✅ True 8K engine: Flux Ultra base + Topaz 4×
async function falFluxProGenerate8K(prompt) {
  // model id is never empty
  const j = await falRun(FAL_FLUX_PRO_MODEL, {
    prompt,
    num_images: 1,
    raw: true,
    enable_safety_checker: true,
    safety_tolerance: 2
  });

  const baseUrl = j?.images?.[0]?.url;
  if (!baseUrl) throw new Error("fal_flux_pro returned no image");

  // 2K-ish -> 8K
  const up8k = await falTopazUpscale(baseUrl, 4);
  return up8k;
}

// ✅ Shark V1 edit engine (Nano Banana Pro Edit) + optional 8K upscale
async function sharkV1EditPipeline(imageUrl, prompt, qualityKey) {
  // Nano Banana Pro supports resolution: 1K|2K|4K
  // We use 2K for quality=2k; 4K for quality=4k or 8k, then upscale to 8k via Topaz
  const nanoRes = qualityKey === "2k" ? "2K" : "4K";

  const j = await falRun("fal-ai/nano-banana-pro/edit", {
    prompt,
    image_urls: [imageUrl],
    resolution: nanoRes,
    num_images: 1
  });

  const edited = j?.images?.[0]?.url;
  if (!edited) throw new Error("shark v1 returned no image");

  if (qualityKey === "8k") {
    // 4K edit -> 8K upscale 2×
    return falTopazUpscale(edited, 2);
  }
  return edited;
}

async function replicateSDXLGenerate(prompt) {
  if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN missing");

  const create = await fetchFn("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      Prefer: "wait=60"
    },
    body: JSON.stringify({
      version: REPLICATE_SDXL_VERSION,
      input: { prompt }
    })
  });

  const j = await create.json().catch(() => ({}));
  if (!create.ok) {
    throw new Error(`replicate create ${create.status}: ${j?.detail || j?.error || JSON.stringify(j)}`);
  }

  const immediate = pickFirstImageUrl(j.output);
  if (immediate) return immediate;

  const getUrl = j?.urls?.get || (j?.id ? `https://api.replicate.com/v1/predictions/${j.id}` : null);
  if (!getUrl) throw new Error("replicate missing prediction get url");

  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const pr = await fetchFn(getUrl, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` }
    });
    const s = await pr.json().catch(() => ({}));

    const out = pickFirstImageUrl(s.output);
    if (out) return out;

    const status = String(s.status || "").toLowerCase();
    if (["failed", "canceled", "cancelled"].includes(status)) {
      throw new Error(`replicate ${status}: ${s?.error || "unknown"}`);
    }
  }
  throw new Error("replicate timeout");
}

async function runEngine(engine, payload) {
  switch (engine) {
    case "fal_schnell":
      return falSchnellGenerate(payload.prompt);

    case "fal_flux_ultra_realism":
      return falFluxUltraRealism(payload.prompt, payload.qualityKey);

    case "fal_flux_pro_8k":
      return falFluxProGenerate8K(payload.prompt);

    case "shark_v1_edit":
      return sharkV1EditPipeline(payload.imageUrl, payload.prompt, payload.qualityKey);

    case "replicate_sdxl":
      return replicateSDXLGenerate(payload.prompt);

    default:
      throw new Error(`Unknown engine: ${engine}`);
  }
}

async function generateWithModel(modelKey, qualityKey, userPrompt) {
  const model = MODELS[modelKey];
  if (!model) throw new Error("Invalid model");

  const smart = buildPrompt(modelKey, qualityKey, userPrompt);
  if (!smart) throw new Error("Empty prompt");

  try {
    return await runEngine(model.engines.primary, { prompt: smart, qualityKey });
  } catch (e1) {
    if (model.engines.backup) {
      return await runEngine(model.engines.backup, { prompt: smart, qualityKey });
    }
    throw e1;
  }
}

// ------------------ UI BUILDERS ------------------
function modelsKeyboard(plan) {
  const rows = [];

  for (const key of ["cinematic", "realism", "ultra8k", "shark"]) {
    const m = MODELS[key];
    const locked = !canAccess(plan, key);
    rows.push([
      {
        text: locked ? `${m.label} 🔒` : m.label,
        callback_data: `m:${key}`
      }
    ]);
  }

  rows.push([{ text: "❌ Cancel", callback_data: "x:cancel" }]);
  return { inline_keyboard: rows };
}

function qualityKeyboard(modelKey) {
  const m = MODELS[modelKey];
  const qualities = Object.keys(m.qualities || {});
  const rows = qualities.map((q) => [{ text: q.toUpperCase(), callback_data: `q:${modelKey}:${q}` }]);
  rows.push([{ text: "⬅️ Back", callback_data: "x:back_models" }]);
  rows.push([{ text: "❌ Cancel", callback_data: "x:cancel" }]);
  return { inline_keyboard: rows };
}

// ------------------ FLOW STATE ------------------
async function setFlow(chatId, obj) {
  await rSet(`flow:${chatId}`, JSON.stringify({ ...obj, ts: now() }), { ex: 900 });
}
async function getFlow(chatId) {
  const v = await rGet(`flow:${chatId}`);
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
async function clearFlow(chatId) {
  await rDel(`flow:${chatId}`);
}

// ------------------ COMMANDS ------------------
async function cmdStart(chatId) {
  await ensureUser(chatId);
  const plan = await getPlan(chatId);
  const credits = await getCredits(chatId);
  const creditsText = credits === Infinity ? "Unlimited" : String(credits);

  await sendMessage(
    chatId,
    `🚀 PIXELMETA AI\n\nPlan: ${plan.toUpperCase()}\nCredits: ${creditsText}\n\nCommands:\n/gen - menu\n/gen <prompt> - quick\n/shark <edit prompt> - premium edit (send photo first)\n/models - model list\n/credits - balance`
  );
}

async function cmdCredits(chatId) {
  await ensureUser(chatId);
  const plan = await getPlan(chatId);
  const credits = await getCredits(chatId);
  const creditsText = credits === Infinity ? "Unlimited" : String(credits);
  await sendMessage(chatId, `💳 Credits: ${creditsText}\nPlan: ${plan.toUpperCase()}`);
}

async function cmdModels(chatId) {
  await ensureUser(chatId);
  const plan = await getPlan(chatId);

  const lines = [];
  lines.push("🧠 PIXELMETA Models & Costs");
  lines.push("");

  const lock = (key) => (!canAccess(plan, key) ? " 🔒" : "");

  lines.push(
    `🎬 Pixlemeta Cinematic${lock("cinematic")}\n2K = 2 credits\n4K = 4 credits\nEngine: Flux Schnell\n`
  );
  lines.push(
    `📸 Pixlemeta Realism DSLR${lock("realism")}\n2K = 6 credits\n4K = 15 credits\nEngine: Flux Ultra RAW + Topaz\n`
  );
  lines.push(
    `🟪 Pixlemeta Ultra 8K${lock("ultra8k")}\n8K = 30 credits\nEngine: Flux Ultra RAW + Topaz 4×\n`
  );
  lines.push(
    `🦈 Pixlemeta Shark V1${lock("shark")}\n2K = 15 credits\n4K = 25 credits\n8K = 45 credits\nEngine: Nano Banana Pro Edit + Topaz\n\nUse:\n1) Send an image\n2) /shark <edit instruction>\n`
  );

  await sendMessage(chatId, lines.join("\n"));
}

async function cmdGenMenu(chatId) {
  await ensureUser(chatId);
  const plan = await getPlan(chatId);

  await clearFlow(chatId);
  await setFlow(chatId, { step: "choose_model" });

  await sendMessage(chatId, "🎨 Choose a PIXELMETA model:", modelsKeyboard(plan));
}

// ------------------ QUICK GEN ------------------
async function quickGen(chatId, rawPrompt) {
  await ensureUser(chatId);

  const plan = await getPlan(chatId);
  if (await isBanned(chatId)) return sendMessage(chatId, "🚫 You are banned.");

  const inferred = inferModelQualityFromText(rawPrompt, plan);
  const modelKey = inferred.model;
  const qualityKey = inferred.quality;
  const cleanedPrompt = inferred.prompt || clampPrompt(rawPrompt);

  if (!cleanedPrompt) {
    return sendMessage(chatId, "Usage: /gen <prompt>\nOr use /gen to open the menu.");
  }

  if (!canAccess(plan, modelKey)) {
    return sendMessage(chatId, "🔒 This model is locked for your plan. Use /gen to choose available models.");
  }

  const cost = getCost(modelKey, qualityKey);
  if (cost === null) return sendMessage(chatId, "⚠️ Invalid model/quality.");

  const credits = await getCredits(chatId);
  if (credits !== Infinity && credits < cost) {
    return sendMessage(chatId, `❌ Not enough credits.\nNeed: ${cost}\nYour balance: ${credits}`);
  }

  if (!(await acquireBusy(chatId))) {
    return sendMessage(chatId, "⏳ Please wait… your previous generation is still running.");
  }

  if (!(await acquireGlobalSlot())) {
    await releaseBusy(chatId);
    return sendMessage(chatId, "⏳ Server busy. Try again in a moment.");
  }

  try {
    await sendMessage(
      chatId,
      `🎨 Generating…\nModel: ${MODELS[modelKey].label}\nQuality: ${qualityKey.toUpperCase()}\n(Charge ${cost} credits only if successful)`
    );

    const url = await generateWithModel(modelKey, qualityKey, cleanedPrompt);

    await deductCredits(chatId, cost);
    await rIncrBy("m:gen_ok", 1).catch(() => {});

    const left = await getCredits(chatId);
    const leftText = left === Infinity ? "Unlimited" : String(left);

    // 8K send as document
    if (qualityKey === "8k") {
      await sendDocument(chatId, url, `✅ Done (8K)\nCredits left: ${leftText}`);
    } else {
      await sendPhoto(chatId, url, `✅ Done\nCredits left: ${leftText}`);
    }

    await rSet(`last:${chatId}`, JSON.stringify({ modelKey, qualityKey }), { ex: 60 * 60 * 24 * 30 });
  } catch (e) {
    console.error("quickGen error:", e?.message || e);
    await rIncrBy("m:gen_fail", 1).catch(() => {});
    await sendMessage(chatId, "⚠️ Generation failed. Try again.");
  } finally {
    await releaseGlobalSlot();
    await releaseBusy(chatId);
  }
}

// ------------------ SHARK COMMAND (IMAGE -> IMAGE) ------------------
async function cmdShark(chatId, editPromptRaw) {
  await ensureUser(chatId);
  const plan = await getPlan(chatId);

  if (!canAccess(plan, "shark")) {
    return sendMessage(chatId, "🔒 SHARK V1 is locked for your plan.");
  }

  const editPrompt = clampPrompt(editPromptRaw);
  if (!editPrompt) return sendMessage(chatId, "Usage: /shark <edit instruction>\nFirst send an image.");

  const fileId = await rGet(`lastphoto:${chatId}`);
  if (!fileId) return sendMessage(chatId, "📸 Send an image first, then use /shark <edit instruction>.");

  // Default shark quality: 4K (you can change)
  const qualityKey = "4k";
  const cost = getCost("shark", qualityKey);
  if (cost === null) return sendMessage(chatId, "⚠️ Shark config error.");

  const credits = await getCredits(chatId);
  if (credits !== Infinity && credits < cost) {
    return sendMessage(chatId, `❌ Not enough credits.\nNeed: ${cost}\nYour balance: ${credits}`);
  }

  if (!(await acquireBusy(chatId))) {
    return sendMessage(chatId, "⏳ Please wait… your previous generation is still running.");
  }

  if (!(await acquireGlobalSlot())) {
    await releaseBusy(chatId);
    return sendMessage(chatId, "⏳ Server busy. Try again in a moment.");
  }

  try {
    await sendMessage(
      chatId,
      `🦈 SHARK V1 editing…\nQuality: ${qualityKey.toUpperCase()}\n(Charge ${cost} credits only if successful)`
    );

    const imgUrl = await tgGetFileUrl(fileId);
    const smart = buildPrompt("shark", qualityKey, editPrompt);

    const outUrl = await runEngine("shark_v1_edit", {
      imageUrl: imgUrl,
      prompt: smart,
      qualityKey
    });

    await deductCredits(chatId, cost);
    await rIncrBy("m:gen_ok", 1).catch(() => {});

    const left = await getCredits(chatId);
    const leftText = left === Infinity ? "Unlimited" : String(left);

    // Shark default is 4K -> photo ok (if huge, you can switch to document)
    await sendPhoto(chatId, outUrl, `✅ SHARK V1 Done\nCredits left: ${leftText}`);
  } catch (e) {
    console.error("shark error:", e?.message || e);
    await rIncrBy("m:gen_fail", 1).catch(() => {});
    await sendMessage(chatId, "⚠️ SHARK edit failed. Try again.");
  } finally {
    await releaseGlobalSlot();
    await releaseBusy(chatId);
  }
}

// ------------------ ADMIN COMMANDS ------------------
function parseArgs(text) {
  return text.split(/\s+/).filter(Boolean);
}

async function adminOnly(chatId) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, "❌ Admin only.");
    return false;
  }
  return true;
}

async function handleAdmin(chatId, text) {
  if (!(await adminOnly(chatId))) return;

  const args = parseArgs(text);
  const cmd = args[0];

  if (cmd === "/addcredit") {
    const userId = args[1];
    const amount = safeInt(args[2], 0);
    if (!userId || amount <= 0) return sendMessage(chatId, "Usage: /addcredit <user_id> <amount>");
    await addCredits(userId, amount);
    return sendMessage(chatId, `✅ Added ${amount} credits to ${userId}`);
  }

  if (cmd === "/resetcredits") {
    const userId = args[1];
    if (!userId) return sendMessage(chatId, "Usage: /resetcredits <user_id>");
    const plan = (await rGet(`plan:${userId}`)) || "trial";
    const credits = PLAN_DEFAULT_CREDITS[plan] ?? 0;
    await rSet(`credits:${userId}`, String(credits));
    return sendMessage(chatId, `✅ Reset credits for ${userId} to ${credits} (plan: ${plan})`);
  }

  if (cmd === "/settrial") {
    const userId = args[1];
    if (!userId) return sendMessage(chatId, "Usage: /settrial <user_id>");
    await setPlan(userId, "trial");
    return sendMessage(chatId, `✅ Set TRIAL for ${userId} (40 credits)`);
  }

  if (cmd === "/setpromo") {
    const userId = args[1];
    if (!userId) return sendMessage(chatId, "Usage: /setpromo <user_id>");
    await setPlan(userId, "promo");
    return sendMessage(chatId, `✅ Set PROMO for ${userId} (100 credits)`);
  }

  if (cmd === "/setpaid") {
    const userId = args[1];
    const days = safeInt(args[2], 0);
    if (!userId) return sendMessage(chatId, "Usage: /setpaid <user_id> [days]");
    if (days > 0) {
      const expiresAt = now() + days * 24 * 60 * 60 * 1000;
      await setPlan(userId, "paid", { expiresAt });
      return sendMessage(chatId, `✅ Set PAID for ${userId} (1200 credits). Valid ${days} days`);
    }
    await setPlan(userId, "paid");
    return sendMessage(chatId, `✅ Set PAID for ${userId} (1200 credits). Validity not set`);
  }

  if (cmd === "/ban") {
    const userId = args[1];
    if (!userId) return sendMessage(chatId, "Usage: /ban <user_id>");
    await setBan(userId, true);
    return sendMessage(chatId, `✅ Banned ${userId}`);
  }

  if (cmd === "/unban") {
    const userId = args[1];
    if (!userId) return sendMessage(chatId, "Usage: /unban <user_id>");
    await setBan(userId, false);
    return sendMessage(chatId, `✅ Unbanned ${userId}`);
  }

  // ✅ Stats
  if (cmd === "/stats") {
    const totalUsers = redis ? await redis.scard("users") : 0;
    const ok = safeInt(await rGet("m:gen_ok"), 0);
    const fail = safeInt(await rGet("m:gen_fail"), 0);
    const tg429 = safeInt(await rGet("m:tg_429"), 0);
    const glob = safeInt(await rGet("glob:gen"), 0);

    return sendMessage(
      chatId,
      `📊 PIXELMETA STATS\n\nUsers: ${totalUsers}\nJobs OK: ${ok}\nJobs Fail: ${fail}\nTG 429: ${tg429}\nActive Gen Slots: ${glob}/${GLOBAL_GEN_LIMIT}`
    );
  }

  // ✅ Broadcast (safe because tgCall throttles + retries)
  if (cmd === "/broadcast") {
    const msgText = text.replace("/broadcast", "").trim();
    if (!msgText) return sendMessage(chatId, "Usage: /broadcast <message>");

    if (!redis) return sendMessage(chatId, "Redis required for broadcast.");

    const users = await redis.smembers("users");
    await sendMessage(chatId, `📢 Broadcasting to ${users.length} users...`);

    let sent = 0;
    for (const uid of users) {
      await sendMessage(uid, `📢 PIXELMETA NOTICE\n\n${msgText}`).catch(() => {});
      sent++;
      if (sent % 25 === 0) await sleep(500); // extra buffer
    }

    return sendMessage(chatId, `✅ Broadcast done. Sent to ${sent} users.`);
  }

  return sendMessage(chatId, "⚠️ Unknown admin command.");
}

// ------------------ CALLBACK HANDLER ------------------
async function onCallback(cq) {
  const chatId = String(cq.message?.chat?.id || "");
  const data = String(cq.data || "");
  await answerCallbackQuery(cq.id).catch(() => {});

  if (!chatId) return;

  await ensureUser(chatId);
  if (await isBanned(chatId)) return sendMessage(chatId, "🚫 You are banned.");

  const plan = await getPlan(chatId);

  if (data === "x:cancel") {
    await clearFlow(chatId);
    return sendMessage(chatId, "✅ Cancelled.");
  }

  if (data === "x:back_models") {
    await setFlow(chatId, { step: "choose_model" });
    return sendMessage(chatId, "🎨 Choose a PIXELMETA model:", modelsKeyboard(plan));
  }

  if (data.startsWith("m:")) {
    const modelKey = data.slice(2);

    if (!MODELS[modelKey]) return sendMessage(chatId, "⚠️ Invalid model.");
    if (!canAccess(plan, modelKey)) return sendMessage(chatId, "🔒 Model locked for your plan.");

    // Shark uses /shark command (image required), not menu prompt flow
    if (modelKey === "shark") {
      await clearFlow(chatId);
      return sendMessage(chatId, `🦈 SHARK V1 is image-to-image.\n\n1) Send a photo\n2) /shark <edit instruction>`);
    }

    await setFlow(chatId, { step: "choose_quality", modelKey });
    return sendMessage(chatId, `📐 Choose quality for ${MODELS[modelKey].label}:`, qualityKeyboard(modelKey));
  }

  if (data.startsWith("q:")) {
    const parts = data.split(":");
    const modelKey = parts[1];
    const qualityKey = parts[2];

    if (!MODELS[modelKey]?.qualities?.[qualityKey]) return sendMessage(chatId, "⚠️ Invalid quality.");

    const cost = getCost(modelKey, qualityKey);
    if (cost === null) return sendMessage(chatId, "⚠️ Invalid cost config.");

    const credits = await getCredits(chatId);
    if (credits !== Infinity && credits < cost) {
      return sendMessage(chatId, `❌ Not enough credits.\nNeed: ${cost}\nYour balance: ${credits}`);
    }

    await setFlow(chatId, { step: "await_prompt", modelKey, qualityKey, cost });
    return sendMessage(
      chatId,
      `✍️ Send your prompt now.\n\nExample:\n"subject: lion; lighting: golden hour; camera: 85mm; background: savannah"\n\n(Charge ${cost} credits only if generation succeeds)`
    );
  }
}

// ------------------ MESSAGE HANDLER ------------------
async function onMessage(msg) {
  const chatId = String(msg.chat?.id || "");
  if (!chatId) return;

  const allowed = await rateLimit(chatId);
  if (!allowed) return;

  await ensureUser(chatId);

  if (await isBanned(chatId)) {
    if (!isAdmin(chatId)) return sendMessage(chatId, "🚫 You are banned.");
  }

  // Store last photo for SHARK editing
  if (msg.photo && msg.photo.length) {
    const best = msg.photo[msg.photo.length - 1];
    if (best?.file_id) {
      await rSet(`lastphoto:${chatId}`, best.file_id, { ex: 60 * 60 * 12 });
      await sendMessage(chatId, "📸 Photo saved. Use /shark <edit instruction> to edit it.");
    }
  }

  const text = (msg.text || "").trim();

  // Admin commands
  if (
    text.startsWith("/addcredit") ||
    text.startsWith("/settrial") ||
    text.startsWith("/setpromo") ||
    text.startsWith("/setpaid") ||
    text.startsWith("/ban") ||
    text.startsWith("/unban") ||
    text.startsWith("/resetcredits") ||
    text.startsWith("/stats") ||
    text.startsWith("/broadcast")
  ) {
    await handleAdmin(chatId, text);
    return;
  }

  if (text === "/start") return cmdStart(chatId);
  if (text === "/credits") return cmdCredits(chatId);
  if (text === "/models") return cmdModels(chatId);
  if (text === "/cancel") {
    await clearFlow(chatId);
    await releaseBusy(chatId);
    return sendMessage(chatId, "✅ Cancelled.");
  }

  // SHARK edit command
  if (text.startsWith("/shark ")) {
    return cmdShark(chatId, text.slice(7));
  }
  if (text === "/shark") {
    return sendMessage(chatId, "Usage: /shark <edit instruction>\nFirst send an image.");
  }

  // /gen menu
  if (text === "/gen") return cmdGenMenu(chatId);

  // /gen quick
  if (text.startsWith("/gen ")) return quickGen(chatId, text.slice(5));

  // Flow prompt capture
  const flow = await getFlow(chatId);
  if (flow && flow.step === "await_prompt" && text && !text.startsWith("/")) {
    const modelKey = flow.modelKey;
    const qualityKey = flow.qualityKey;
    const cost = safeInt(flow.cost, 0);

    const credits = await getCredits(chatId);
    if (credits !== Infinity && credits < cost) {
      await clearFlow(chatId);
      return sendMessage(chatId, `❌ Not enough credits.\nNeed: ${cost}\nYour balance: ${credits}`);
    }

    if (!(await acquireBusy(chatId))) {
      return sendMessage(chatId, "⏳ Please wait… your previous generation is still running.");
    }

    if (!(await acquireGlobalSlot())) {
      await releaseBusy(chatId);
      return sendMessage(chatId, "⏳ Server busy. Try again in a moment.");
    }

    try {
      await sendMessage(chatId, `🎨 Generating…\nModel: ${MODELS[modelKey].label}\nQuality: ${qualityKey.toUpperCase()}`);

      const url = await generateWithModel(modelKey, qualityKey, text);

      await deductCredits(chatId, cost);
      await rIncrBy("m:gen_ok", 1).catch(() => {});

      const left = await getCredits(chatId);
      const leftText = left === Infinity ? "Unlimited" : String(left);

      if (qualityKey === "8k") {
        await sendDocument(chatId, url, `✅ Done (8K)\nCredits left: ${leftText}`);
      } else {
        await sendPhoto(chatId, url, `✅ Done\nCredits left: ${leftText}`);
      }

      await rSet(`last:${chatId}`, JSON.stringify({ modelKey, qualityKey }), { ex: 60 * 60 * 24 * 30 });
    } catch (e) {
      console.error("flow gen error:", e?.message || e);
      await rIncrBy("m:gen_fail", 1).catch(() => {});
      await sendMessage(chatId, "⚠️ Generation failed. Try again.");
    } finally {
      await clearFlow(chatId);
      await releaseGlobalSlot();
      await releaseBusy(chatId);
    }
    return;
  }

  if (text && !text.startsWith("/")) {
    return sendMessage(chatId, `Use /gen to generate an image.\nOr: /gen <prompt>\n\nFor photo editing:\n1) Send photo\n2) /shark <edit instruction>`);
  }
}

// ------------------ EXPRESS ROUTES ------------------
app.get("/", (req, res) => res.status(200).send("ok"));

app.post("/", async (req, res) => {
  if (TG_SECRET_TOKEN) {
    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (secret !== TG_SECRET_TOKEN) return res.sendStatus(401);
  }

  res.sendStatus(200);

  const update = req.body;

  try {
    if (update?.callback_query) return await onCallback(update.callback_query);
    if (update?.message) return await onMessage(update.message);
  } catch (e) {
    console.error("Update handler error:", e?.message || e);
  }
});

// Crash safety logs
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

// Start server
app.listen(PORT, () => {
  console.log("🚀 PIXELMETA ENGINE LIVE on port", PORT);
  console.log("✅ FAL_FLUX_PRO_MODEL =", FAL_FLUX_PRO_MODEL);
  console.log("✅ GLOBAL_GEN_LIMIT =", GLOBAL_GEN_LIMIT);
});
