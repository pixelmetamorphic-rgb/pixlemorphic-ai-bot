import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.TG_TOKEN) throw new Error("TG_TOKEN missing");
if (!process.env.REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN missing");

const bot = new TelegramBot(process.env.TG_TOKEN, { polling: true });
const app = express();

app.get("/", (req, res) => res.send("PIXLEMORPHIC AI is running"));
app.listen(3000);

console.log("Pixlemorphic AI ready");


// ---------------- /start ----------------
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome to PIXLEMORPHIC AI\n\nSend any prompt.\nI generate professional AI images for you."
  );
});


// ---------------- IMAGE GENERATION ----------------
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;

  if (!prompt || prompt.startsWith("/")) return;

  try {
    await bot.sendMessage(chatId, "🎨 Generating image…");

    // 1️⃣ Create prediction
    const create = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "black-forest-labs/flux-schnell",
        input: {
          prompt: prompt,
          width: 1024,
          height: 1024,
          num_outputs: 1
        }
      })
    });

    const prediction = await create.json();

    if (!prediction.id) {
      console.error(prediction);
      return bot.sendMessage(chatId, "❌ Image generation failed.");
    }

    // 2️⃣ Poll until ready
    let result;
    while (true) {
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: {
          "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`
        }
      });

      result = await poll.json();

      if (result.status === "succeeded") break;
      if (result.status === "failed") {
        console.error(result);
        return bot.sendMessage(chatId, "❌ Generation failed.");
      }

      await new Promise(r => setTimeout(r, 2500));
    }

    // 3️⃣ Send image
    const imageUrl = result.output[0];
    await bot.sendPhoto(chatId, imageUrl);

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "⚠️ Server error. Try again.");
  }
});
