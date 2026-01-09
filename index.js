const express = require("express");
const fetch = require("node-fetch");
const Redis = require("ioredis");

const app = express();
app.use(express.json());

const TG = process.env.TG_TOKEN;
const FAL = process.env.FAL_API_KEY;
const REPLICATE = process.env.REPLICATE_API_TOKEN;
const REDIS = process.env.REDIS_URL;
const ADMIN = "1078816855";

const redis = new Redis(REDIS);

// ===================
// Telegram send
// ===================
async function send(chat, text) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text })
  });
}

// ===================
// Replicate (PRIMARY)
// ===================
async function replicateGenerate(prompt) {
  const start = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${REPLICATE}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      version: "stability-ai/sdxl",
      input: { prompt }
    })
  });

  const job = await start.json();
  if (!job.id) throw new Error("Replicate start failed");

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));

    const r = await fetch(`https://api.replicate.com/v1/predictions/${job.id}`, {
      headers: { Authorization: `Token ${REPLICATE}` }
    });
    const s = await r.json();

    if (s.status === "succeeded") return s.output[0];
    if (s.status === "failed") throw new Error("Replicate failed");
  }

  throw new Error("Replicate timeout");
}

// ===================
// FAL (BACKUP)
// ===================
async function falGenerate(prompt) {
  const r = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt, image_size: "1024x1024" })
  });

  const j = await r.json();
  if (!j.images?.length) throw new Error("FAL failed");
  return j.images[0].url;
}

// ===================
// Smart Generator
// ===================
async function generate(prompt) {
  try {
    return await replicateGenerate(prompt);
  } catch {
    return await falGenerate(prompt);
  }
}

// ===================
// Credits
// ===================
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

// ===================
// Telegram Webhook
// ===================
app.post("/", async (req, res) => {
  res.sendStatus(200); // VERY IMPORTANT

  const msg = req.body.message;
  if (!msg || !msg.text) return;

  const chat = msg.chat.id.toString();
  const text = msg.text.trim();

  if (text === "/start") {
    if (!(await redis.get(`credits:${chat}`)) && chat !== ADMIN) {
      await redis.set(`credits:${chat}`, 40);
    }
    await send(chat, "🚀 PIXELMETA AI\nUse /gen <prompt>");
    return;
  }

  if (text === "/credits") {
    await send(chat, `💳 Credits: ${await getCredits(chat)}`);
    return;
  }

  if (text.startsWith("/gen ")) {
    const prompt = text.slice(5).trim();
    if (!prompt) return;

    if (!(await useCredits(chat, 2))) {
      await send(chat, "❌ Not enough credits");
      return;
    }

    await send(chat, "🎨 Generating your image...");

    // 🔥 Background job (no blocking)
    generate(prompt)
      .then(img => send(chat, img))
      .catch(() => send(chat, "⚠️ Generation failed. Try again."));
  }
});

// ===================
// Railway
// ===================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 PIXELMETA HYBRID ENGINE LIVE on", PORT);
});
