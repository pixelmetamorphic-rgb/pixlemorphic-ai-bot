"use strict";
const fs=require("fs"),path=require("path");
const indexPath=path.join(__dirname,"index.js");
let source=fs.readFileSync(indexPath,"utf8");

function replaceBetween(s,start,end,replacement){
  const a=s.indexOf(start),b=s.indexOf(end,a+start.length);
  if(a<0||b<0) throw new Error("Bootstrap marker missing: "+start);
  return s.slice(0,a)+replacement+s.slice(b);
}

/* Robust function replacement: finds the function body by balanced braces,
   instead of depending on whitespace/next-function formatting. */
function replaceFunction(s,name,replacement){
  const head=new RegExp("function\\s+"+name+"\\s*\\(");
  const m=head.exec(s);
  if(!m) throw new Error("Bootstrap function missing: "+name);
  const open=s.indexOf("{",m.index);
  if(open<0) throw new Error("Bootstrap opening brace missing: "+name);
  let depth=0,quote=null,esc=false,lineComment=false,blockComment=false;
  for(let i=open;i<s.length;i++){
    const c=s[i],n=s[i+1];
    if(lineComment){ if(c==="\n") lineComment=false; continue; }
    if(blockComment){ if(c==="*"&&n==="/"){blockComment=false;i++;} continue; }
    if(quote){
      if(esc){esc=false;continue;}
      if(c==="\\"){esc=true;continue;}
      if(c===quote) quote=null;
      continue;
    }
    if(c==="/"&&n==="/"){lineComment=true;i++;continue;}
    if(c==="/"&&n==="*"){blockComment=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==="{") depth++;
    else if(c==="}"){
      depth--;
      if(depth===0){
        return s.slice(0,m.index)+replacement+s.slice(i+1);
      }
    }
  }
  throw new Error("Bootstrap closing brace missing: "+name);
}

/* SHARK -> Pixlemeta EDIT / Kontext Pro */
source=source
  .replace(/shark_v1_edit/g,"kontext_pro_edit")
  .replace(/sharkV1EditPipeline/g,"kontextProEditPipeline")
  .replace(/fal-ai\/flux\/dev\/image-to-image/g,"fal-ai/flux-pro/kontext")
  .replace(/\/shark/g,"/edit")
  .replace(/cmdShark/g,"cmdEdit")
  .replace(/SHARK V1/g,"PIXLEMETA EDIT")
  .replace(/🦈/g,"✏️")
  .replace(/shark/g,"edit");

/* TODAY'S FAL MODEL REGISTRY */
const models=`const MODELS = {
  cinematic:{key:"cinematic",label:"🎬 Pixlemeta Cinematic",type:"t2i",qualities:{"2k":{cost:2},"4k":{cost:4}},engines:{primary:"fal_schnell",backup:null}},
  realism:{key:"realism",label:"📸 Pixlemeta Realism (DSLR)",type:"t2i",qualities:{"2k":{cost:6},"4k":{cost:15}},engines:{primary:"fal_flux_ultra_realism",backup:"replicate_sdxl"}},
  ultra8k:{key:"ultra8k",label:"🟪 Pixlemeta Ultra 8K (True)",type:"t2i",qualities:{"8k":{cost:30}},engines:{primary:"fal_flux_pro_8k",backup:null}},
  edit:{key:"edit",label:"✏️ Pixlemeta EDIT (FLUX.1 Kontext Pro)",type:"i2i",qualities:{"2k":{cost:15},"4k":{cost:25},"8k":{cost:45}},engines:{primary:"kontext_pro_edit",backup:null}},
  seedream4:{key:"seedream4",label:"🌱 Seedream 4.0",type:"t2i",qualities:{"2k":{cost:6},"4k":{cost:12}},engines:{primary:"fal_seedream4",backup:null}},
  fluxdev:{key:"fluxdev",label:"⚡ FLUX.1 [dev]",type:"t2i",qualities:{"2k":{cost:4}},engines:{primary:"fal_flux_dev",backup:null}},
  gptimage2:{key:"gptimage2",label:"🧠 GPT Image 2",type:"t2i",qualities:{"2k":{cost:25},"4k":{cost:50}},engines:{primary:"fal_gpt_image2",backup:null}},
  nano2:{key:"nano2",label:"🍌 Nano Banana 2",type:"t2i",qualities:{"2k":{cost:8},"4k":{cost:16}},engines:{primary:"coming_soon",backup:null}},
  nanop:{key:"nanop",label:"🍌 Nano Banana Pro",type:"t2i",qualities:{"2k":{cost:12},"4k":{cost:24}},engines:{primary:"coming_soon",backup:null}}
};
const PLAN_ACCESS={trial:new Set(["cinematic","realism","seedream4","fluxdev"]),promo:new Set(["cinematic","realism","edit","seedream4","fluxdev","gptimage2"]),paid:new Set(Object.keys(MODELS)),admin:new Set(Object.keys(MODELS))};`;
source=replaceBetween(source,"const MODELS = {","/* =========================\n   ASPECT RATIOS\n========================= */",models+"\n\n/* =========================\n   ASPECT RATIOS\n========================= */");

