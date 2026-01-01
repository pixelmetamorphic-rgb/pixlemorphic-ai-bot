import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.TG_TOKEN);

const WEBHOOK_URL = process.env.WEBHOOK_URL;

// health check
app.get("/", (req, res) => res.send("PIXLEMORPHIC AI running"));

// telegram webhook endpoint
app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// start server
app.listen(3000, async () => {
  console.log("Server running");

  await bot.setWebHook(`${WEBHOOK_URL}/webhook`);
  console.log("Webhook set");
});

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "👋 Welcome to PIXLEMORPHIC AI\n\nSend any prompt. I generate professional AI images for you."
  );
});

// message handler
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;
  if (!prompt || prompt.startsWith("/")) return;

  try {
    await bot.sendMessage(chatId, "🎨 Generating image…");

    const create = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "black-forest-labs/flux-schnell",
        input: { prompt }
      })
    });

    const prediction = await create.json();
    if (!prediction.id) throw new Error("Prediction failed");

    let result;
    while (true) {
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}` }
      });

      result = await poll.json();
      if (result.status === "succeeded") break;
      if (result.status === "failed") throw new Error("Generation failed");
      await new Promise(r => setTimeout(r, 2000));
    }

    await bot.sendPhoto(chatId, result.output[0]);

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Image generation failed.");
  }
});
