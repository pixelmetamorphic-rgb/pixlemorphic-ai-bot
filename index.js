import express from "express";
import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

/* ========== ENV ========== */
const BOT_TOKEN = process.env.TG_TOKEN;
const FAL_KEY = process.env.FAL_KEY;
const OPENAI_KEY = process.env.OPENAI_KEY;
const REDIS_URL = process.env.REDIS_URL;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://pixlemorphic-ai-bot-production.up.railway.app
const ADMIN_ID = "1078816855";

/* ========== TELEGRAM ========== */
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });
bot.setWebHook(`${WEBHOOK_URL}/webhook`);

app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", (_, res) => res.send("PIXELMETA WEBHOOK ACTIVE"));

/* ========== REDIS ========== */
const redis = new Redis(REDIS_URL);

/* ========== PLANS ========== */
const PLANS = {
  trial: 40,
  promo: 100,
  pro: 1200,
  premium: 2000,
  admin: 9999999
};

/* ========== MODES ========== */
const MODES = {
  "1": { name: "Cinematic 2K", credits: 2, size: "1024x1024" },
  "2": { name: "Cinematic 4K", credits: 4, size: "2048x2048" },
  "3": { name: "Realism 2K", credits: 4, size: "1024x1024" },
  "4": { name: "Realism 4K", credits: 10, size: "2048x2048" },
  "5": { name: "Ultra 8K", credits: 10, size: "4096x4096" },
  "6": { name: "EDIT", credits: 80, size: "2048x2048" },
  "7": { name: "SHARK 🦈", credits: 140, size: "4096x4096" }
};

/* ========== USERS ========== */
async function getUser(id) {
  const raw = await redis.get(`user:${id}`);
  if (!raw) {
    const plan = id === ADMIN_ID ? "admin" : "trial";
    const user = { plan, credits: PLANS[plan] };
    await redis.set(`user:${id}`, JSON.stringify(user));
    return user;
  }
  return JSON.parse(raw);
}

async function saveUser(id, user) {
  await redis.set(`user:${id}`, JSON.stringify(user));
}

/* ========== QUEUE ========== */
async function enqueue(job) {
  await redis.lpush("queue:pending", JSON.stringify(job));
}

async function dequeue() {
  return await redis.rpop("queue:pending");
}

/* ========== FAL ========== */
async function falGenerate(prompt, size) {
  try {
    const r = await fetch("https://fal.run/fal-ai/flux-pro", {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt, image_size: size })
    });
    const d = await r.json();
    return d?.images?.[0]?.url || null;
  } catch {
    return null;
  }
}

/* ========== GPT IMAGE (fallback) ========== */
async function gptGenerate(prompt, size) {
  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size
      })
    });
    const d = await r.json();
    return d?.data?.[0]?.url || null;
  } catch {
    return null;
  }
}

/* ========== GENERATOR WITH FALLBACK ========== */
async function generateImage(job) {
  return (
    await falGenerate(job.prompt, MODES[job.mode].size) ||
    await gptGenerate(job.prompt, MODES[job.mode].size)
  );
}

/* ========== WORKER LOOP ========== */
async function worker() {
  while (true) {
    const raw = await dequeue();
    if (!raw) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    const job = JSON.parse(raw);
    const img = await generateImage(job);

    if (img) {
      await bot.sendPhoto(job.user, img);
      const u = await getUser(job.user);
      u.credits -= MODES[job.mode].credits;
      await saveUser(job.user, u);
    } else {
      job.attempts = (job.attempts || 0) + 1;
      if (job.attempts < 5) await enqueue(job);
      else await bot.sendMessage(job.user, "⚠️ Generation failed after retries.");
    }
  }
}
worker();

/* ========== BOT COMMANDS ========== */
const sessions = {};

bot.onText(/\/start/, async (msg) => {
  const u = await getUser(msg.chat.id);
  bot.sendMessage(msg.chat.id,
`🦈 PIXELMETA AI
Plan: ${u.plan.toUpperCase()}
Credits: ${u.credits}

/gen
/credits`);
});

bot.onText(/\/credits/, async (msg) => {
  const u = await getUser(msg.chat.id);
  bot.sendMessage(msg.chat.id, `💳 Credits: ${u.credits}`);
});

bot.onText(/\/gen/, (msg) => {
  sessions[msg.chat.id] = {};
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
  if (!sessions[id]) return;

  if (!sessions[id].mode && MODES[msg.text]) {
    sessions[id].mode = msg.text;
    bot.sendMessage(id, "Send prompt:");
    return;
  }

  if (sessions[id].mode && msg.text) {
    const u = await getUser(id);
    const cost = MODES[sessions[id].mode].credits;
    if (u.credits < cost) {
      bot.sendMessage(id, "❌ Not enough credits");
      delete sessions[id];
      return;
    }

    const job = {
      id: uuidv4(),
      user: id,
      mode: sessions[id].mode,
      prompt: msg.text,
      attempts: 0
    };

    await enqueue(job);
    bot.sendMessage(id, "🦈 Processing… queued");
    delete sessions[id];
  }
});

/* ========== SERVER ========== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 PIXELMETA WEBHOOK LIVE"));
