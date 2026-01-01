import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.TG_TOKEN) throw new Error("TG_TOKEN missing");
if (!process.env.REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN missing");

const bot = new TelegramBot(process.env.TG_TOKEN, { polling: true });
const app = express();

app.get("/", (req, res) => res.send("Pixlemorphic AI running"));
app.listen(process.env.PORT || 3000);

console.log("Pixlemorphic AI ready");

// Start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome to PIXLEMORPHIC AI\n\nSend any prompt and I will generate a Flux-powered AI image for you."
  );
});

// Message
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;

  if (!prompt || prompt.startsWith("/")) return;

  await bot.sendMessage(chatId, "🎨 Generating image...");

  try {
    // 🔥 Create prediction (NEW API)
    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "db21e45c-7f68-4b28-9f6d-7f6b8bb6b45f", // FLUX Schnell
        input: {
          prompt: prompt,
          width: 1024,
          height: 1024,
          num_outputs: 1,
        },
      }),
    });

    const prediction = await createRes.json();

    if (!prediction.id) {
      console.error(prediction);
      throw new Error("Prediction not created");
    }

    // 🔁 Poll
    let status = prediction.status;
    let result = prediction;

    while (status !== "succeeded" && status !== "failed") {
      await new Promise((r) => setTimeout(r, 3000));
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        },
      });
      result = await poll.json();
      status = result.status;
    }

    if (status === "failed") throw new Error("Generation failed");

    const imageUrl = result.output[0];

    await bot.sendPhoto(chatId, imageUrl, { caption: "Here is your image ✨" });
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, "❌ Image generation failed. Try again.");
  }
});
