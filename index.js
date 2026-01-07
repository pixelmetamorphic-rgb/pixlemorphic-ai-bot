import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import Redis from "ioredis";

const BOT_TOKEN = process.env.TG_TOKEN;
const FAL_KEY = process.env.FAL_KEY;
const REDIS_URL = process.env.REDIS_URL;
const ADMIN_ID = 1078816855;

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
const isAdmin = id => id === ADMIN_ID;

async function getUser(id){
  const d = await redis.get(`user:${id}`);
  if(!d){
    const exp = Date.now() + 30*24*60*60*1000;
    const u = { plan:"trial", credits:40, expiry:exp, ...PLANS.trial };
    await redis.set(`user:${id}`,JSON.stringify(u));
    return u;
  }
  return JSON.parse(d);
}

async function setPlan(id,plan){
  const exp = Date.now() + 30*24*60*60*1000;
  const u = { plan, expiry:exp, ...PLANS[plan] };
  await redis.set(`user:${id}`,JSON.stringify(u));
}

// ---------------- PROMPT ENGINE ----------------
const buildPrompt = (p,m) => `
Ultra high quality professional image.
Mode: ${m}.
Perfect anatomy, no blur, no distortion, correct text.
Prompt: ${p}
`;

// ---------------- SAFE FAL ----------------
async function falCall(model,prompt,image=null,size=null){
  const r = await fetch(`https://fal.run/${model}`,{
    method:"POST",
    headers:{Authorization:`Key ${FAL_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({prompt,image,image_size:size})
  });
  const d = await r.json();

  if(d.images?.length) return d.images[0].url;
  if(d.image?.url) return d.image.url;
  if(d.output?.images?.length) return d.output.images[0];

  throw new Error("Fal returned no image");
}

// ---------------- START ----------------
bot.onText(/\/start/, async m=>{
  const u=await getUser(m.chat.id);
  bot.sendMessage(m.chat.id,
`🦈 PIXELMETA AI
Plan: ${u.plan.toUpperCase()}
Credits: ${u.credits}

/gen
/credits
/planvalidity`);
});

bot.onText(/\/credits/,async m=>{
  const u=await getUser(m.chat.id);
  bot.sendMessage(m.chat.id,`Credits: ${u.credits}`);
});

bot.onText(/\/planvalidity/,async m=>{
  const u=await getUser(m.chat.id);
  bot.sendMessage(m.chat.id,`Valid till: ${new Date(u.expiry).toLocaleDateString()}`);
});

// ---------------- ADMIN ----------------
bot.onText(/\/setplan (\d+) (\w+)/,async(m,x)=>{
  if(!isAdmin(m.chat.id))return;
  if(!PLANS[x[2]]) return bot.sendMessage(m.chat.id,"Invalid plan");
  await setPlan(x[1],x[2]);
  bot.sendMessage(m.chat.id,"Plan updated");
});

bot.onText(/\/setcredits (\d+) (\d+)/,async(m,x)=>{
  if(!isAdmin(m.chat.id))return;
  const u=await getUser(x[1]);
  u.credits=parseInt(x[2]);
  await redis.set(`user:${x[1]}`,JSON.stringify(u));
  bot.sendMessage(m.chat.id,"Credits updated");
});

// ---------------- GENERATION ----------------
bot.onText(/\/gen/, m=>{
  bot.sendMessage(m.chat.id,
`Choose:
1 Cinematic 2K
2 Cinematic 4K
3 Realism 2K
4 Realism 4K
5 Ultra 8K
6 EDIT
7 🦈 SHARK`);
  
  bot.once("message", async c=>{
    const map={1:"cinematic_2k",2:"cinematic_4k",3:"realism_2k",4:"realism_4k",5:"ultra8k",6:"edit",7:"shark_v1"};
    const mode=map[c.text];
    if(!mode) return;

    const u=await getUser(c.chat.id);
    const mdel=MODELS[mode];

    if(!isAdmin(c.chat.id)){
      if(u.credits<mdel.credits) return bot.sendMessage(c.chat.id,"❌ Insufficient credits");
      if((mode==="ultra8k"&&!u.can8k)||(mode==="edit"&&!u.canEdit)||(mode==="shark_v1"&&!u.canShark))
        return bot.sendMessage(c.chat.id,"🔒 Upgrade required");
    }

    bot.sendMessage(c.chat.id,"✍️ Send your prompt");

    bot.once("message", async p=>{
      await bot.sendMessage(c.chat.id,"🦈 Processing… please wait 20–40 sec");

      try{
        if(!isAdmin(c.chat.id)){
          u.credits-=mdel.credits;
          await redis.set(`user:${c.chat.id}`,JSON.stringify(u));
        }

        let img=null;
        for(const f of mdel.pipeline){
          img = await falCall(f,buildPrompt(p.text,mode),img,mdel.size);
        }

        bot.sendPhoto(c.chat.id,img,{caption:`PIXELMETA ${mode.toUpperCase()}`});
      }catch(e){
        console.log(e);
        bot.sendMessage(c.chat.id,"❌ Generation failed. Please try again.");
      }
    });
  });
});

console.log("🦈 PIXELMETA READY");
