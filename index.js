import TelegramBot from "node-telegram-bot-api"
import axios from "axios"
import express from "express"
import dotenv from "dotenv"
dotenv.config()

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true })
const app = express()

app.get("/", (req, res) => {
  res.send("Pixlemorphic AI Live 🚀")
})

app.listen(3000)

// START
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id,
    "🚀 Pixlemorphic AI\n\nUse:\n/image prompt\n/video prompt"
  )
})

// IMAGE GENERATION
bot.onText(/\/image (.+)/, async (msg, match) => {
  const res = await axios.post(
    "https://api.pixverse.ai/generate",
    { prompt: match[1] },
    { headers: { Authorization: process.env.PIXVERSE_KEY } }
  )

  bot.sendPhoto(msg.chat.id, res.data.image)
})

// VIDEO GENERATION
bot.onText(/\/video (.+)/, async (msg, match) => {
  const res = await axios.post(
    "https://api.lumalabs.ai/video",
    {
      prompt: match[1],
      style: "cinematic",
      resolution: "1080p"
    },
    { headers: { Authorization: process.env.LUMA_KEY } }
  )

  bot.sendVideo(msg.chat.id, res.data.video_url)
})