/* New FAL image engines */
const falExtras=`/* =========================
   NEW FAL IMAGE ENGINES
========================= */
async function falSeedream4Generate(prompt,qualityKey,ratioKey){
  const ratio=getRatio(ratioKey);
  const data=await falRun("fal-ai/bytedance/seedream/v4/text-to-image",{prompt,image_size:{width:ratio.width,height:ratio.height},num_images:1});
  const url=pickFirstImageUrl(data);
  if(!url) throw new Error("Seedream 4.0 returned no image");
  return {url,type:"image",ratio:ratio.label};
}
async function falFluxDevGenerate(prompt,qualityKey,ratioKey){
  const data=await falRun("fal-ai/flux/dev",{prompt,num_images:1,output_format:"jpeg"});
  const url=pickFirstImageUrl(data);
  if(!url) throw new Error("FLUX.1 [dev] returned no image");
  return {url,type:"image",ratio:getRatio(ratioKey).label};
}
async function falGPTImage2Generate(prompt,qualityKey,ratioKey){
  const ratio=getRatio(ratioKey);
  const quality=qualityKey==="4k"?"high":"medium";
  const data=await falRun("openai/gpt-image-2",{prompt,image_size:{width:ratio.width,height:ratio.height},quality,n:1});
  const url=pickFirstImageUrl(data);
  if(!url) throw new Error("GPT Image 2 returned no image");
  return {url,type:"image",ratio:ratio.label};
}
`;
if(!source.includes("falSeedream4Generate")){
  const marker="/* =========================\n   ENGINE ROUTER\n========================= */";
  if(source.includes(marker)) source=source.replace(marker,falExtras+"\n"+marker);
}

/* Add router cases without touching existing engines */
if(!source.includes('case "fal_seedream4"')){
  source=source.replace("  switch (engine) {","  switch (engine) {\n    case \"fal_seedream4\": return falSeedream4Generate(prompt,qualityKey,ratioKey);\n    case \"fal_flux_dev\": return falFluxDevGenerate(prompt,qualityKey,ratioKey);\n    case \"fal_gpt_image2\": return falGPTImage2Generate(prompt,qualityKey,ratioKey);");
}

/* Studio UI */
source=replaceFunction(source,"imageKeyboard",`function imageKeyboard() {
  return {inline_keyboard:[
    [{text:"🎬 Cinematic",callback_data:"m:cinematic"},{text:"📸 Realism",callback_data:"m:realism"}],
    [{text:"🟪 Ultra 8K",callback_data:"m:ultra8k"},{text:"✏️ EDIT",callback_data:"m:edit"}],
    [{text:"🌱 Seedream 4.0",callback_data:"m:seedream4"},{text:"⚡ FLUX.1 [dev]",callback_data:"m:fluxdev"}],
    [{text:"🧠 GPT Image 2",callback_data:"m:gptimage2"}],
    [{text:"🍌 Nano Banana 2 • SOON",callback_data:"soon:nano2"},{text:"🍌 Nano Banana Pro • SOON",callback_data:"soon:nanop"}],
    [{text:"⬅️ Back",callback_data:"x:home"},{text:"❌ Cancel",callback_data:"x:cancel"}]
  ]};
}`);

