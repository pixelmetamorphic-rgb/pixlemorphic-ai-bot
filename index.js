import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";

dotenv.config();

if (!process.env.TG_TOKEN) throw new Error("TG_TOKEN missing");
if (!process.env.REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN missing");

const bot = new TelegramBot(process.env.TG_TOKEN, { polling: true });
const app = express();

app.get("/", (req, res) => res.send("Pixlemorphic AI running"));
app.listen(3000);

// ================= START =================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 
`👋 Welcome to PIXLEMORPHIC AI

Send any prompt.
I generate professional AI images for you.`);
});

// ================= GENERATION =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;

  if (!prompt || prompt.startsWith("/")) return;

  await bot.sendMessage(chatId, "🎨 Generating image...");

  try {
    // Create prediction
    const create = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "stability-ai/sdxl",
        input: {
          prompt,
          width: 1024,
          height: 1024,
          num_outputs: 1,
          guidance_scale: 7.5,
          num_inference_steps: 30
        }
      })
    });

    const prediction = await create.json();
    if (!prediction.id) throw new Error("Prediction not created");

    // Polling
    let image = null;

    for (let i = 0; i < 25; i++) {
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}` }
      });
      const data = await poll.json();

      if (data.status === "succeeded") {
        image = data.output[0];
        break;
      }

      if (data.status === "failed") {
        throw new Error("Generation failed");
      }

      await new Promise(r => setTimeout(r, 3000));
    }

    if (!image) throw new Error("Timeout");

    await bot.sendPhoto(chatId, image, { caption: `✨ PIXLEMORPHIC AI\n${prompt}` });

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Image generation failed. Try again.");
  }
});

console.log("Pixlemorphic AI ready");
