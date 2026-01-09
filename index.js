"use strict";

/**
 * PIXELMETA AI - Production Index
 * Admin ID: 1078816855
 *
 * Features:
 * - /gen guided UI (model -> quality -> prompt)
 * - /gen <prompt> quick mode with smart auto-detect (model + quality)
 * - Plans + Credits + Locks (Trial/Promo/Paid/Admin)
 * - Credits deducted only on SUCCESS
 * - Replicate SDXL (primary for Realism) + FAL Flux Schnell (primary for Cinematic, fallback)
 * - Rate limit + Busy lock + Ban system
 * - Admin commands
 */

const express = require("express");
const Redis = require("ioredis");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.disable("x-powered-by");

// ------------------ ENV ------------------
const TG_TOKEN = process.env.TG_TOKEN;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const FAL_API_KEY = process.env.FAL_API_KEY || process.env.FAL_KEY;
const REDIS_URL = process.env.REDIS_URL;

const TG_SECRET_TOKEN = process.env.TG_SECRET_TOKEN; // optional webhook protection
const FAL_FLUX_PRO_MODEL = process.env.FAL_FLUX_PRO_MODEL; // optional later

const PORT = process.env.PORT || 8080;

// Admin
const ADMIN_ID = "1078816855";

// Replicate SDXL version (you already used)
const REPLICATE_SDXL_VERSION =
  "39ed52f2a78e934b3ba6f1f50c7b07c7a1c77d9b29b19a70c2b6c38b1f86c7c5";

