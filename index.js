import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import Redis from "ioredis";

// ENV
const BOT_TOKEN = process.env.TG_TOKEN;
const FAL_KEY = process.env.FAL_KEY;
const REDIS_URL = process.env.REDIS_URL;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const redis = new Redis(REDIS_URL);

// ------------------- CONFIG --------------------
const FREE_TRIAL = 100;

const MODELS = {
  cinematic: { credits: 5, fal: "fal-ai/fast-sdxl" },
  realism: { credits: 15, fal: "fal-ai/realistic-vision" },
  ultra8k: { credits: 40, fal: "fal-ai/pro-ultra" }
};
// -----------------------------------------------


// Create user if not exists
async function getUser(id) {
  let data = await redis.get(`user:${id}`);
  if (!data) {
    const user = { credits: FREE_TRIAL };
    await redis.set(`user:${id}`, JSON.stringify(user));
    return user;
  }
  return JSON.parse(data);
}

// Update credits
async function setCredits(id, amount) {
  const user = await getUser(id);
  user.credits = amount;
  await redis.set(`user:${id}`, JSON.stringify(user));
}

// ---------------- START -----------------
bot.onText(/\/start/, async (msg) => {
  const id = msg.chat.id;
  const user = await getUser(id);

  bot.sendMessage(id,
`🎨 *PIXLEMETA AI*

Welcome!  
You have *${user.credits} credits*.

Choose:
🖼 Generate Image  
🎬 Generate Video (Coming Soon)  
💳 My Credits`,
{ parse_mode: "Markdown" });
});

// ---------------- CREDITS ----------------
bot.onText(/\/credits/, async (msg) => {
  const user = await getUser(msg.chat.id);
  bot.sendMessage(msg.chat.id, `💳 Your Credits: ${user.credits}`);
});

// ---------------- VIDEO -----------------
bot.onText(/\/video/, (msg) => {
  bot.sendMessage(msg.chat.id, "🎬 Video generation is coming soon 🚀");
});

// ---------------- IMAGE -----------------
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;

  if (!prompt || prompt.startsWith("/")) return;

  await bot.sendMessage(chatId,
`Choose Image Mode:
1️⃣ Cinematic (5 credits)  
2️⃣ Realism (15 credits)  
3️⃣ Ultra 8K (40 credits)

Reply with: 1, 2 or 3`);
  
  bot.once("message", async (modeMsg) => {
    const choice = modeMsg.text;
    let mode;

    if (choice === "1") mode = "cinematic";
    else if (choice === "2") mode = "realism";
    else if (choice === "3") mode = "ultra8k";
    else {
      bot.sendMessage(chatId, "❌ Invalid choice");
      return;
    }

    const user = await getUser(chatId);

    if (user.credits < MODELS[mode].credits) {
      bot.sendMessage(chatId, "❌ Not enough credits");
      return;
    }

    await bot.sendMessage(chatId, "🎨 Generating image...");

    try {
      const response = await fetch(`https://fal.run/${MODELS[mode].fal}`, {
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

      const data = await response.json();
      const image = data.images[0].url;

      await setCredits(chatId, user.credits - MODELS[mode].credits);

      await bot.sendPhoto(chatId, image, {
        caption: `✨ Pixlemeta ${mode.toUpperCase()}`
      });

    } catch (e) {
      console.log(e);
      bot.sendMessage(chatId, "❌ Image generation failed");
    }
  });
});

console.log("PIXLEMETA AI READY 🚀");
