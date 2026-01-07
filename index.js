import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";

// ENV
const BOT_TOKEN = process.env.TG_TOKEN;
const FAL_KEY = process.env.FAL_KEY;
const FLUX_KEY = process.env.FLUX_KEY;
const GPT_KEY = process.env.GPT_KEY;
const REDIS_URL = process.env.REDIS_URL;
const ADMIN_ID = "1078816855";

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const redis = new Redis(REDIS_URL);

// ---------------- PLANS ----------------
const PLANS = {
  trial: 40,
  promo: 100,
  pro: 1200,
  premium: 2000,
  admin: 9999999
};

// ---------------- MODELS ----------------
const MODES = {
  "1": { name: "Cinematic 2K", credits: 2, size: "1024" },
  "2": { name: "Cinematic 4K", credits: 4, size: "2048" },
  "3": { name: "Realism 2K", credits: 4, size: "1024" },
  "4": { name: "Realism 4K", credits: 10, size: "2048" },
  "5": { name: "Ultra 8K", credits: 10, size: "4096" },
  "6": { name: "EDIT", credits: 80, size: "2048" },
  "7": { name: "SHARK 🦈", credits: 140, size: "4096" }
};

// ---------------- USERS ----------------
async function getUser(id) {
  let data = await redis.get(`user:${id}`);
  if (!data) {
    const plan = id === ADMIN_ID ? "admin" : "trial";
    const user = { plan, credits: PLANS[plan] };
    await redis.set(`user:${id}`, JSON.stringify(user));
    return user;
  }
  return JSON.parse(data);
}

async function setUser(id, user) {
  await redis.set(`user:${id}`, JSON.stringify(user));
}

// ---------------- QUEUE ----------------
async function enqueue(job) {
  await redis.lpush("queue:pending", JSON.stringify(job));
}

async function popQueue() {
  return await redis.rpop("queue:pending");
}

// ---------------- BOT ----------------
bot.onText(/\/start/, async (msg) => {
  const u = await getUser(msg.chat.id);
  bot.sendMessage(msg.chat.id,
`🦈 PIXELMETA AI
Plan: ${u.plan.toUpperCase()}
Credits: ${u.credits}

Commands:
/gen
/credits
/planvalidity`);
});

bot.onText(/\/credits/, async (msg) => {
  const u = await getUser(msg.chat.id);
  bot.sendMessage(msg.chat.id, `💳 Credits: ${u.credits}`);
});

bot.onText(/\/setcredits (.+) (.+)/, async (msg, m) => {
  if (msg.chat.id.toString() !== ADMIN_ID) return;
  const user = await getUser(m[1]);
  user.credits = parseInt(m[2]);
  await setUser(m[1], user);
  bot.sendMessage(msg.chat.id, "Credits updated");
});

let session = {};

bot.onText(/\/gen/, async (msg) => {
  session[msg.chat.id] = {};
  bot.sendMessage(msg.chat.id,
`Choose:
1 Cinematic 2K
2 Cinematic 4K
3 Realism 2K
4 Realism 4K
5 Ultra 8K
6 EDIT
7 🦈 SHARK`);
});

bot.on("message", async (msg) => {
  const id = msg.chat.id;
  if (!session[id]) return;

  if (!session[id].mode && MODES[msg.text]) {
    session[id].mode = msg.text;
    bot.sendMessage(id, "Send prompt:");
    return;
  }

  if (session[id].mode && msg.text) {
    const u = await getUser(id);
    const cost = MODES[session[id].mode].credits;
    if (u.credits < cost) {
      bot.sendMessage(id, "❌ Not enough credits");
      delete session[id];
      return;
    }

    const job = {
      id: uuidv4(),
      user: id,
      mode: session[id].mode,
      prompt: msg.text,
      attempts: 0
    };

    await enqueue(job);
    bot.sendMessage(id, "🦈 Processing... queued");

    delete session[id];
  }
});

// ---------------- WORKER ----------------
async function worker() {
  while (true) {
    const raw = await popQueue();
    if (!raw) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    const job = JSON.parse(raw);
    let image =
      await fal(job) ||
      await flux(job) ||
      await gpt(job);

    if (image) {
      await bot.sendPhoto(job.user, image);
      const u = await getUser(job.user);
      u.credits -= MODES[job.mode].credits;
      await setUser(job.user, u);
    } else {
      bot.sendMessage(job.user, "⚠️ Generation failed, retrying...");
      job.attempts++;
      if (job.attempts < 5) await enqueue(job);
    }
  }
}

// ---------------- FAL ----------------
async function fal(job) {
  try {
    const r = await fetch("https://fal.run/fal-ai/fast-sdxl", {
      method: "POST",
      headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: job.prompt })
    });
    const d = await r.json();
    return d?.images?.[0]?.url || null;
  } catch { return null; }
}

// ---------------- FLUX ----------------
async function flux(job) {
  try {
    const r = await fetch("https://api.flux.ai/generate", {
      method: "POST",
      headers: { Authorization: `Bearer ${FLUX_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: job.prompt })
    });
    const d = await r.json();
    return d?.image || null;
  } catch { return null; }
}

// ---------------- GPT ----------------
async function gpt(job) {
  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${GPT_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt: job.prompt })
    });
    const d = await r.json();
    return d?.data?.[0]?.url || null;
  } catch { return null; }
}

worker();
console.log("🦈 PIXELMETA QUEUE ENGINE LIVE");
