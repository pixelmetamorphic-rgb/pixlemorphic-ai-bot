import express from "express";
import fetch from "node-fetch";
import Redis from "ioredis";

const app = express();
app.use(express.json());

const TG = process.env.TG_TOKEN;
const FAL = process.env.FAL_API_KEY;
const redis = new Redis(process.env.REDIS_URL);

const TG_API = `https://api.telegram.org/bot${TG}`;

// ---------------------------------
// UTILS
// ---------------------------------
async function send(chatId, text) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

async function getCredits(user) {
  let c = await redis.get(`credits:${user}`);
  if (!c) {
    await redis.set(`credits:${user}`, 40); // trial
    return 40;
  }
  return parseInt(c);
}

// ---------------------------------
// WEBHOOK
// ---------------------------------
app.post("/", async (req, res) => {
  res.send("ok"); // ALWAYS ACK TELEGRAM

  try {
    const msg = req.body.message;
    if (!msg) return;

    const chatId = msg.chat.id;
    const user = msg.from.id;
    const text = msg.text || "";

    // ---------------- START
    if (text === "/start") {
      return send(chatId,
`Welcome to PIXELMETA AI 🚀

Commands:
 /gen - generate image
 /credits - check credits
 /planvalidity - plan status`);
    }

    // ---------------- CREDITS
    if (text === "/credits") {
      const c = await getCredits(user);
      return send(chatId, `💳 You have ${c} credits`);
    }

    // ---------------- PLAN
    if (text === "/planvalidity") {
      return send(chatId, "Trial plan active");
    }

    // ---------------- GENERATE
    if (text.startsWith("/gen")) {
      const prompt = text.replace("/gen", "").trim();
      if (!prompt) return send(chatId, "Send like: /gen a cyberpunk city");

      const credits = await getCredits(user);
      if (credits < 2) return send(chatId, "❌ Not enough credits");

      await redis.decrby(`credits:${user}`, 2);
      send(chatId, "🎨 Generating...");

      // Fal job
      const r = await fetch("https://fal.run/fal-ai/fast-sdxl", {
        method: "POST",
        headers: {
          "Authorization": `Key ${FAL}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt })
      });

      const data = await r.json();

      if (!data.images || !data.images[0]) {
        return send(chatId, "❌ Generation failed, credits refunded");
      }

      const img = data.images[0].url;

      await fetch(`${TG_API}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, photo: img })
      });
    }

  } catch (e) {
    console.error(e);
  }
});

app.listen(8080, () => console.log("PIXELMETA WEBHOOK LIVE"));