source=replaceFunction(source,"videoKeyboard",`function videoKeyboard() {
  return {inline_keyboard:[
    [{text:"⚡ Wan 2.2 • COMING SOON",callback_data:"v:soon:wan22"}],
    [{text:"🎞️ LTX-2 • COMING SOON",callback_data:"v:soon:ltx2"}],
    [{text:"🎥 Kling 3.0 • COMING SOON",callback_data:"v:soon:kling3"}],
    [{text:"🌊 Wan 2.7 • COMING SOON",callback_data:"v:soon:wan27"}],
    [{text:"🚀 Seedance 2.0 Fast • COMING SOON",callback_data:"v:soon:seedance20fast"}],
    [{text:"🎬 Seedance 2.0 • COMING SOON",callback_data:"v:soon:seedance20"}],
    [{text:"🔥 Seedance 2.5 • COMING SOON",callback_data:"v:soon:seedance25"}],
    [{text:"✨ Gemini Omni 1.1 Flash • COMING SOON",callback_data:"v:soon:geminiomni"}],
    [{text:"🎥 Veo 3.1 • COMING SOON",callback_data:"v:soon:veo31"}],
    [{text:"⚡ Kling 3.0 Turbo Pro • COMING SOON",callback_data:"v:soon:kling3turbo"}],
    [{text:"⚙️ Video Settings • COMING SOON",callback_data:"v:settings"}],
    [{text:"⬅️ Back",callback_data:"x:home"}]
  ]};
}`);

source=replaceFunction(source,"showVideoMenu",`async function showVideoMenu(chatId,userId) {
  await clearFlow(userId);
  return sendMessage(chatId,
    "🎬 PIXELMETA VIDEO STUDIO\\n\\n"+
    "Video models are being integrated next.\\n\\n"+
    "Choose an upcoming engine to see its status.\\n\\n"+
    "🎛️ Planned controls\\n"+
    "• Quality: 480p / 580p / 720p / 1080p / 4K\\n"+
    "• Duration: 5s / 8s / 10s / 15s\\n"+
    "• FPS: 24 / 30\\n"+
    "• Audio: On / Off\\n"+
    "• Ratio: 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9\\n\\n"+
    "🚧 No video credits are consumed until a model is actually connected.",
    {reply_markup:videoKeyboard()});
}`);

source=replaceFunction(source,"cmdModels",`async function cmdModels(chatId,userId) {
  const plan=await getPlan(userId);
  const lines=[
    "📚 PIXELMETA AI — MODEL STUDIO","",
    "🖼️ IMAGE — LIVE TODAY (FAL)",
    "🎬 Cinematic • 2K 2c / 4K 4c",
    "📸 Realism • 2K 6c / 4K 15c",
    "🟪 Ultra 8K • 8K 30c",
    "✏️ EDIT • FLUX.1 Kontext Pro • 2K 15c / 4K 25c / 8K 45c",
    "🌱 Seedream 4.0 • 2K 6c / 4K 12c",
    "⚡ FLUX.1 [dev] • 2K 4c",
    "🧠 GPT Image 2 • 2K 25c / 4K 50c",
    "",
    "🍌 IMAGE — WAVESPEED NEXT",
    "Nano Banana 2 • Coming soon",
    "Nano Banana Pro • Coming soon",
    "",
    "🎬 VIDEO — COMING SOON",
    "Wan 2.2 • LTX-2 • Kling 3.0 • Wan 2.7",
    "Seedance 2.0 Fast • Seedance 2.0 • Seedance 2.5",
    "Gemini Omni 1.1 Flash • Veo 3.1 • Kling 3.0 Turbo Pro",
    "",
    `Your plan: ${plan.toUpperCase()}`
  ];
  return sendMessage(chatId,lines.join("\\n"),{reply_markup:homeKeyboard()});
}`);

/* Generic status for future models; never charges credits */
if(!source.includes('data.startsWith("soon:")')){
  source=source.replace('  if (data.startsWith("m:")) {','  if (data.startsWith("soon:") || data.startsWith("v:soon:")) {\n    return sendMessage(chatId,"🚧 COMING SOON\\n\\nThis model is listed in the Studio but is not connected yet.\\n\\nNo credits were charged.");\n  }\n\n  if (data.startsWith("m:")) {');
}

/* New model callback safety */
if(!source.includes('engine === "coming_soon"')){
  source=source.replace('  const primary =\n    model.engines.primary;','  const primary =\n    model.engines.primary;\n\n  if (primary === "coming_soon") {\n    throw new Error("This model is coming soon");\n  }');
}

fs.writeFileSync(indexPath,source,"utf8");
console.log("Bootstrap: PIXLEMETA AI Studio update applied");
require(indexPath);
