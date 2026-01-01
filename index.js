import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

if (!process.env.TG_TOKEN) throw new Error("TG_TOKEN missing");
if (!process.env.REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN missing");

const bot = new TelegramBot(process.env.TG_TOKEN, {
  polling: true
});

const app = express();
app.get("/", (req, res) => res.send("Pixlemorphic AI running"));
app.listen(process.env.PORT || 3000);

console.log("Pixlemorphic AI ready");

// ========== /start ==========
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome to PIXLEMORPHIC AI\n\nSend any prompt.\nI generate professional AI images for you."
  );
});

// ========== IMAGE GENERATION ==========
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;

  if (!prompt || prompt.startsWith("/")) return;

  await bot.sendMessage(chatId, "🎨 Generating image...");

  try {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "db21e45b93b2d02f8ec13f2e05bcb4cbf77b3f7fef1d813f8dfd2d1f8c6f0c4b", // SDXL
        input: {
          prompt: prompt,
          width: 1024,
          height: 1024,
          num_outputs: 1
        }
      })
    });

    const data = await response.json();
    if (!data?.urls?.get) throw new Error("Prediction not created");

    // Poll Replicate
    let result;
    while (true) {
      const poll = await fetch(data.urls.get, {
        headers: {
          "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`
        }
      });
      result = await poll.json();
      if (result.status === "succeeded") break;
      if (result.status === "failed") throw new Error("Generation failed");
      await new Promise(r => setTimeout(r, 2000));
    }

    const image = result.output[0];
    await bot.sendPhoto(chatId, image);

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Image generation failed. Try again.");
  }
});
