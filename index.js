import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const bot = new TelegramBot(process.env.TG_TOKEN, { polling: true });
const app = express();

app.get("/", (req, res) => res.send("Pixlemorphic AI running"));
app.listen(process.env.PORT || 3000);

console.log("Pixlemorphic AI ready");

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "👋 Welcome to PIXLEMORPHIC AI\n\nSend any prompt and I will generate an AI image for you."
  );
});

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
        version: "stability-ai/sdxl",
        input: {
          prompt: prompt,
          width: 1024,
          height: 1024,
          num_inference_steps: 25,
          guidance_scale: 7.5
        }
      })
    });

    const data = await response.json();

    if (!data.id) {
      await bot.sendMessage(chatId, "❌ Replicate error. Try again.");
      return;
    }

    let result;
    while (!result || result.status !== "succeeded") {
      await new Promise(r => setTimeout(r, 3000));
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, {
        headers: {
          "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`
        }
      });
      result = await poll.json();

      if (result.status === "failed") {
        await bot.sendMessage(chatId, "❌ Image generation failed.");
        return;
      }
    }

    const imageUrl = result.output[0];
    await bot.sendPhoto(chatId, imageUrl);

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, "❌ Server error.");
  }
});
