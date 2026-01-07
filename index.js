import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import Redis from "ioredis";

const BOT_TOKEN = process.env.TG_TOKEN;
const FAL_KEY = process.env.FAL_KEY;
const REDIS_URL = process.env.REDIS_URL;

const ADMIN_ID = 1078816855; // HARSH

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const redis = new Redis(REDIS_URL);

// ---------------- PLANS ----------------
const PLANS = {
  trial:   { credits: 40,  can8k: false, canEdit: false, canShark: false },
  promo:   { credits: 100, can8k: true,  canEdit: true,  canShark: true  },
  pro:     { credits: 1200,can8k: true,  canEdit: true,  canShark: true  },
  premium: { credits: 2000,can8k: true,  canEdit: true,  canShark: true  }
};

// ---------------- MODELS ----------------
const MODELS = {
  cinematic_2k: { credits: 2,  pipeline: ["fal-ai/flux-pro","fal-ai/sdxl-cinematic"], size: "2048x2048" },
  cinematic_4k: { credits: 4,  pipeline: ["fal-ai/flux-pro","fal-ai/sdxl-cinematic"], size: "4096x4096" },
  realism_2k:   { credits: 4,  pipeline: ["fal-ai/realistic-vision","fal-ai/gpt-image-1.5/edit"], size: "2048x2048" },
  realism_4k:   { credits: 10, pipeline: ["fal-ai/realistic-vision","fal-ai/gpt-image-1.5/edit"], size: "4096x4096" },
  ultra8k:      { credits: 10, pipeline: ["fal-ai/realistic-vision","fal-ai/pro-ultra"], size: "8192x8192" },
  edit:         { credits: 80, pipeline: ["fal-ai/gpt-image-1.5/edit"] },
  shark_v1:     { credits: 140,pipeline: ["fal-ai/gpt-image-1.5/edit","fal-ai/realistic-vision","fal-ai/pro-ultra"] }
};

// ---------------- HELPERS ----------------
function isAdmin(id) {
  return id === ADMIN_ID;
}

async function getUser(id) {
  const data = await redis.get(`user:${id}`);
  if (!data) {
    const expiry = Date.now() + 30*24*60*60*1000;
    const user = { plan: "trial", credits: 40, expiry, ...PLANS.trial };
    await redis.set(`user:${id}`, JSON.stringify(user));
    return user;
  }
  return JSON.parse(data);
}

async function setPlan(id, plan) {
  const expiry = Date.now() + 30*24*60*60*1000;
  const user = { plan, expiry, ...PLANS[plan] };
  await redis.set(`user:${id}`, JSON.stringify(user));
}

// ---------------- PROMPT ENGINE ----------------
function buildPrompt(prompt, mode) {
  return `
Ultra high quality professional image.
Mode: ${mode}.
No blur, no artifacts, no extra fingers.
Text must be spelled correctly if present.
Realistic lighting, sharp textures, perfect anatomy.
Prompt: ${prompt}
`;
}

// ---------------- START ----------------
bot.onText(/\/start/, async msg => {
  const u = await getUser(msg.chat.id);
  bot.sendMessage(msg.chat.id,
`🦈 PIXELMETA AI
Plan: ${u.plan.toUpperCase()}
Credits: ${u.credits}

/gen – Generate
/credits – Balance
/planvalidity – Expiry`);
});

bot.onText(/\/credits/, async msg => {
  const u = await getUser(msg.chat.id);
  bot.sendMessage(msg.chat.id, `Credits: ${u.credits}`);
});

bot.onText(/\/planvalidity/, async msg => {
  const u = await getUser(msg.chat.id);
  const d = new Date(u.expiry).toLocaleDateString();
  bot.sendMessage(msg.chat.id, `Plan: ${u.plan}\nCredits: ${u.credits}\nValid till: ${d}`);
});

// ---------------- ADMIN ----------------
bot.onText(/\/setplan (\d+) (\w+)/, async (msg, m) => {
  if (!isAdmin(msg.chat.id)) return;
  const id = m[1];
  const plan = m[2];
  if (!PLANS[plan]) return bot.sendMessage(msg.chat.id,"Invalid plan");
  await setPlan(id, plan);
  bot.sendMessage(msg.chat.id, `User ${id} set to ${plan}`);
});

bot.onText(/\/setcredits (\d+) (\d+)/, async (msg, m) => {
  if (!isAdmin(msg.chat.id)) return;
  const u = await getUser(m[1]);
  u.credits = parseInt(m[2]);
  await redis.set(`user:${m[1]}`, JSON.stringify(u));
  bot.sendMessage(msg.chat.id, "Credits updated");
});

// ---------------- GENERATION ----------------
bot.onText(/\/gen/, async msg => {
  bot.sendMessage(msg.chat.id,
`Choose:
1 Cinematic 2K
2 Cinematic 4K
3 Realism 2K
4 Realism 4K
5 Ultra 8K
6 EDIT
7 🦈 SHARK`);
  
  bot.once("message", async m => {
    const map = {1:"cinematic_2k",2:"cinematic_4k",3:"realism_2k",4:"realism_4k",5:"ultra8k",6:"edit",7:"shark_v1"};
    const mode = map[m.text];
    if (!mode) return;

    const user = await getUser(m.chat.id);
    const model = MODELS[mode];

    if (!isAdmin(m.chat.id)) {
      if (user.credits < model.credits) return bot.sendMessage(m.chat.id,"❌ Insufficient credits");
      if ((mode==="ultra8k"&&!user.can8k)||(mode==="edit"&&!user.canEdit)||(mode==="shark_v1"&&!user.canShark))
        return bot.sendMessage(m.chat.id,"🔒 Upgrade required");
    }

    bot.sendMessage(m.chat.id,"Send prompt:");
    bot.once("message", async p => {
      if (!isAdmin(m.chat.id)) {
        user.credits -= model.credits;
        await redis.set(`user:${m.chat.id}`, JSON.stringify(user));
      }

      let img=null;
      for(const fal of model.pipeline){
        const r = await fetch(`https://fal.run/${fal}`,{
          method:"POST",
          headers:{Authorization:`Key ${FAL_KEY}`,"Content-Type":"application/json"},
          body:JSON.stringify({prompt:buildPrompt(p.text,mode),image:img,image_size:model.size})
        });
        const d = await r.json();
        img = d.images[0].url;
      }
      bot.sendPhoto(m.chat.id,img,{caption:`PIXELMETA ${mode.toUpperCase()}`});
    });
  });
});

console.log("🦈 PIXELMETA READY");
