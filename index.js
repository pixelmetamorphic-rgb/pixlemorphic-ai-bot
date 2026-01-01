import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const FAL_KEY = process.env.FAL_KEY;

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;

  if (prompt.startsWith("/")) return;

  await bot.sendMessage(chatId, "🎨 Generating image...");

  try {
    const res = await fetch("https://fal.run/fal-ai/fast-sdxl", {
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

    const data = await res.json();

    const image = data.images[0].url;

    await bot.sendPhoto(chatId, image, { caption: "✨ Powered by PIXLEMORPHIC AI" });

  } catch (e) {
    await bot.sendMessage(chatId, "❌ Image failed. Try again.");
  }
});

console.log("Pixlemorphic AI running on fal.ai");
