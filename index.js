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
  res.send("PIXELMETA GPU Engine running 🚀");
});

// ===== TELEGRAM SEND =====
async function send(chat, text) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text })
  });
}

/* ==========================================
   🔥 FAL REAL GPU + QUEUE (NO FAKE ENDPOINTS)
========================================== */

// This endpoint automatically uses:
// • Paid GPU if balance > 0
// • Shared GPU if free
const FAL_GPU = "https://fal.run/fal-ai/flux/dev";

// Shared queue fallback
const FAL_QUEUE = "https://fal.run/fal-ai/flux/dev/queue";

// ---- Try GPU (Paid auto-detected by Fal) ----
async function tryGPU(prompt) {
  const r = await fetch(FAL_GPU, {
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

  if (!r.ok) throw new Error("GPU busy");

  const j = await r.json();
  if (!j.images || !j.images[0]) throw new Error("No image");

  return j.images[0].url;
}

// ---- Queue create ----
async function createQueueJob(prompt) {
  const r = await fetch(FAL_QUEUE, {
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
  if (!j.request_id) throw new Error("Queue full");
  return j.request_id;
}

// ---- Queue status ----
async function getQueueJob(id) {
  const r = await fetch(
    `https://fal.run/fal-ai/flux/dev/requests/${id}`,
    { headers: { Authorization: `Key ${FAL}` } }
  );
  return await r.json();
}

// ---- Wait queue ----
async function waitQueue(jobId) {
  for (let i = 0; i < 40; i++) {
    const j = await getQueueJob(jobId);

    if (j.status === "COMPLETED" && j.images?.length) {
      return j.images[0].url;
    }

    if (j.status === "FAILED") throw new Error("Queue failed");

    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("Queue timeout");
}

// ---- Smart generator ----
async function generateImage(prompt) {
  try {
    return await tryGPU(prompt);   // Uses your $30 GPU automatically
  } catch {
    const job = await createQueueJob(prompt);
    return await waitQueue(job);
  }
}

/* ===============================
   💳 CREDIT SYSTEM
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
   🤖 TELEGRAM WEBHOOK
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
      await send(chat, "⚠️ All GPUs busy. Try again in 30 sec.");
    }
  }
});

// ===== RAILWAY =====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 PIXELMETA GPU ENGINE LIVE on", PORT);
});