// Basic limits
const MAX_PROMPT_LEN = 900;
const BUSY_LOCK_SECONDS = 120;

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
    label: "📸 Pixlemeta Realism",
    type: "t2i",
    qualities: {
      "2k": { cost: 4 },
      "4k": { cost: 10 }
    },
    engines: { primary: "replicate_sdxl", backup: "fal_schnell" }
  },
  ultra8k: {
    key: "ultra8k",
    label: "🟪 Pixlemeta Ultra 8K",
    type: "t2i",
    qualities: {
      "8k": { cost: 10 }
    },
    engines: { primary: "fal_flux_pro", backup: null }
  },
  edit: {
    key: "edit",
    label: "🟥 Pixlemeta EDIT",
    type: "i2i",
    cost: 80,
    engines: { primary: "openai_edit", backup: null }
  },
  shark: {
    key: "shark",
    label: "🦈 Pixlemeta SHARK V1",
    type: "i2i",
    cost: 140,
    engines: { primary: "shark_pipeline", backup: null }
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

// ------------------ TELEGRAM API ------------------
async function tgCall(method, payload) {
  if (!TG_TOKEN) throw new Error("Missing TG_TOKEN");

  const r = await fetchFn(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) {
    throw new Error(`Telegram ${method} failed: ${r.status} ${JSON.stringify(j)}`);
  }
  return j.result;
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

async function answerCallbackQuery(callbackQueryId, text) {
  // Prevent "loading..." stuck
  const payload = { callback_query_id: callbackQueryId };
  if (text) payload.text = text;
  return tgCall("answerCallbackQuery", payload);
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

  // Admin is virtual "admin"
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

  // Reset credits to plan default (your plan design)
  const credits = PLAN_DEFAULT_CREDITS[plan] ?? 0;
  await rSet(`credits:${id}`, String(credits));

  // Optional expiry support (if you later want)
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
  // 1 request per ~1s per user (silent)
  const id = String(chatId);
  const key = `rl:${id}`;
  const ok = await rSet(key, "1", { ex: 1, nx: true });
  return ok === "OK"; // true if allowed
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

// ------------------ CREDIT COST ------------------
function getCost(modelKey, qualityKey) {
  const m = MODELS[modelKey];
  if (!m) return null;

  if (m.type === "t2i") {
    const q = m.qualities?.[qualityKey];
    return q?.cost ?? null;
  }
  return m.cost ?? null;
}

function canAccess(plan, modelKey) {
  const set = PLAN_ACCESS[plan] || PLAN_ACCESS.trial;
  return set.has(modelKey);
}

// ------------------ SMART PROMPT (complex prompt understanding) ------------------
function inferModelQualityFromText(rawText, plan) {
  let text = clampPrompt(rawText);
  const lower = text.toLowerCase();

  // Detect quality
  let quality = null;
  const qMatch = lower.match(/\b(2k|4k|8k)\b/);
  if (qMatch) quality = qMatch[1];

  // Score model intent by keywords
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
  addIf(/\b(realistic|photoreal|photo|dslr|portrait|skin|face|product)\b/.test(lower), 0, 5, 0);
  addIf(/\b(studio|print|ultra sharp|poster|billboard)\b/.test(lower), 0, 1, 4);
  addIf(/\b(8k)\b/.test(lower), 0, 1, 6);

  // Choose model
  let model = "cinematic";
  if (scoreR >= scoreC && scoreR >= scoreU) model = "realism";
  if (scoreU > scoreR && scoreU > scoreC) model = "ultra8k";

  // Apply plan locks
  if (!canAccess(plan, model)) {
    // fallback to allowed default
    model = plan === "trial" ? "cinematic" : "realism";
    if (!canAccess(plan, model)) model = "cinematic";
  }

  // Default quality if missing
  if (!quality) {
    quality = model === "ultra8k" ? "8k" : "2k";
  }

  // Clamp quality to model supported qualities
  const supported = Object.keys(MODELS[model].qualities || {});
  if (!supported.includes(quality)) {
    // fallback best available
    quality = supported.includes("2k") ? "2k" : supported[0];
  }

  // Clean some routing words (but keep meaning)
  // (We remove only obvious routing tokens.)
  text = text
    .replace(/\b(2k|4k|8k)\b/gi, "")
    .replace(/\b(pixlemeta|pixelmeta)\b/gi, "")
    .trim()
    .replace(/\s+/g, " ");

  return { model, quality, prompt: text };
}

function parseStructuredPrompt(userText) {
  // Supports inputs like: "subject: lion; lighting: golden hour; camera: 85mm; background: savannah"
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

  // If user used structured prompt, we rebuild it nicely:
  const subject = kv.subject || kv.character || kv.person || kv.animal || free || base;
  const background = kv.background || kv.environment || kv.scene || "";
  const lighting = kv.lighting || "";
  const camera = kv.camera || kv.lens || "";
  const mood = kv.mood || "";
  const styleUser = kv.style || "";

  const qualityTag =
    qualityKey === "8k"
      ? "ultra sharp, 8k, print ready"
      : qualityKey === "4k"
      ? "high detail, 4k"
      : "high detail";

  const commonNo = "no watermark, no logo, no text, no signature, not blurry, no low quality";

  let preset = "";
  if (modelKey === "cinematic") {
    preset =
      styleUser ||
      "cinematic movie still, dramatic lighting, volumetric light, depth of field, stylized, masterpiece";
  } else if (modelKey === "realism") {
    preset =
      styleUser ||
      "photorealistic, DSLR photo, sharp focus, natural skin texture, realistic lighting, ultra detailed";
  } else if (modelKey === "ultra8k") {
    preset =
      styleUser ||
      "studio quality, ultra sharp details, premium commercial photography, extremely detailed";
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

async function falSchnellGenerate(prompt) {
  const j = await falRun("fal-ai/flux/schnell", { prompt, num_images: 1 });
  const url = j?.images?.[0]?.url;
  if (!url) throw new Error("fal_schnell returned no image");
  return url;
}

async function falFluxProGenerate(prompt) {
  // You will add your correct model id later in env:
  // FAL_FLUX_PRO_MODEL="fal-ai/flux-pro" (example)
  if (!FAL_FLUX_PRO_MODEL) throw new Error("Ultra 8K not configured (missing FAL_FLUX_PRO_MODEL)");
  const j = await falRun(FAL_FLUX_PRO_MODEL, { prompt, num_images: 1 });
  const url = j?.images?.[0]?.url;
  if (!url) throw new Error("fal_flux_pro returned no image");
  return url;
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

// Placeholders for future premium engines
async function openaiEditPlaceholder() {
  throw new Error("EDIT is coming soon (engine not connected yet)");
}
async function sharkPipelinePlaceholder() {
  throw new Error("SHARK is coming soon (pipeline not connected yet)");
}

async function runEngine(engine, payload) {
  switch (engine) {
    case "fal_schnell":
      return falSchnellGenerate(payload.prompt);

    case "replicate_sdxl":
      return replicateSDXLGenerate(payload.prompt);

    case "fal_flux_pro":
      return falFluxProGenerate(payload.prompt);

    case "openai_edit":
      return openaiEditPlaceholder();

    case "shark_pipeline":
      return sharkPipelinePlaceholder();

    default:
      throw new Error(`Unknown engine: ${engine}`);
  }
}

async function generateWithModel(modelKey, qualityKey, userPrompt) {
  const model = MODELS[modelKey];
  if (!model) throw new Error("Invalid model");

  const smart = buildPrompt(modelKey, qualityKey, userPrompt);
  if (!smart) throw new Error("Empty prompt");

  // Primary engine
  try {
    return await runEngine(model.engines.primary, { prompt: smart });
  } catch (e1) {
    // Backup engine if exists
    if (model.engines.backup) {
      return await runEngine(model.engines.backup, { prompt: smart });
    }
    throw e1;
  }
}

// ------------------ UI BUILDERS ------------------
function modelsKeyboard(plan) {
  const rows = [];

  for (const key of ["cinematic", "realism", "ultra8k", "edit", "shark"]) {
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
  const rows = qualities.map((q) => [
    { text: q.toUpperCase(), callback_data: `q:${modelKey}:${q}` }
  ]);
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
    `🚀 PIXELMETA AI\n\nPlan: ${plan.toUpperCase()}\nCredits: ${creditsText}\n\nUse /gen to generate.\nUse /models to see model list.\nUse /credits to check balance.`
  );
}

async function cmdCredits(chatId) {
  await ensureUser(chatId);
  const plan = await getPlan(chatId);
  const credits = await getCredits(chatId);
  const creditsText = credits === Infinity ? "Unlimited" : String(credits);
  await sendMessage(chatId, `💳 Credits: ${creditsText}\nPlan: ${plan.toUpperCase()}`);
}

async function cmdPlanValidity(chatId) {
  await ensureUser(chatId);
  const plan = await getPlan(chatId);
  const exp = await rGet(`planexp:${chatId}`);
  if (!exp) {
    await sendMessage(chatId, `🧾 Plan: ${plan.toUpperCase()}\nValidity: Not set`);
    return;
  }
  const ts = safeInt(exp, 0);
  const d = new Date(ts);
  await sendMessage(chatId, `🧾 Plan: ${plan.toUpperCase()}\nValid until: ${d.toISOString()}`);
}

async function cmdModels(chatId) {
  await ensureUser(chatId);
  const plan = await getPlan(chatId);

  const lines = [];
  lines.push("🧠 PIXELMETA Models & Costs");
  lines.push("");

  const add = (name, text) => lines.push(`${name}\n${text}\n`);

  const lock = (key) => (!canAccess(plan, key) ? " 🔒" : "");

  add(
    `🎬 Pixlemeta Cinematic${lock("cinematic")}`,
    `2K = 2 credits\n4K = 4 credits\nEngine: FAL Flux Schnell`
  );
  add(
    `📸 Pixlemeta Realism${lock("realism")}`,
    `2K = 4 credits\n4K = 10 credits\nEngine: Replicate SDXL (fallback FAL Schnell)`
  );
  add(
    `🟪 Pixlemeta Ultra 8K${lock("ultra8k")}`,
    `8K = 10 credits\nEngine: FAL Flux Pro`
  );
  add(`🟥 Pixlemeta EDIT${lock("edit")}`, `80 credits\nEngine: OpenAI (coming soon)`);
  add(`🦈 Pixlemeta SHARK V1${lock("shark")}`, `140 credits\nEngine: Enhance pipeline (coming soon)`);

  await sendMessage(chatId, lines.join("\n"));
}

async function cmdGenMenu(chatId) {
  await ensureUser(chatId);
  const plan = await getPlan(chatId);

  await clearFlow(chatId);
  await setFlow(chatId, { step: "choose_model" });

  await sendMessage(chatId, "🎨 Choose a PIXELMETA model:", modelsKeyboard(plan));
}

async function quickGen(chatId, rawPrompt) {
  await ensureUser(chatId);

  const plan = await getPlan(chatId);
  if (await isBanned(chatId)) {
    await sendMessage(chatId, "🚫 You are banned.");
    return;
  }

  const inferred = inferModelQualityFromText(rawPrompt, plan);
  const modelKey = inferred.model;
  const qualityKey = inferred.quality;
  const cleanedPrompt = inferred.prompt || clampPrompt(rawPrompt);

  if (!cleanedPrompt) {
    await sendMessage(chatId, "Usage: /gen <prompt>\nOr use /gen to open the menu.");
    return;
  }

  if (!canAccess(plan, modelKey)) {
    await sendMessage(chatId, "🔒 This model is locked for your plan. Use /gen to choose available models.");
    return;
  }

  const cost = getCost(modelKey, qualityKey);
  if (cost === null) {
    await sendMessage(chatId, "⚠️ Invalid model/quality.");
    return;
  }

  // Credit check (do not deduct yet)
  const credits = await getCredits(chatId);
  if (credits !== Infinity && credits < cost) {
    await sendMessage(chatId, `❌ Not enough credits.\nNeed: ${cost}\nYour balance: ${credits}`);
    return;
  }

  // Busy lock
  if (!(await acquireBusy(chatId))) {
    await sendMessage(chatId, "⏳ Please wait… your previous generation is still running.");
    return;
  }

  try {
    await sendMessage(chatId, `🎨 Generating…\nModel: ${MODELS[modelKey].label}\nQuality: ${qualityKey.toUpperCase()}\n(You will be charged ${cost} credits only if successful)`);

    const url = await generateWithModel(modelKey, qualityKey, cleanedPrompt);

    // Deduct only after success
    await deductCredits(chatId, cost);

    const left = await getCredits(chatId);
    const leftText = left === Infinity ? "Unlimited" : String(left);

    await sendPhoto(chatId, url, `✅ Done\nCredits left: ${leftText}`);
    await rSet(`last:${chatId}`, JSON.stringify({ modelKey, qualityKey }), { ex: 60 * 60 * 24 * 30 });
  } catch (e) {
    console.error("quickGen error:", e?.message || e);
    await sendMessage(chatId, "⚠️ Generation failed. Try again.");
  } finally {
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
    const days = safeInt(args[2], 0); // optional
    if (!userId) return sendMessage(chatId, "Usage: /setpaid <user_id> [days]");
    if (days > 0) {
      const expiresAt = now() + days * 24 * 60 * 60 * 1000;
      await setPlan(userId, "paid", { expiresAt });
      return sendMessage(chatId, `✅ Set PAID for ${userId} (1200 credits). Valid ${days} days`);
    } else {
      await setPlan(userId, "paid");
      return sendMessage(chatId, `✅ Set PAID for ${userId} (1200 credits). Validity not set`);
    }
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

  // Unknown admin cmd
  return sendMessage(chatId, "⚠️ Unknown admin command.");
}

// ------------------ CALLBACK HANDLER ------------------
async function onCallback(cq) {
  const chatId = String(cq.message?.chat?.id || "");
  const data = String(cq.data || "");
  await answerCallbackQuery(cq.id).catch(() => {});

  if (!chatId) return;

  await ensureUser(chatId);
  if (await isBanned(chatId)) {
    await sendMessage(chatId, "🚫 You are banned.");
    return;
  }

  const plan = await getPlan(chatId);

  // Cancel / Back
  if (data === "x:cancel") {
    await clearFlow(chatId);
    await sendMessage(chatId, "✅ Cancelled.");
    return;
  }
  if (data === "x:back_models") {
    await setFlow(chatId, { step: "choose_model" });
    await sendMessage(chatId, "🎨 Choose a PIXELMETA model:", modelsKeyboard(plan));
    return;
  }

  // Model choose
  if (data.startsWith("m:")) {
    const modelKey = data.slice(2);

    if (!MODELS[modelKey]) {
      await sendMessage(chatId, "⚠️ Invalid model.");
      return;
    }

    if (!canAccess(plan, modelKey)) {
      await sendMessage(chatId, "🔒 This model is locked for your plan.\nUpgrade required.");
      return;
    }

    // EDIT/SHARK flows are future (we keep UI but block safely)
    if (modelKey === "edit" || modelKey === "shark") {
      await setFlow(chatId, { step: "blocked_future", modelKey });
      await sendMessage(chatId, "🚧 This premium feature is coming soon.\n(Engine not connected yet)");
      return;
    }

    await setFlow(chatId, { step: "choose_quality", modelKey });
    await sendMessage(chatId, `📐 Choose quality for ${MODELS[modelKey].label}:`, qualityKeyboard(modelKey));
    return;
  }

  // Quality choose
  if (data.startsWith("q:")) {
    const parts = data.split(":"); // q:model:quality
    const modelKey = parts[1];
    const qualityKey = parts[2];

    if (!MODELS[modelKey]?.qualities?.[qualityKey]) {
      await sendMessage(chatId, "⚠️ Invalid quality.");
      return;
    }

    const cost = getCost(modelKey, qualityKey);
    if (cost === null) {
      await sendMessage(chatId, "⚠️ Invalid cost config.");
      return;
    }

    const credits = await getCredits(chatId);
    if (credits !== Infinity && credits < cost) {
      await sendMessage(chatId, `❌ Not enough credits.\nNeed: ${cost}\nYour balance: ${credits}`);
      return;
    }

    await setFlow(chatId, { step: "await_prompt", modelKey, qualityKey, cost });

    await sendMessage(
      chatId,
      `✍️ Send your prompt now.\n\nExample:\n"subject: lion; lighting: golden hour; camera: 85mm; background: savannah"\n\n(Charge ${cost} credits only if generation succeeds)`
    );
    return;
  }
}

// ------------------ MESSAGE HANDLER ------------------
async function onMessage(msg) {
  const chatId = String(msg.chat?.id || "");
  if (!chatId) return;

  // webhook secret protection
  // handled at express route level (below)

  // Basic rate limit (silent drop)
  const allowed = await rateLimit(chatId);
  if (!allowed) return;

  await ensureUser(chatId);

  if (await isBanned(chatId)) {
    // allow admin to message even if banned
    if (!isAdmin(chatId)) {
      await sendMessage(chatId, "🚫 You are banned.");
      return;
    }
  }

  // Admin commands
  const text = (msg.text || "").trim();

  if (text.startsWith("/addcredit") || text.startsWith("/settrial") || text.startsWith("/setpromo") ||
      text.startsWith("/setpaid") || text.startsWith("/ban") || text.startsWith("/unban") ||
      text.startsWith("/resetcredits")) {
    await handleAdmin(chatId, text);
    return;
  }

  // Standard commands
  if (text === "/start") return cmdStart(chatId);
  if (text === "/credits") return cmdCredits(chatId);
  if (text === "/planvalidity") return cmdPlanValidity(chatId);
  if (text === "/models") return cmdModels(chatId);
  if (text === "/cancel") {
    await clearFlow(chatId);
    await releaseBusy(chatId);
    return sendMessage(chatId, "✅ Cancelled.");
  }

  // /gen entry
  if (text === "/gen") {
    return cmdGenMenu(chatId);
  }

  // /gen <prompt> quick mode (smart detection)
  if (text.startsWith("/gen ")) {
    const rawPrompt = text.slice(5);
    return quickGen(chatId, rawPrompt);
  }

  // Flow prompt capture
  const flow = await getFlow(chatId);
  if (flow && flow.step === "await_prompt" && text && !text.startsWith("/")) {
    const modelKey = flow.modelKey;
    const qualityKey = flow.qualityKey;
    const cost = safeInt(flow.cost, 0);

    // Credit check again (still no deduction yet)
    const credits = await getCredits(chatId);
    if (credits !== Infinity && credits < cost) {
      await clearFlow(chatId);
      await sendMessage(chatId, `❌ Not enough credits.\nNeed: ${cost}\nYour balance: ${credits}`);
      return;
    }

    // Busy lock
    if (!(await acquireBusy(chatId))) {
      await sendMessage(chatId, "⏳ Please wait… your previous generation is still running.");
      return;
    }

    try {
      await sendMessage(chatId, `🎨 Generating…\nModel: ${MODELS[modelKey].label}\nQuality: ${qualityKey.toUpperCase()}`);

      const url = await generateWithModel(modelKey, qualityKey, text);

      // Deduct only after success
      await deductCredits(chatId, cost);

      const left = await getCredits(chatId);
      const leftText = left === Infinity ? "Unlimited" : String(left);

      await sendPhoto(chatId, url, `✅ Done\nCredits left: ${leftText}`);
      await rSet(`last:${chatId}`, JSON.stringify({ modelKey, qualityKey }), { ex: 60 * 60 * 24 * 30 });
    } catch (e) {
      console.error("flow gen error:", e?.message || e);
      await sendMessage(chatId, "⚠️ Generation failed. Try again.");
    } finally {
      await clearFlow(chatId);
      await releaseBusy(chatId);
    }

    return;
  }

  // If user types something random, guide them
  if (text && !text.startsWith("/")) {
    await sendMessage(chatId, `Use /gen to generate an image.\nOr: /gen <prompt>`);
  }
}

// ------------------ EXPRESS ROUTES ------------------
app.get("/", (req, res) => res.status(200).send("ok"));

app.post("/", async (req, res) => {
  // webhook secret protection (optional)
  if (TG_SECRET_TOKEN) {
    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (secret !== TG_SECRET_TOKEN) {
      return res.sendStatus(401);
    }
  }

  res.sendStatus(200);

  const update = req.body;

  try {
    if (update?.callback_query) {
      await onCallback(update.callback_query);
      return;
    }
    if (update?.message) {
      await onMessage(update.message);
      return;
    }
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
});
