import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import Redis from "ioredis";

const TOKEN = process.env.TG_TOKEN;
const PORT = process.env.PORT || 3000;
const FAL_KEY = process.env.FAL_API_KEY;
const REDIS_URL = process.env.REDIS_URL;

const redis = new Redis(REDIS_URL);

const app = express();
app.use(express.json());

const bot = new TelegramBot(TOKEN);
bot.setWebHook(`${process.env.RAILWAY_PUBLIC_URL}/webhook`);

console.log("🚀 PIXELMETA WEBHOOK LIVE");

// ---- CREDIT HELPERS ----
async function getCredits(id) {
  return parseInt((await redis.get(`credit:${id}`)) || "0");
}

async function setCredits(id, value) {
  await redis.set(`credit:${id}`, value);
}

// ---- ADMIN ----
const ADMIN_ID = "1078816855"; // YOU

// ---- WEBHOOK HANDLER ----
app.post("/webhook", async (req, res) => {
  try {
    const update = req.body;

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = msg.text || "";

      if (text === "/start") {
        let c = await getCredits(chatId);
        if (!c) {
          c = 40;
          await setCredits(chatId, 40);
        }
        await bot.sendMessage(chatId, `👋 Welcome to PIXELMETA AI\nCredits: ${c}\nSend any prompt to generate an image.`);
      }

      // ADMIN COMMAND
      if (text.startsWith("/setcredit") && chatId == ADMIN_ID) {
        const [_, uid, amt] = text.split(" ");
        await setCredits(uid, amt);
        return bot.sendMessage(chatId, `✅ Credits set for ${uid} → ${amt}`);
      }

      if (!text.startsWith("/")) {
        const credits = await getCredits(chatId);
        if (credits < 2) {
          return bot.sendMessage(chatId, "❌ Insufficient credits. Recharge needed.");
        }

        await bot.sendMessage(chatId, "⏳ Generating image...");

        const img = await generateImage(text);

        if (img) {
          await bot.sendPhoto(chatId, img);
          await setCredits(chatId, credits - 2);
        } else {
          await bot.sendMessage(chatId, "⚠️ Server busy, please try again.");
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ---- FAL + FALLBACK ----
async function generateImage(prompt) {
  try {
    const r = await fetch("https://fal.run/fal-ai/flux-pro", {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt })
    });

    const data = await r.json();
    return data.images[0].url;
  } catch (e) {
    console.log("FAL FAILED → fallback");
    return null;
  }
}

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
