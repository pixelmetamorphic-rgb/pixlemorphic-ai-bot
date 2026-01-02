import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import Redis from "ioredis";

const bot = new TelegramBot(process.env.TG_TOKEN, { polling: true });
const redis = new Redis(process.env.REDIS_URL);
const FAL_KEY = process.env.FAL_KEY;

const FREE_CREDITS = 100;

const PRICES = {
  cinematic: { "2k": 5, "4k": 10 },
  realism: { "2k": 15, "4k": 30 },
  ultra: { "8k": 40 }
};

async function getUser(id) {
  let data = await redis.get(user:${id});
  if (!data) {
    const user = { credits: FREE_CREDITS };
    await redis.set(user:${id}, JSON.stringify(user));
    return user;
  }
  return JSON.parse(data);
}

async function saveUser(id, data) {
  await redis.set(user:${id}, JSON.stringify(data));
}

function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🖼 Generate Image", callback_data: "image" }],
        [{ text: "🎬 Generate Video", callback_data: "video" }],
        [{ text: "💳 My Credits", callback_data: "credits" }]
      ]
    }
  };
}

bot.onText(/\/start/, async (msg) => {
  const user = await getUser(msg.from.id);
  bot.sendMessage(
    msg.chat.id,
    🎨 *PIXLEMETA AI*\n\nYour Credits: *${user.credits}*\n\nChoose what you want to create.,
    { parse_mode: "Markdown", ...mainMenu() }
  );
});

bot.on("callback_query", async (q) => {
  const id = q.from.id;
  const chat = q.message.chat.id;
  const data = q.data;

  if (data === "image") {
    bot.sendMessage(chat, "Choose Style:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎬 Pixlemeta – Cinematic", callback_data: "cinematic" }],
          [{ text: "📸 Pixlemeta – Realism", callback_data: "realism" }],
          [{ text: "🧬 Pixlemeta – Ultra 8K", callback_data: "ultra" }]
        ]
      }
    });
  }

  if (data === "video") {
    bot.sendMessage(chat, "🎬 Video generation coming soon.\nWe are adding Veo & Kling models.");
  }

  if (data === "credits") {
    const user = await getUser(id);
    bot.sendMessage(chat, 💳 You have *${user.credits}* credits., { parse_mode: "Markdown" });
  }

  if (["cinematic", "realism"].includes(data)) {
    await redis.set(mode:${id}, data);
    bot.sendMessage(chat, "Select Quality:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "2K HD", callback_data: "2k" }],
          [{ text: "4K Ultra", callback_data: "4k" }]
        ]
      }
    });
  }

  if (data === "ultra") {
    await redis.set(mode:${id}, "ultra");
    await redis.set(quality:${id}, "8k");
    bot.sendMessage(chat, "🧬 Ultra 8K selected.\nSend your prompt.\nCost: 40 credits.");
  }

  if (["2k", "4k"].includes(data)) {
    await redis.set(quality:${id}, data);
    bot.sendMessage(chat, "Send your prompt.");
  }
});

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const id = msg.from.id;
  const chat = msg.chat.id;

  const mode = await redis.get(mode:${id});
  const quality = await redis.get(quality:${id});

  if (!mode || !quality) return;

  const user = await getUser(id);
  const cost = PRICES[mode][quality];

  if (user.credits < cost) {
    bot.sendMessage(chat, "❌ Not enough credits.");
    return;
  }

  user.credits -= cost;
  await saveUser(id, user);

  bot.sendMessage(chat, "🎨 Generating premium image...");

  try {
    const res = await fetch("https://fal.run/fal-ai/fast-sdxl", {
      method: "POST",
      headers: {
        Authorization: Key ${FAL_KEY},
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: msg.text,
        image_size: quality === "4k" ? "1024x1024" : "square"
      })
    });

    const data = await res.json();
    await bot.sendPhoto(chat, data.images[0].url, {
      caption: ✨ ${mode.toUpperCase()} ${quality.toUpperCase()}\nCredits left: ${user.credits}
    });
  } catch (e) {
    user.credits += cost;
    await saveUser(id, user);
    bot.sendMessage(chat, "❌ Generation failed. Credits refunded.");
  }
});
