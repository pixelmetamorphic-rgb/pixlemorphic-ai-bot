import express from "express";
import fetch from "node-fetch";
import Redis from "ioredis";

const app = express();
app.use(express.json());

// ===== ENV =====
const TG = process.env.TG_TOKEN;
const FAL = process.env.FAL_API_KEY;
const REDIS = process.env.REDIS_URL;
const ADMIN = "1078816855"; // YOUR TELEGRAM ID

const redis = new Redis(REDIS);

// ===== TELEGRAM SEND =====
async function send(chat, text) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text })
  });
}

// ===== IMAGE GENERATOR (FAL) =====
async function generate(prompt) {
  const r = await fetch("https://fal.run/fal-ai/flux/dev", {
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
  return j.images[0].url;
}

// ===== CREDIT =====
async function getCredits(id) {
  if (id === ADMIN) return 999999;
  const c = await redis.get(`credits:${id}`);
  return parseInt(c || 0);
}

async function useCredits(id, n) {
  if (id === ADMIN) return true;
  const c = await getCredits(id);
  if (c < n) return false;
  await redis.decrby(`credits:${id}`, n);
  return true;
}

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  res.sendStatus(200);

  const msg = req.body.message;
  if (!msg) return;

  const chat = msg.chat.id.toString();
  const text = msg.text || "";

  // /start
  if (text === "/start") {
    if (!(await redis.get(`credits:${chat}`)) && chat !== ADMIN) {
      await redis.set(`credits:${chat}`, 40);
    }
    await send(chat, "Welcome to PIXELMETA AI\nUse /gen <prompt> to create images.");
    return;
  }

  // /credits
  if (text === "/credits") {
    const c = await getCredits(chat);
    await send(chat, `Credits: ${c}`);
    return;
  }

  // /planvalidity
  if (text === "/planvalidity") {
    await send(chat, "Trial & paid plans: 30 days from activation");
    return;
  }

  // /gen
  if (text.startsWith("/gen ")) {
    const prompt = text.replace("/gen ", "");

    if (!(await useCredits(chat, 2))) {
      await send(chat, "❌ Insufficient credits");
      return;
    }

    await send(chat, "⏳ Generating...");
    try {
      const img = await generate(prompt);
      await send(chat, img);
    } catch {
      await send(chat, "⚠️ Server busy, try again");
    }
  }
});

// ===== RAILWAY PORT FIX =====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("PIXELMETA WEBHOOK LIVE on", PORT);
});
