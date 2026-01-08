import express from "express";
import fetch from "node-fetch";
import Redis from "ioredis";

const app = express();
app.use(express.json());

// ===== ENV =====
const TG = process.env.TG_TOKEN;
const FAL = process.env.FAL_API_KEY;
const REDIS = process.env.REDIS_URL;
const ADMIN = "1078816855";

const redis = new Redis(REDIS);

// ===== TELEGRAM SEND =====
async function send(chat, text) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text })
  });
}

// ===== IMAGE (FAL) =====
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

// ===== CREDITS =====
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

  const update = req.body;
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;

  const chat = msg.chat.id.toString();
  const text = msg.text.trim();

  console.log("TG:", chat, text);

  // /start
  if (text === "/start") {
    if (!(await redis.get(`credits:${chat}`)) && chat !== ADMIN) {
      await redis.set(`credits:${chat}`, 40);
    }
    await send(chat, "🚀 Welcome to PIXELMETA AI\n\nUse:\n/gen <prompt>\n/credits");
    return;
  }

  // /credits
  if (text === "/credits") {
    const c = await getCredits(chat);
    await send(chat, `💳 Credits: ${c}`);
    return;
  }

  // /planvalidity
  if (text === "/planvalidity") {
    await send(chat, "⏳ Validity: 30 days from activation");
    return;
  }

  // /gen
  if (text.startsWith("/gen ")) {
    const prompt = text.replace("/gen ", "").trim();

    if (!(await useCredits(chat, 2))) {
      await send(chat, "❌ Not enough credits");
      return;
    }

    await send(chat, "⏳ Generating image...");
    try {
      const img = await generate(prompt);
      await send(chat, img);
    } catch (e) {
      console.error(e);
      await send(chat, "⚠️ FAL error, try again");
    }
  }
});

// ===== RAILWAY =====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 PIXELMETA WEBHOOK LIVE on", PORT);
});
