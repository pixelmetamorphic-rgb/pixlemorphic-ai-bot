import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;

app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text || "";

    let reply = "👋 PIXLEMORPHIC AI\n\nUse:\n/image\n/video\n/credits";

    if (text === "/start") {
      reply = "🚀 PIXLEMORPHIC AI is LIVE!\n\nCommands:\n/image – Generate AI image\n/video – Generate AI video\n/credits – Check balance";
    }

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: reply
      })
    });

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});

app.get("/", (req, res) => {
  res.send("PIXLEMORPHIC AI running 🚀");
});

app.listen(3000, () => console.log("Bot running"));
