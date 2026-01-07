import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import Redis from "ioredis";

// ============ ENV ============
const BOT_TOKEN = process.env.TG_TOKEN;
const FAL_KEY   = process.env.FAL_KEY;
const REDIS_URL = process.env.REDIS_URL;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(x => x.trim()).filter(Boolean);

// ============ INIT ============
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const redis = new Redis(REDIS_URL);

// ============ PLANS ============
const PLANS = {
  promo:   { credits: 100, days: 30 },
  trial:   { credits: 40,  days: 30 },
  pro:     { credits: 1200, days: 30 },
  premium: { credits: 2000, days: 30 }
};

// ============ MODELS (with fallback) ============
const FAL_MODELS = {
  text2img: [
    "fal-ai/flux-pro",
    "fal-ai/flux/dev",
    "fal-ai/qwen-image"
  ],
  img2img: [
    "fal-ai/flux-pro/kontext",
    "fal-ai/flux/dev/image-to-image"
  ],
  upscale: "fal-ai/flux-pro"
};

const TIERS = {
  cinematic2k: { cost: 2, size: "1024x1024", style: "cinematic" },
  cinematic4k: { cost: 4, size: "2048x2048", style: "cinematic" },
  realism2k:   { cost: 4, size: "1024x1024", style: "realism"   },
  realism4k:   { cost: 10,size: "2048x2048", style: "realism"   },
  ultra8k:     { cost: 10,size: "4096x4096", style: "ultra"     },
  edit:        { cost: 80 },
  shark:       { cost: 140 }
};

// ============ HELPERS ============
const now = () => Date.now();

async function getUser(id){
  const raw = await redis.get(`user:${id}`);
  if(!raw){
    const u = { plan:"trial", credits: PLANS.trial.credits, exp: now()+PLANS.trial.days*864e5 };
    await redis.set(`user:${id}`, JSON.stringify(u));
    return u;
  }
  return JSON.parse(raw);
}
async function saveUser(id,u){ await redis.set(`user:${id}`, JSON.stringify(u)); }

function isAdmin(id){ return ADMIN_IDS.includes(String(id)); }

