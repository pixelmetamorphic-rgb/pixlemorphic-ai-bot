import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";

dotenv.config();

// ================= CHECK ENV =================
if (!process.env.TG_TOKEN) {
  console.error("❌ TG_TOKEN missing");
  process.exit(1);
}

if (!process.env.REPLICATE_API_TOKEN) {
  console.error("❌ REPLICATE_API_TOKEN missing");
  process.exit(1);
}

// ================= TELEGRAM =================
const bot = new TelegramBot(process.env.TG_TOKEN, { polling: true });

// ================= EXPRESS =================
const app = express();
app.get("/", (req, res) => {
  res.send("Pixlemorphic AI is running 🚀");
});
app.listen(3000, () => console.log("🌐 HTTP server running on 3000"));

// ================= START =================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome to PIXLEMORPHIC AI\n\nSend me any prompt and I will generate a Flux powered AI image for you."
  );
});

// ================= IMAGE GENERATION =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;

  if (!prompt || prompt.startsWith("/")) return;

  bot.sendMessage(chatId, "🎨 Generating image... please wait");

  try {
    // Start prediction
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "da77bc59f6c3a7e8a6b1f6d3c2b7d8c7f9b8e5d4a3f2e1c0b9a8d7c6e5f4",
        input: {
          prompt: prompt,
          num_outputs: 1,
          guidance_scale: 7,
          num_inference_steps: 28
        }
      })
    });

    const prediction = await response.json();

    if (!prediction.id) {
      throw new Error("Prediction not created");
    }

    // Poll result
    let imageUrl = null;

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

      if (result.status === "failed") {
        throw new Error("Generation failed");
      }

      await new Promise(r => setTimeout(r, 3000));
    }

    if (!imageUrl) {
      throw new Error("Timeout");
    }

    await bot.sendPhoto(chatId, imageUrl, {
      caption: `✨ PIXLEMORPHIC AI\nPrompt: ${prompt}`
    });

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Image generation failed. Try another prompt.");
  }
});

// ================= READY =================
console.log("🤖 Pixlemorphic AI Bot Started");
