import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const TOKEN = process.env.TG_TOKEN;
const TG_API = `https://api.telegram.org/bot${TOKEN}`;

app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;

    if (!msg) return res.sendStatus(200);

    const chatId = msg.chat.id;
    const text = msg.text || "";

    if (text === "/start") {
      await fetch(`${TG_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🚀 PIXLEMORPHIC AI READY\n\nUse:\n/image prompt\n/credits\n/img2video",
        }),
      });
    }

    if (text.startsWith("/image")) {
      await fetch(`${TG_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🖼 Image generation started...\n(Flux API will be connected next)",
        }),
      });
    }

    if (text === "/credits") {
      await fetch(`${TG_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "💰 Credits: 100",
        }),
      });
    }

    res.sendStatus(200);
  } catch (e) {
    console.log(e);
    res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Bot running");
});
