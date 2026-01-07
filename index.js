import express from "express";
import fetch from "node-fetch";
import Redis from "ioredis";

/* ================== CONFIG ================== */
const TG_TOKEN = process.env.TG_TOKEN;
const FAL_KEY = process.env.FAL_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const PUBLIC_URL = process.env.PUBLIC_URL;
const ADMIN_ID = "1078816855";

const TG = `https://api.telegram.org/bot${TG_TOKEN}`;
const redis = new Redis(REDIS_URL);

/* ================== APP ================== */
const app = express();
app.use(express.json());

/* ================== HELPERS ================== */
async function tg(method, data) {
  await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

async function getUser(id) {
  const raw = await redis.get(`user:${id}`);
  if (!raw) {
    const user = { credits: 40 }; // trial
    await redis.set(`user:${id}`, JSON.stringify(user));
    return user;
  }
  return JSON.parse(raw);
}

async function saveUser(id, user) {
  await redis.set(`user:${id}`, JSON.stringify(user));
}

/* ================== WEBHOOK ================== */
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const msg = req.body.message;
  if (!msg || !msg.text) return;

  const chat = msg.chat.id;
  const text = msg.text.trim();

  // /start
  if (text === "/start") {
    const user = await getUser(chat);
    return tg("sendMessage", {
      chat_id: chat,
      text: `🎨 PIXELMETA AI\nCredits: ${user.credits}\n\nSend any prompt to generate an image.`
    });
  }

  // /credits
  if (text === "/credits") {
    const user = await getUser(chat);
    return tg("sendMessage", {
      chat_id: chat,
      text: `💳 Credits: ${user.credits}`
    });
  }

  // Admin: /setcredit <id> <amount>
  if (chat == ADMIN_ID && text.startsWith("/setcredit")) {
    const [_, uid, amt] = text.split(" ");
    const u = await getUser(uid);
    u.credits = parseInt(amt);
    await saveUser(uid, u);
    return tg("sendMessage", {
      chat_id: chat,
      text: `✅ Credits set for ${uid} → ${amt}`
    });
  }

  // Normal prompt
  const user = await getUser(chat);
  if (user.credits < 2) {
    return tg("sendMessage", {
      chat_id: chat,
      text: "❌ Not enough credits."
    });
  }

  await tg("sendMessage", {
    chat_id: chat,
    text: "⏳ Generating image..."
  });

  // Push job to queue
  await redis.lpush("queue", JSON.stringify({
    chat,
    prompt: text,
    tries: 0
  }));
});

/* ================== WORKER ================== */
async function worker() {
  while (true) {
    const job = await redis.brpop("queue", 0);
    const data = JSON.parse(job[1]);

    try {
      const r = await fetch("https://api.fal.ai/generate", {
        method: "POST",
        headers: {
          "Authorization": `Key ${FAL_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "flux-pro",
          prompt: data.prompt
        })
      });

      const j = await r.json();
      const img = j?.images?.[0]?.url;
      if (!img) throw "no image";

      await tg("sendPhoto", {
        chat_id: data.chat,
        photo: img
      });

      const u = await getUser(data.chat);
      u.credits -= 2;
      await saveUser(data.chat, u);

    } catch (e) {
      if (data.tries < 3) {
        data.tries++;
        await new Promise(r => setTimeout(r, 3000)); // delay
        await redis.lpush("queue", JSON.stringify(data));
      } else {
        await tg("sendMessage", {
          chat_id: data.chat,
          text: "⚠️ Generation failed. Try again later."
        });
      }
    }
  }
}
worker();

/* ================== SERVER ================== */
app.get("/", (_, res) => res.send("PIXELMETA PHASE-1 LIVE"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 PIXELMETA PHASE-1 WEBHOOK LIVE");
});
