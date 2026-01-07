import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import Redis from "ioredis";

// -------------------- ENV --------------------
const BOT_TOKEN = process.env.TG_TOKEN;
const FAL_KEY = process.env.FAL_KEY;
const REDIS_URL = process.env.REDIS_URL;
const ADMIN_ID = 1078816855; // your Telegram ID

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const redis = new Redis(REDIS_URL);

// ------------------ CONFIG -------------------
const PLANS = {
  trial: 40,
  promo: 100,
  pro: 1200,
  premium: 2000
};

const MODELS = {
  cinematic2k: { credits: 2, size: "1024x1024" },
  cinematic4k: { credits: 4, size: "2048x2048" },
  realism2k: { credits: 4, size: "1024x1024" },
  realism4k: { credits: 10, size: "2048x2048" },
  ultra8k: { credits: 10, size: "4096x4096" },
  edit: { credits: 80, size: "2048x2048" },
  shark: { credits: 140, size: "4096x4096" }
};

// Flux Pro = safest fal model
const FAL_MODEL = "fal-ai/flux-pro";

// ------------------- UTILS -------------------
async function getUser(id) {
  let data = await redis.get(`user:${id}`);
  if (!data) {
    const user = { credits: PLANS.trial, plan: "trial", expiry: null };
    await redis.set(`user:${id}`, JSON.stringify(user));
    return user;
  }
  return JSON.parse(data);
}

async function saveUser(id, user) {
  await redis.set(`user:${id}`, JSON.stringify(user));
}

// ----------------- FAL CALL ------------------
async function falGenerate(prompt, size) {
  const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${FAL_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      image_size: size,
      num_images: 1,
      enable_safety_checker: true
    })
  });

  const data = await res.json();

  if (!data.images || !data.images.length) {
    throw new Error("No image returned by Fal");
  }

  return data.images[0].url;
}

// ------------------ COMMANDS -----------------
bot.onText(/\/start/, async (msg) => {
  const user = await getUser(msg.chat.id);
  bot.sendMessage(msg.chat.id,
`🦈 *PIXLEMETA AI*

Plan: *${user.plan.toUpperCase()}*
Credits: *${user.credits}*

/gen – Generate Image
/credits – Balance
/planvalidity – Expiry`,
{ parse_mode: "Markdown" });
});

bot.onText(/\/credits/, async (msg) => {
  const user = await getUser(msg.chat.id);
  bot.sendMessage(msg.chat.id, `💳 Credits: ${user.credits}`);
});

bot.onText(/\/planvalidity/, async (msg) => {
  const user = await getUser(msg.chat.id);
  bot.sendMessage(msg.chat.id, `📅 Plan: ${user.plan}\nExpiry: ${user.expiry || "Not set"}`);
});

// ------------------ ADMIN --------------------
bot.onText(/\/setcredits (\d+) (\d+)/, async (msg, match) => {
  if (msg.chat.id !== ADMIN_ID) return;
  const uid = match[1];
  const amount = Number(match[2]);
  const user = await getUser(uid);
  user.credits = amount;
  await saveUser(uid, user);
  bot.sendMessage(msg.chat.id, "Credits updated");
});

// ---------------- GENERATION ----------------
bot.onText(/\/gen/, async (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId,
`Choose:
1 Cinematic 2K
2 Cinematic 4K
3 Realism 2K
4 Realism 4K
5 Ultra 8K
6 EDIT
7 🦈 SHARK`);

  bot.once("message", async (m) => {
    const choice = m.text;
    let mode;

    if (choice === "1") mode = "cinematic2k";
    else if (choice === "2") mode = "cinematic4k";
    else if (choice === "3") mode = "realism2k";
    else if (choice === "4") mode = "realism4k";
    else if (choice === "5") mode = "ultra8k";
    else if (choice === "6") mode = "edit";
    else if (choice === "7") mode = "shark";
    else return bot.sendMessage(chatId, "Invalid option");

    bot.sendMessage(chatId, "Send your prompt:");

    bot.once("message", async (pmsg) => {
      const prompt = pmsg.text;
      const user = await getUser(chatId);

      if (user.credits < MODELS[mode].credits)
        return bot.sendMessage(chatId, "❌ Not enough credits");

      bot.sendMessage(chatId, "🦈 Processing… please wait 20–40 sec");

      try {
        const image = await falGenerate(prompt, MODELS[mode].size);
        user.credits -= MODELS[mode].credits;
        await saveUser(chatId, user);

        await bot.sendPhoto(chatId, image, {
          caption: `✨ Pixlemeta ${mode.toUpperCase()}`
        });
      } catch (e) {
        console.error(e);
        bot.sendMessage(chatId, "⚠️ Generation failed, try again. Credits not deducted.");
      }
    });
  });
});

console.log("PIXLEMETA READY 🦈");