// Safe fetch to FAL
async function falCall(endpoint, body){
  const r = await fetch(`https://fal.run/${endpoint}`, {
    method:"POST",
    headers:{
      "Authorization":`Key ${FAL_KEY}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if(!j || !j.images || !j.images.length) throw new Error("NO_IMAGE");
  return j.images[0].url;
}

// Try a list of endpoints (fallback)
async function falWithFallback(endpoints, body){
  let lastErr;
  for(const ep of endpoints){
    try{
      return await falCall(ep, body);
    }catch(e){
      lastErr = e;
    }
  }
  throw lastErr || new Error("ALL_FAILED");
}

// Build prompts
function stylePrompt(base, style){
  if(style==="cinematic") return `cinematic lighting, film look, dramatic contrast, depth of field, ${base}`;
  if(style==="realism")   return `photorealistic, natural skin tones, real textures, ${base}`;
  if(style==="ultra")     return `ultra clarity, micro details, HDR, sharp shadows, ${base}`;
  return base;
}

// ============ COMMANDS ============
bot.onText(/\/start/, async (m)=>{
  const u = await getUser(m.chat.id);
  bot.sendMessage(m.chat.id, `🦈 *PIXELMETA AI*\nPlan: *${u.plan.toUpperCase()}*\nCredits: *${u.credits}*\n\n/gen – Generate\n/credits – Balance\n/planvalidity – Expiry`, {parse_mode:"Markdown"});
});

bot.onText(/\/credits/, async (m)=>{
  const u = await getUser(m.chat.id);
  bot.sendMessage(m.chat.id, `💳 Credits: ${u.credits}`);
});

bot.onText(/\/planvalidity/, async (m)=>{
  const u = await getUser(m.chat.id);
  bot.sendMessage(m.chat.id, `📅 Expires: ${new Date(u.exp).toLocaleString()}`);
});

// Admin
bot.onText(/\/setcredits (\d+) (\d+)/, async (m,match)=>{
  if(!isAdmin(m.chat.id)) return bot.sendMessage(m.chat.id,"❌ Not admin");
  const uid = match[1], amt = Number(match[2]);
  const u = await getUser(uid);
  u.credits = amt;
  await saveUser(uid,u);
  bot.sendMessage(m.chat.id,"✅ Credits updated");
});

bot.onText(/\/setplan (\d+) (\w+)/, async (m,match)=>{
  if(!isAdmin(m.chat.id)) return bot.sendMessage(m.chat.id,"❌ Not admin");
  const uid = match[1], p = match[2];
  if(!PLANS[p]) return bot.sendMessage(m.chat.id,"❌ Invalid plan");
  const u = await getUser(uid);
  u.plan = p; u.credits = PLANS[p].credits; u.exp = now()+PLANS[p].days*864e5;
  await saveUser(uid,u);
  bot.sendMessage(m.chat.id,"✅ Plan set");
});

// ============ GENERATION FLOW ============
const sessions = new Map();

bot.onText(/\/gen/, async (m)=>{
  bot.sendMessage(m.chat.id,
`Choose:
1 Cinematic 2K
2 Cinematic 4K
3 Realism 2K
4 Realism 4K
5 Ultra 8K
6 EDIT
7 🦈 SHARK`);
  sessions.set(m.chat.id,{ step:"pick" });
});

bot.on("message", async (m)=>{
  const id = m.chat.id;
  if(!sessions.has(id)) return;
  const s = sessions.get(id);
  const text = m.text;

  if(s.step==="pick"){
    const map = { "1":"cinematic2k","2":"cinematic4k","3":"realism2k","4":"realism4k","5":"ultra8k","6":"edit","7":"shark" };
    if(!map[text]) return bot.sendMessage(id,"❌ Invalid");
    s.mode = map[text];
    s.step = "prompt";
    return bot.sendMessage(id, s.mode==="edit" ? "Send prompt (you’ll be asked for image)" : "Send prompt");
  }

  if(s.step==="prompt"){
    s.prompt = text;
    if(s.mode==="edit"){
      s.step="image";
      return bot.sendMessage(id,"Send image now");
    }
    return generate(id,s);
  }

  if(s.step==="image" && m.photo){
    const file = await bot.getFile(m.photo[m.photo.length-1].file_id);
    s.image = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    return generate(id,s);
  }
});

async function generate(chatId, s){
  const u = await getUser(chatId);
  const tier = TIERS[s.mode];
  if(u.credits < tier.cost) return bot.sendMessage(chatId,"❌ Insufficient credits");

  bot.sendMessage(chatId,"🦈 Processing… please wait 20–40 sec");

  try{
    let url;

    if(s.mode==="edit"){
      url = await falWithFallback(FAL_MODELS.img2img, {
        image_url: s.image,
        prompt: s.prompt
      });
    }else{
      const prompt = stylePrompt(s.prompt, TIERS[s.mode].style);
      url = await falWithFallback(FAL_MODELS.text2img, {
        prompt,
        image_size: TIERS[s.mode].size || "1024x1024"
      });

      // SHARK = upscale pass
      if(s.mode==="shark"){
        url = await falCall(FAL_MODELS.upscale, {
          image_url: url,
          prompt: "ultra sharpen, micro detail, clarity"
        });
      }
    }

    // Deduct only after success
    u.credits -= tier.cost;
    await saveUser(chatId,u);

    await bot.sendPhoto(chatId, url, { caption:`✨ ${s.mode.toUpperCase()}` });
  }catch(e){
    bot.sendMessage(chatId,"⚠️ Generation failed, try again. Credits not deducted.");
  }finally{
    sessions.delete(chatId);
  }
}

console.log("🦈 PIXELMETA READY");
