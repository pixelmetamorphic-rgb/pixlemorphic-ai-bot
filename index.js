const express = require("express");
const fetch = require("node-fetch");
const Redis = require("ioredis");

const app = express();
app.use(express.json());

const TG = process.env.TG_TOKEN;
const FAL = process.env.FAL_API_KEY;
const REDIS = process.env.REDIS_URL;
const ADMIN = "1078816855";

const redis = new Redis(REDIS);

// Health check
app.get("/", (req, res) => res.send("PIXELMETA AI LIVE 🚀"));

// Telegram send
async function send(chat, text) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text })
  });
}

/* ===== FAL MODELS (NO GPU LOCK) ===== */
async function generate(prompt) {
  // 1️⃣ Flux Schnell (fast + cinematic)
  let r = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt, image_size: "1024x1024" })
  });

  if (r.ok) {
    const j = await r.json();
    if (j.images?.length) return j.images[0].url;
  }

  // 2️⃣ Fallback → SDXL
  r = await fetch("https://fal.run/fal-ai/sdxl", {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt })
  });

  const j = await r.json();
  return j.images[0].url;
}

/* ===== Credits ===== */
async function getCredits(id) {
  if (id === ADMIN) return 999999;
  return parseInt(await redis.get(`credits:${id}`) || 0);
}

async function useCredits(id, n) {
  if (id === ADMIN) return true;
  const c = await getCredits(id);
  if (c < n) return false;
  await redis.decrby(`credits:${id}`, n);
  return true;
}

/* ===== Telegram Webhook ===== */
app.post("/", async (req, res) => {
  res.sendStatus(200);

  const msg = req.body.message;
  if (!msg || !msg.text) return;

  const chat = msg.chat.id.toString();
  const text = msg.text.trim();

  if (text === "/start") {
    if (!(await redis.get(`credits:${chat}`)) && chat !== ADMIN) {
      await redis.set(`credits:${chat}`, 40);
    }
    await send(chat, "🚀 Welcome to PIXELMETA AI\nUse /gen <prompt>");
    return;
  }

  if (text === "/credits") {
    await send(chat, `💳 Credits: ${await getCredits(chat)}`);
    return;
  }

  if (text.startsWith("/gen ")) {
    const prompt = text.slice(5).trim();

    if (!(await useCredits(chat, 2))) {
      await send(chat, "❌ Not enough credits");
      return;
    }

    await send(chat, "🎨 Generating image...");

    try {
      const img = await generate(prompt);
      await send(chat, img);
    } catch {
      await send(chat, "⚠️ Image engine error. Try again.");
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("PIXELMETA LIVE on", PORT));
