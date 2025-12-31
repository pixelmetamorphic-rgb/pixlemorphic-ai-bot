import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";

dotenv.config();

// ===== ENV CHECK =====
if (!process.env.TG_TOKEN) {
  console.error("❌ TG_TOKEN missing");
  process.exit(1);
}

if (!process.env.REPLICATE_API_TOKEN) {
  console.error("❌ REPLICATE_API_TOKEN missing");
  process.exit(1);
}

// ===== TELEGRAM =====
const bot = new TelegramBot(process.env.TG_TOKEN, { polling: true });

// ===== EXPRESS (For Railway keepalive) =====
const app = express();
app.get("/", (req, res) => {
  res.send("Pixlemorphic AI Bot is running 🚀");
});
app.listen(3000, () => {
  console.log("🌐 HTTP server running on port 3000");
});

// ===== /start =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome to PIXLEMORPHIC AI\n\nSend me a prompt like:\n`a cyberpunk girl in rain`\n\nI will generate AI images for you."
  );
});

// ===== HANDLE PROMPTS =====
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  bot.sendMessage(chatId, "🎨 Generating image... please wait");

  try {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "db21e45d3f7023c3f8ed38b1b3c2de142c8a3c6f2a7f5e87c7b5a4e2a9c6f4c7",
        input: {
          prompt: text
        }
      })
    });

    const prediction = await response.json();

    let imageUrl = null;

    // wait for image
    for (let i = 0; i < 20; i++) {
      const check = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`
          }
        }
      );
      const result = await check.json();
      if (result.status === "succeeded") {
        imageUrl = result.output[0];
        break;
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!imageUrl) {
      bot.sendMessage(chatId, "❌ Image generation failed. Try again.");
      return;
    }

    await bot.sendPhoto(chatId, imageUrl, {
      caption: `✨ PIXLEMORPHIC AI\nPrompt: ${text}`
    });

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "⚠️ Server error. Please try again.");
  }
});

// ===== BOT READY =====
console.log("🤖 Pixlemorphic AI Bot Started");
