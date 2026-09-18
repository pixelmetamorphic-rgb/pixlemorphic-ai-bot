"use strict";
const fs=require("fs"),path=require("path");
const indexPath=path.join(__dirname,"index.js");
let source=fs.readFileSync(indexPath,"utf8");

function replaceBetween(s,start,end,replacement){
  const a=s.indexOf(start), b=s.indexOf(end,a+start.length);
  if(a<0||b<0) throw new Error("Bootstrap marker missing: "+start);
  return s.slice(0,a)+replacement+s.slice(b);
}

/* ---------- MODEL REGISTRY ---------- */
const models=`const MODELS = {
  cinematic:{key:"cinematic",label:"🎬 Pixlemeta Cinematic",type:"t2i",qualities:{"2k":{cost:2},"4k":{cost:4}},engines:{primary:"fal_schnell",backup:null}},
  realism:{key:"realism",label:"📸 Pixlemeta Realism (DSLR)",type:"t2i",qualities:{"2k":{cost:6},"4k":{cost:15}},engines:{primary:"fal_flux_ultra_realism",backup:"replicate_sdxl"}},
  ultra8k:{key:"ultra8k",label:"🟪 Pixlemeta Ultra 8K (True)",type:"t2i",qualities:{"8k":{cost:30}},engines:{primary:"fal_flux_pro_8k",backup:null}},
  edit:{key:"edit",label:"✏️ Pixlemeta EDIT (FLUX.1 Kontext Pro)",type:"i2i",qualities:{"2k":{cost:15},"4k":{cost:25},"8k":{cost:45}},engines:{primary:"kontext_pro_edit",backup:null}},
  nano2:{key:"nano2",label:"🍌 Nano Banana 2",type:"t2i",qualities:{"2k":{cost:8},"4k":{cost:16}},engines:{primary:"wavespeed_nano2",backup:null}},
  nanop:{key:"nanop",label:"🍌 Nano Banana Pro",type:"t2i",qualities:{"2k":{cost:12},"4k":{cost:24}},engines:{primary:"wavespeed_nanopro",backup:null}},
  gptimage2:{key:"gptimage2",label:"🧠 GPT Image 2",type:"t2i",qualities:{"2k":{cost:25},"4k":{cost:50}},engines:{primary:"coming_soon",backup:null}},
  seedream4:{key:"seedream4",label:"🌱 Seedream 4.0",type:"t2i",qualities:{"2k":{cost:6},"4k":{cost:12}},engines:{primary:"coming_soon",backup:null}},
  fluxdev:{key:"fluxdev",label:"⚡ FLUX.1 [dev]",type:"t2i",qualities:{"2k":{cost:4}},engines:{primary:"coming_soon",backup:null}}
};
const PLAN_ACCESS={trial:new Set(["cinematic","realism"]),promo:new Set(["cinematic","realism","edit","nano2","nanop"]),paid:new Set(Object.keys(MODELS)),admin:new Set(Object.keys(MODELS))};
`;
source=replaceBetween(source,"const MODELS = {","/* =========================\n   ASPECT RATIOS\n========================= */",models+"/* =========================\n   ASPECT RATIOS\n========================= */");

/* ---------- SHARK -> EDIT ---------- */
source=source.replace(/shark_v1_edit/g,"kontext_pro_edit")
  .replace(/sharkV1EditPipeline/g,"kontextProEditPipeline")
  .replace(/fal-ai\/flux\/dev\/image-to-image/g,"fal-ai/flux-pro/kontext")
  .replace(/\/shark/g,"/edit")
  .replace(/cmdShark/g,"cmdEdit")
  .replace(/SHARK V1/g,"PIXLEMETA EDIT")
  .replace(/🦈/g,"✏️")
  .replace(/shark/g,"edit");

/* ---------- EXTRA PROVIDER ROUTING ---------- */
const marker="/* =========================\n   ENGINE ROUTER\n========================= */";
if(!source.includes("wavespeedNano2Generate")){
 const extra=`/* =========================
   EXTRA PROVIDER ENGINES
========================= */
async function wavespeedGenerate(model,input,label){
  const key=process.env.WAVESPEED_API_KEY||process.env.WAVESPEED_KEY;
  if(!key) throw Error("WaveSpeed API key is not configured");
  const r=await fetch("https://api.wavespeed.ai/api/v3/predictions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},body:JSON.stringify({model,input})});
  if(!r.ok) throw Error("WaveSpeed request failed: "+r.status);
  const d=await r.json();
  if(d.output&&typeof d.output==="string") return {url:d.output,type:"image"};
  if(Array.isArray(d.output)&&d.output[0]) return {url:d.output[0],type:"image"};
  const id=d.id||d.prediction_id||d.data?.id;
  if(!id) throw Error(label+" returned no prediction id");
  for(let i=0;i<90;i++){
    await new Promise(x=>setTimeout(x,2000));
    const q=await fetch("https://api.wavespeed.ai/api/v3/predictions/"+id,{headers:{"Authorization":"Bearer "+key}});
    if(!q.ok) continue;
    const z=await q.json();
    const st=z.status||z.data?.status;
    if(st==="completed"||st==="succeeded"||st==="success"){
      const out=z.output||z.data?.output;
      const url=Array.isArray(out)?out[0]:out;
      if(url) return {url,type:"image"};
      throw Error(label+" completed without output");
    }
    if(st==="failed"||st==="error"||st==="cancelled") throw Error(label+" failed");
  }
  throw Error(label+" timed out");
}
async function wavespeedNano2Generate(prompt,q,r){return wavespeedGenerate("google/nano-banana-2",{prompt,aspect_ratio:r,resolution:q==="4k"?"4K":"2K"},"Nano Banana 2");}
async function wavespeedNanoProGenerate(prompt,q,r){return wavespeedGenerate("google/nano-banana-pro",{prompt,aspect_ratio:r,resolution:q==="4k"?"4K":"2K"},"Nano Banana Pro");}
`;
 source=source.replace(marker,extra+marker);
}
source=source.replace("  switch (engine) {","  switch (engine) {\n    case \"wavespeed_nano2\": return wavespeedNano2Generate(prompt,qualityKey,ratioKey);\n    case \"wavespeed_nanopro\": return wavespeedNanoProGenerate(prompt,qualityKey,ratioKey);\n    case \"coming_soon\": throw Error(\"This model is coming soon\");");

/* ---------- UI labels ---------- */
source=source.replace(/Pixlemeta EDIT[^\n]*/g,"Pixlemeta EDIT (FLUX.1 Kontext Pro)")
  .replace(/Nano Banana 2[^\n]*/g,"Nano Banana 2 • WaveSpeed")
  .replace(/Nano Banana Pro[^\n]*/g,"Nano Banana Pro • WaveSpeed");

/* IMPORTANT: boot must require the transformed source. */
fs.writeFileSync(indexPath,source,"utf8");
console.log("Bootstrap: provider-safe model registry applied");
require(indexPath);
