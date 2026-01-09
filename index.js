const express = require("express");
const fetch = require("node-fetch");
const Redis = require("ioredis");

const app = express();
app.use(express.json());

// ===== ENV =====
const TG = process.env.TG_TOKEN;
const FAL = process.env.FAL_API_KEY;
const REDIS = process.env.REDIS_URL;
const ADMIN = "1078816855";

const redis = new Redis(REDIS);

// ===== KEEP RAILWAY ALIVE =====
app.get("/", (req, res) => {
  res.send("PIXELMETA AI is running 🚀");
});

// ===== TELEGRAM SEND =====
async function send(chat, text) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text })
  });
}

// ===== FAL QUEUE: CREATE JOB =====
async function createJob(prompt) {
  const r = await fetch("https://fal.run/fal-ai/flux/dev/queue", {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      image_size: "1024x1024"
    })
  });

  const j = await r.json();
  if (!j.request_id) throw new Error("No job id");
  return j.request_id;
}

// ===== FAL QUEUE: CHECK JOB =====
async function getJob(id) {
  const r = await fetch(`https://fal.run/fal-ai/flux/dev/requests/${id}`, {
    headers: { Authorization: `Key ${FAL}` }
  });
  return await r.json();
}

// ===== WAIT FOR IMAGE =====
async function waitForImage(jobId) {
  for (let i = 0; i < 40; i++) {
    const res = await getJob(jobId);

    if (res.status === "COMPLETED" && res.images?.length) {
      return res.images[0].url;
    }

    if (res.status === "FAILED") {
      throw new Error("Flux failed");
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  throw new Error("Flux timeout");
}

// ===== CREDITS =====
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

// ===== TELEGRAM WEBHOOK =====
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
    if (!prompt) return;

    if (!(await useCredits(chat, 2))) {
      await send(chat, "❌ Not enough credits");
      return;
    }

    await send(chat, "🧠 Flux is rendering your image...");

    try {
      const job = await createJob(prompt);
      const img = await waitForImage(job);
      await send(chat, img);
    } catch {
      await send(chat, "⚠️ Flux queue is busy. Try again in 30 seconds.");
    }
  }
});

// ===== RAILWAY PORT =====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 PIXELMETA QUEUE ENGINE LIVE on", PORT);
});
