const express = require("express");
const fetch = require("node-fetch");
const Redis = require("ioredis");

const app = express();
app.use(express.json());

const TG = process.env.TG_TOKEN;
const OPENAI = process.env.OPENAI_KEY;
const FAL = process.env.FAL_API_KEY;
const REDIS = process.env.REDIS_URL;
const ADMIN = "1078816855";

const redis = new Redis(REDIS);

// ===== Keep alive =====
app.get("/", (req,res)=>res.send("PIXELMETA AUTO ENGINE LIVE 🚀"));

// ===== Telegram =====
async function send(chat, text){
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:chat,text})
  });
}

// ===== Model Router =====
function chooseModel(prompt){
  const real = ["realistic","photo","human","face","product","4k","ultra","hd"];
  return real.some(w=>prompt.toLowerCase().includes(w)) ? "openai" : "flux";
}

// ===== OpenAI 1.5 =====
async function genOpenAI(prompt){
  const r = await fetch("https://api.openai.com/v1/images/generations",{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${OPENAI}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:"gpt-image-1",
      prompt,
      size:"1024x1024"
    })
  });
  const j = await r.json();
  return j.data[0].url;
}

// ===== Flux Schnell =====
async function genFlux(prompt){
  const r = await fetch("https://fal.run/fal-ai/flux/schnell",{
    method:"POST",
    headers:{
      Authorization:`Key ${FAL}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({prompt,image_size:"1024x1024"})
  });
  const j = await r.json();
  return j.images[0].url;
}

// ===== Credits =====
async function getCredits(id){
  if(id===ADMIN) return 999999;
  return parseInt(await redis.get(`credits:${id}`)||0);
}
async function useCredits(id,n){
  if(id===ADMIN) return true;
  const c = await getCredits(id);
  if(c<n) return false;
  await redis.decrby(`credits:${id}`,n);
  return true;
}

// ===== Webhook =====
app.post("/", async(req,res)=>{
  res.sendStatus(200);
  const msg = req.body.message;
  if(!msg || !msg.text) return;

  const chat = msg.chat.id.toString();
  const text = msg.text.trim();

  if(text==="/start"){
    if(!(await redis.get(`credits:${chat}`)) && chat!==ADMIN){
      await redis.set(`credits:${chat}`,40);
    }
    await send(chat,"🚀 PIXELMETA AI\nUse /gen <prompt>");
    return;
  }

  if(text==="/credits"){
    await send(chat,`💳 Credits: ${await getCredits(chat)}`);
    return;
  }

  if(text.startsWith("/gen ")){
    const prompt = text.slice(5);

    if(!(await useCredits(chat,2))){
      await send(chat,"❌ Not enough credits");
      return;
    }

    await send(chat,"🧠 Generating image...");

    try{
      const engine = chooseModel(prompt);
      const img = engine==="openai" ? await genOpenAI(prompt) : await genFlux(prompt);
      await send(chat,img);
    }catch{
      await send(chat,"⚠️ Generation failed. Try again.");
    }
  }
});

// ===== Railway =====
app.listen(process.env.PORT||8080, ()=>{
  console.log("PIXELMETA AUTO ENGINE RUNNING");
});
