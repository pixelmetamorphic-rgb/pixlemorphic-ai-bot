import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";

const TG_TOKEN = process.env.TG_TOKEN;
const FAL_KEY = process.env.FAL_KEY;

if (!TG_TOKEN) {
  console.error("EFATAL: Telegram Bot Token not provided");
  process.exit(1);
}

const bot = new TelegramBot(TG_TOKEN, { polling: true });

console.log("Pixlemorphic AI Bot started");

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "👋 Welcome to PIXLEMORPHIC AI\n\nSend any text to generate an image.");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;

  if (!prompt || prompt.startsWith("/")) return;

  try {
    await bot.sendMessage(chatId, "🎨 Generating image...");

    const response = await fetch("https://fal.run/fal-ai/fast-sdxl", {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: prompt,
        image_size: "square"
      })
    });

    const result = await response.json();

    if (!result.images || !result.images[0]) {
      throw new Error("No image returned");
    }

    const image = result.images[0].url;

    await bot.sendPhoto(chatId, image, {
      caption: "✨ Powered by PIXLEMORPHIC AI"
    });

  } catch (e) {
    console.error(e);
    await bot.sendMessage(chatId, "❌ Image failed. Try again.");
  }
});
