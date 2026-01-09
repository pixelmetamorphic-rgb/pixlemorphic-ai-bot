const express = require("express");
const Redis = require("ioredis");

const app = express();
app.use(express.json({ limit: "2mb" }));

const TG = process.env.TG_TOKEN;
const REPLICATE = process.env.REPLICATE_API_TOKEN;
const FAL = process.env.FAL_API_KEY || process.env.FAL_KEY; // support both
const REDIS_URL = process.env.REDIS_URL;

const ADMIN = process.env.ADMIN_ID || "1078816855";

// Use native fetch if available (Node 18+), else fallback to node-fetch
const fetchFn =
  global.fetch?.bind(global) ||
  ((...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args)));

const redis = REDIS_URL ? new Redis(REDIS_URL) : null;
if (redis) {
  // prevent crash on redis connection errors
  redis.on("error", (err) => console.error("Redis error:", err?.message || err));
}

// ---------- Telegram helpers ----------
async function tgCall(method, payload) {
  if (!TG) throw new Error("Missing TG_TOKEN");

  const r = await fetchFn(`https://api.telegram.org/bot${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const j = await r.json().catch(() => ({}));

  if (!r.ok || j.ok === false) {
    throw new Error(`Telegram ${method} failed: ${r.status} ${JSON.stringify(j)}`);
  }
  return j.result;
}

async function sendMessage(chatId, text) {
  return tgCall("sendMessage", { chat_id: chatId, text });
}

async function sendPhoto(chatId, photoUrl, caption) {
  return tgCall("sendPhoto", { chat_id: chatId, photo: photoUrl, caption });
}

// ---------- Credits ----------
async function getCredits(id) {
  if (id === ADMIN) return 999999;
  if (!redis) return 0;

  const v = await redis.get(`credits:${id}`);
  const n = parseInt(v ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

async function addCredits(id, n) {
  if (id === ADMIN) return;
  if (!redis) return;
  await redis.incrby(`credits:${id}`, n);
}

async function useCredits(id, n) {
  if (id === ADMIN) return true;

  const c = await getCredits(id);
  if (c < n) return false;

  await redis.decrby(`credits:${id}`, n);
  return true;
}

// ---------- Output normalizer ----------
function pickFirstImageUrl(output) {
  if (!output) return null;

  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output[0] ?? null;

  if (typeof output === "object") {
    if (typeof output.url === "string") return output.url;
    if (typeof output.image === "string") return output.image;

    if (Array.isArray(output.images)) {
      const first = output.images[0];
      if (typeof first === "string") return first;
      if (first && typeof first.url === "string") return first.url;
    }
  }

  return null;
}

// ---------- Replicate (SDXL) ----------
const REPLICATE_SDXL_VERSION =
  "39ed52f2a78e934b3ba6f1f50c7b07c7a1c77d9b29b19a70c2b6c38b1f86c7c5";

async function replicateGenerate(prompt) {
  if (!REPLICATE) throw new Error("Missing REPLICATE_API_TOKEN");

  // Use sync mode (wait up to 60s) when possible
  const r = await fetchFn("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE}`, // IMPORTANT (not Token)
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      version: REPLICATE_SDXL_VERSION,
      input: { prompt },
    }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Replicate create failed: ${r.status} ${j.detail || j.error || JSON.stringify(j)}`);
  }

  // If sync returned output right away
  const immediate = pickFirstImageUrl(j.output);
  if (immediate) return immediate;

  // Otherwise poll
  const getUrl = j.urls?.get || (j.id ? `https://api.replicate.com/v1/predictions/${j.id}` : null);
  if (!getUrl) throw new Error("Replicate response missing prediction id/urls.get");

  for (let i = 0; i < 40; i++) {
    await new Promise((x) => setTimeout(x, 2000));

    const pr = await fetchFn(getUrl, {
      headers: { Authorization: `Bearer ${REPLICATE}` },
    });

    const s = await pr.json().catch(() => ({}));

    const out = pickFirstImageUrl(s.output);
    if (out) return out;

    const status = String(s.status || "").toLowerCase();
    if (["failed", "canceled", "cancelled"].includes(status)) {
      throw new Error(`Replicate ${status}: ${s.error || "unknown error"}`);
    }

    // handle newer success naming too
    if (["successful", "completed", "succeeded"].includes(status) && !out) {
      throw new Error(`Replicate finished (${status}) but no output found`);
    }
  }

  throw new Error("Replicate timeout");
}

// ---------- fal.ai (FLUX schnell) ----------
async function falGenerate(prompt) {
  if (!FAL) throw new Error("Missing FAL_API_KEY (or FAL_KEY)");

  // Correct synchronous endpoint:
  // POST https://fal.run/{model_id} with Authorization: Key ... 
  const r = await fetchFn("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      num_images: 1,
    }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`fal failed: ${r.status} ${j.detail || j.error || JSON.stringify(j)}`);
  }

  const url = j?.images?.[0]?.url;
  if (!url) throw new Error("fal returned no images[0].url");

  return url;
}

// ---------- Smart engine ----------
async function generate(prompt) {
  try {
    return await replicateGenerate(prompt);
  } catch (err) {
    console.error("Replicate failed, falling back to fal:", err?.message || err);
    return await falGenerate(prompt);
  }
}

// ---------- Railway health ----------
app.get("/", (req, res) => res.status(200).send("ok"));

// ---------- Telegram webhook ----------
app.post("/", async (req, res) => {
  res.sendStatus(200); // respond fast to Telegram

  try {
    const msg = req.body?.message;
    if (!msg?.text) return;

    const chat = String(msg.chat.id);
    const text = msg.text.trim();

    if (text === "/start") {
      if (redis && !(await redis.get(`credits:${chat}`)) && chat !== ADMIN) {
        await redis.set(`credits:${chat}`, 40);
      }
      await sendMessage(chat, "🚀 PIXELMETA AI\nUse /gen <prompt>\n/credits");
      return;
    }

    if (text === "/credits") {
      await sendMessage(chat, `💳 Credits: ${await getCredits(chat)}`);
      return;
    }

    if (text.startsWith("/gen ")) {
      const prompt = text.slice(5).trim();
      if (!prompt) {
        await sendMessage(chat, "Usage: /gen <prompt>");
        return;
      }

      if (!(await useCredits(chat, 2))) {
        await sendMessage(chat, "❌ Not enough credits");
        return;
      }

      await sendMessage(chat, "🎨 Generating image...");

      try {
        const imgUrl = await generate(prompt);
        await sendPhoto(chat, imgUrl, "✅ Done");
      } catch (err) {
        // refund if generation failed
        await addCredits(chat, 2);

        console.error("Generation failed:", err?.message || err);
        await sendMessage(chat, "⚠️ Generation failed. Try again.");

        // Optional: notify admin with exact error
        if (chat !== ADMIN) {
          await sendMessage(
            ADMIN,
            `⚠️ Gen failed\nUser: ${chat}\nPrompt: ${prompt}\nError: ${err?.message || err}`
          );
        }
      }
    }
  } catch (err) {
    console.error("Webhook handler error:", err?.message || err);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("🚀 PIXELMETA HYBRID ENGINE LIVE"));
