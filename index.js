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

// ===== HEALTH CHECK =====
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

/* ===============================
   FAL PAID GPU + QUEUE SYSTEM
================================ */

// Primary (PAID GPU)
const FAL_PRO = "https://fal.run/fal-ai/flux-pro";

// Fallback (shared queue)
const FAL_QUEUE = "https://fal.run/fal-ai/flux/dev/queue";

// ---- Try PRO GPU first ----
async function tryPro(prompt) {
  const r = await fetch(FAL_PRO, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt, image_size: "1024x1024" })
  });

  if (!r.ok) throw new Error("Pro busy");

  const j = await r.json();
  return j.images?.[0]?.url;
}

// ---- Create QUEUE job ----
async function createQueueJob(prompt) {
  const r = await fetch(FAL_QUEUE, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt, image_size: "1024x1024" })
  });

  const j = await r.json();
  if (!j.request_id) throw new Error("No job id");
  return j.request_id;
}

// ---- Poll QUEUE job ----
async function getQueueJob(id) {
  const r = await fetch(
    `https://fal.run/fal-ai/flux/dev/requests/${id}`,
    { headers: { Authorization: `Key ${FAL}` } }
  );
  return await r.json();
}

// ---- Wait QUEUE ----
async function waitForQueue(jobId) {
  for (let i = 0; i < 40; i++) {
    const r = await getQueueJob(jobId);

    if (r.status === "COMPLETED" && r.images?.length) {
      return r.images[0].url;
    }
    if (r.status === "FAILED") throw new Error("Failed");

    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("Timeout");
}

// ---- Smart Generator ----
async function generateImage(prompt) {
  try {
    return await tryPro(prompt);     // Paid GPU
  } catch {
    const job = await createQueueJob(prompt);  // Fallback queue
    return await waitForQueue(job);
  }
}

/* ===============================
   CREDITS
================================ */
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

/* ===============================
   TELEGRAM WEBHOOK
================================ */
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

    await send(chat, "🧠 Generating on GPU...");

    try {
      const img = await generateImage(prompt);
      await send(chat, img);
    } catch {
      await send(chat, "⚠️ All Flux servers busy. Try again in 30 sec.");
    }
  }
});

// ===== RAILWAY =====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 PIXELMETA GPU ENGINE LIVE on", PORT);
});
