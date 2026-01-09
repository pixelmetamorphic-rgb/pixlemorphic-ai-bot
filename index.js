const express = require("express");
const fetch = require("node-fetch");
const Redis = require("ioredis");

const app = express();
app.use(express.json());

const TG = process.env.TG_TOKEN;
const REPLICATE = process.env.REPLICATE_API_TOKEN;
const FAL = process.env.FAL_API_KEY;
const REDIS = process.env.REDIS_URL;
const ADMIN = "1078816855";

const redis = new Redis(REDIS);

// Telegram send
async function send(chat, text) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text })
  });
}

// ================= REPLICATE (SDXL) =================
async function replicateGenerate(prompt) {
  const r = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${REPLICATE}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      version: "39ed52f2a78e934b3ba6f1f50c7b07c7a1c77d9b29b19a70c2b6c38b1f86c7c5", // SDXL
      input: { prompt }
    })
  });

  const j = await r.json();
  if (!j.id) throw new Error("replicate-start-failed");

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));

    const p = await fetch(`https://api.replicate.com/v1/predictions/${j.id}`, {
      headers: { Authorization: `Token ${REPLICATE}` }
    });
    const s = await p.json();

    if (s.status === "succeeded") return s.output[0];
    if (s.status === "failed") throw new Error("replicate-failed");
  }

  throw new Error("replicate-timeout");
}

// ================= FAL FLUX (BACKUP) =================
async function falGenerate(prompt) {
  const submit = await fetch("https://fal.run/fal-ai/flux/schnell/submit", {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt })
  });

  const job = await submit.json();
  if (!job.request_id) throw new Error("fal-submit-failed");

  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 2000));

    const r = await fetch(`https://fal.run/fal-ai/flux/schnell/result/${job.request_id}`, {
      headers: { Authorization: `Key ${FAL}` }
    });
    const j = await r.json();

    if (j.status === "completed") return j.images[0].url;
    if (j.status === "failed") throw new Error("fal-failed");
  }

  throw new Error("fal-timeout");
}

// ================= SMART ENGINE =================
async function generate(prompt) {
  try {
    return await replicateGenerate(prompt);
  } catch {
    return await falGenerate(prompt);
  }
}

// ================= CREDITS =================
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

// ================= TELEGRAM =================
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
    await send(chat, "🚀 PIXELMETA AI\nUse /gen <prompt>");
    return;
  }

  if (text === "/credits") {
    await send(chat, `💳 Credits: ${await getCredits(chat)}`);
    return;
  }

  if (text.startsWith("/gen ")) {
    const prompt = text.slice(5);

    if (!(await useCredits(chat, 2))) {
      await send(chat, "❌ Not enough credits");
      return;
    }

    await send(chat, "🎨 Generating image...");

    try {
      const img = await generate(prompt);
      await send(chat, img);
    } catch {
      await send(chat, "⚠️ Generation failed. Try again.");
    }
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log("🚀 PIXELMETA HYBRID ENGINE LIVE");
});
