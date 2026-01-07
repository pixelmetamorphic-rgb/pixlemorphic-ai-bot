// PIXELMETA AI — FAL SAFE ENGINE

import express from "express";
import fetch from "node-fetch";
import Redis from "ioredis";

const app = express();
app.use(express.json());

const TG = process.env.TG_TOKEN;
const FAL = process.env.FAL_API_KEY;
const REDIS = new Redis(process.env.REDIS_URL);
const PUBLIC_URL = process.env.PUBLIC_URL;

const FAL_MODELS = {
  cinematic2k: "fal-ai/flux-cinematic",
  cinematic4k: "fal-ai/flux-cinematic-hq",
  realism2k: "fal-ai/flux-realism",
  realism4k: "fal-ai/flux-realism-hq",
  ultra8k: "fal-ai/flux-ultra",
  edit: "fal-ai/gpt-image-1.5-edit",
  shark: "fal-ai/flux-ultra"
};

async function tg(chat, text) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text })
  });
}

async function tgImage(chat, url) {
  await fetch(`https://api.telegram.org/bot${TG}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, photo: url })
  });
}

app.post("/", async (req, res) => {
  res.send("OK");

  const msg = req.body.message;
  if (!msg || !msg.text) return;

  const chat = msg.chat.id;
  const text = msg.text;

  if (text === "/start") {
    return tg(chat, "PIXELMETA AI Ready\nSend prompt to generate image.");
  }

  // push job
  await REDIS.lpush("queue", JSON.stringify({
    chat,
    prompt: text,
    mode: "shark",
    tries: 0
  }));

  tg(chat, "🦈 Processing in queue...");
});

async function worker() {
  while (true) {
    const job = await REDIS.brpop("queue", 0);
    const data = JSON.parse(job[1]);

    try {
      const model = FAL_MODELS[data.mode];
      const r = await fetch(`https://api.fal.ai/generate`, {
        method: "POST",
        headers: {
          "Authorization": `Key ${FAL}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          prompt: data.prompt,
          image_size: "square_8k"
        })
      });

      const j = await r.json();
      if (!j.images) throw "fail";

      await tgImage(data.chat, j.images[0].url);
    } catch (e) {
      if (data.tries < 5) {
        data.tries++;
        await REDIS.lpush("queue", JSON.stringify(data));
      } else {
        await tg(data.chat, "❌ Engine busy. Try again.");
      }
    }
  }
}

worker();
app.listen(8080);
console.log("🚀 PIXELMETA WEBHOOK LIVE");
