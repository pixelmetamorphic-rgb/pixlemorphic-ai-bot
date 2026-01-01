import TelegramBot from "node-telegram-bot-api";
import express from "express";
import fetch from "node-fetch";

const TG_TOKEN = process.env.TG_TOKEN;
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

const bot = new TelegramBot(TG_TOKEN, { polling: true });
const app = express();

let isBusy = false;
let lastRun = 0;

// Railway keep alive
app.get("/", (req, res) => res.send("PIXLEMORPHIC AI running"));
app.listen(process.env.PORT || 3000);

console.log("PIXLEMORPHIC AI READY");

// Telegram
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;

  if (!prompt || prompt.startsWith("/")) return;

  const now = Date.now();
  if (isBusy || now - lastRun < 12000) {
    return bot.sendMessage(chatId, "⏳ Please wait 10 seconds...");
  }

  isBusy = true;
  lastRun = now;

  try {
    await bot.sendMessage(chatId, "🎨 Generating image...");

    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${REPLICATE_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "black-forest-labs/flux-1-dev",
        input: {
          prompt: prompt,
          steps: 30,
          guidance: 7,
          width: 1024,
          height: 1024
        }
      })
    });

    const prediction = await res.json();

    if (!prediction.urls?.get) {
      throw new Error("Prediction failed");
    }

    // Poll until done
    let output = null;
    while (!output) {
      await new Promise(r => setTimeout(r, 2500));
      const check = await fetch(prediction.urls.get, {
        headers: { "Authorization": `Token ${REPLICATE_TOKEN}` }
      });
      const data = await check.json();
      if (data.status === "succeeded") output = data.output[0];
      if (data.status === "failed") throw new Error("Generation failed");
    }

    await bot.sendPhoto(chatId, output);

  } catch (e) {
    console.log(e);
    await bot.sendMessage(chatId, "❌ AI busy. Try again in 10 seconds.");
  }

  setTimeout(() => {
    isBusy = false;
  }, 12000);
});
