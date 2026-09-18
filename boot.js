"use strict";
const fs = require("fs");
const path = require("path");
const indexPath = path.join(__dirname, "index.js");
let source = fs.readFileSync(indexPath, "utf8");

function replaceBetween(src, startMarker, endMarker, replacement) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Bootstrap marker missing: ${startMarker}`);
  return src.slice(0, start) + replacement + src.slice(end);
}
function bt(s) { return s.replaceAll("__BT__", "`"); }

function activateEdit(src) {
  if (!src.includes("fal-ai/flux-pro/kontext")) {
    const a = src.indexOf("\n  shark: {");
    const b = a >= 0 ? src.indexOf("\n  }\n};", a) : -1;
    if (a < 0 || b < 0) throw new Error("Legacy SHARK block not found");
    const edit = `\n  edit: {\n    key: "edit",\n    label: "✏️ Pixlemeta EDIT (Premium Edit)",\n    type: "i2i",\n    qualities: { "2k": { cost: 15 }, "4k": { cost: 25 }, "8k": { cost: 45 } },\n    engines: { primary: "kontext_pro_edit", backup: null }\n  }`;
    src = src.slice(0, a) + edit + src.slice(b + "\n  }".length);
  }
  return src.replace(/shark_v1_edit/g,"kontext_pro_edit")
    .replace(/sharkV1EditPipeline/g,"kontextProEditPipeline")
    .replace(/fal-ai\/flux\/dev\/image-to-image/g,"fal-ai/flux-pro/kontext")
    .replace(/"SHARK V1 returned no image"/g,'"Pixlemeta EDIT returned no image"')
    .replace(/\n  if \(qualityKey === "8k"\) \{\n    url = await falTopazUpscale\(\n      url,\n      4\n    \);\n  \}\n/g,"\n")
    .replace(/"shark"/g,'"edit"').replace(/`shark:\$\{userId\}:image`/g,'`edit:${userId}:image`')
    .replace(/\/shark/g,"/edit").replace(/cmdShark/g,"cmdEdit").replace(/SHARK V1/g,"PIXLEMETA EDIT")
    .replace(/🦈/g,"✏️").replace(/PHOTO \/ SHARK/g,"PHOTO / EDIT");
}

function activateModels(src) {
  const models = bt(String.raw`const MODELS = {
  cinematic: { key:"cinematic", label:"🎬 Pixlemeta Cinematic", type:"t2i", qualities:{"2k":{cost:2},"4k":{cost:4}}, engines:{primary:"fal_schnell",backup:null} },
  realism: { key:"realism", label:"📸 Pixlemeta Realism (DSLR)", type:"t2i", qualities:{"2k":{cost:6},"4k":{cost:15}}, engines:{primary:"fal_flux_ultra_realism",backup:"replicate_sdxl"} },
  ultra8k: { key:"ultra8k", label:"🟪 Pixlemeta Ultra 8K (True)", type:"t2i", qualities:{"8k":{cost:30}}, engines:{primary:"fal_flux_pro_8k",backup:null} },
  edit: { key:"edit", label:"✏️ Pixlemeta EDIT (FLUX.1 Kontext Pro)", type:"i2i", qualities:{"2k":{cost:15},"4k":{cost:25},"8k":{cost:45}}, engines:{primary:"kontext_pro_edit",backup:null} },
  nano2: { key:"nano2", label:"🍌 Nano Banana 2", type:"t2i", qualities:{"2k":{cost:8},"4k":{cost:16}}, engines:{primary:"fal_nano2",backup:null} },
  nanop: { key:"nanop", label:"🍌 Nano Banana Pro", type:"t2i", qualities:{"2k":{cost:12},"4k":{cost:24}}, engines:{primary:"fal_nanop",backup:null} },
  gptimage2: { key:"gptimage2", label:"🧠 GPT Image 2", type:"t2i", qualities:{"2k":{cost:25},"4k":{cost:50}}, engines:{primary:"fal_gpt_image2",backup:null} },
  seedream4: { key:"seedream4", label:"🌱 Seedream 4.0", type:"t2i", qualities:{"2k":{cost:6},"4k":{cost:12}}, engines:{primary:"fal_seedream4",backup:null} },
  fluxdev: { key:"fluxdev", label:"⚡ FLUX.1 [dev]", type:"t2i", qualities:{"2k":{cost:4}}, engines:{primary:"fal_flux_dev",backup:null} }
};

const PLAN_ACCESS = {
  trial: new Set(["cinematic","realism","nano2","seedream4","fluxdev"]),
  promo: new Set(Object.keys(MODELS)),
  paid: new Set(Object.keys(MODELS)),
  admin: new Set(Object.keys(MODELS))
};

`);
  return replaceBetween(src,"const MODELS = {","/* =========================\n   ASPECT RATIOS\n========================= */",models + "/* =========================\n   ASPECT RATIOS\n========================= */");
}

function addFalEngines(src) {
  const block = bt(String.raw`/* =========================
   EXTRA FAL IMAGE ENGINES
========================= */

async function falGenericImage(model, input, label) {
  const data = await falRun(model, input);
  const url = pickFirstImageUrl(data);
  if (!url) throw new Error(`${label} returned no image`);
  return { url, type:"image" };
}

async function falNano2Generate(prompt, qualityKey, ratioKey) {
  const ratio = getRatio(ratioKey);
  return falGenericImage("fal-ai/nano-banana-2", {
    prompt, num_images:1, aspect_ratio:ratio.label, output_format:"png",
    resolution: qualityKey === "4k" ? "4K" : "2K", limit_generations:true
  }, "Nano Banana 2");
}

async function falNanoProGenerate(prompt, qualityKey, ratioKey) {
  const ratio = getRatio(ratioKey);
  return falGenericImage("fal-ai/nano-banana-pro", {
    prompt, num_images:1, aspect_ratio:ratio.label, output_format:"png",
    resolution: qualityKey === "4k" ? "4K" : "2K", limit_generations:true
  }, "Nano Banana Pro");
}

async function falGPTImage2Generate(prompt, qualityKey, ratioKey) {
  const ratio = getRatio(ratioKey);
  return falGenericImage("openai/gpt-image-2", {
    prompt, image_size:{width:ratio.width,height:ratio.height},
    quality: qualityKey === "4k" ? "high" : "medium", num_images:1, output_format:"png"
  }, "GPT Image 2");
}

async function falSeedream4Generate(prompt, qualityKey, ratioKey) {
  const ratio = getRatio(ratioKey);
  return falGenericImage("fal-ai/bytedance/seedream/v4/text-to-image", {
    prompt, image_size:{width:ratio.width,height:ratio.height}, num_images:1,
    max_images:1, enable_safety_checker:true, enhance_prompt_mode:"standard"
  }, "Seedream 4.0");
}

async function falFluxDevGenerate(prompt) {
  return falGenericImage("fal-ai/flux/dev", {
    prompt, num_images:1, guidance_scale:3.5, enable_safety_checker:true, output_format:"jpeg"
  }, "FLUX.1 [dev]");
}

`);
  return replaceBetween(src,"/* =========================\n   ENGINE ROUTER\n========================= */",block + "/* =========================\n   ENGINE ROUTER\n========================= */",block + "/* =========================\n   ENGINE ROUTER\n========================= */");
}

function patchRouter(src) {
  const marker = "  switch (engine) {";
  const cases = `  switch (engine) {\n    case "fal_nano2": return falNano2Generate(prompt, qualityKey, ratioKey);\n    case "fal_nanop": return falNanoProGenerate(prompt, qualityKey, ratioKey);\n    case "fal_gpt_image2": return falGPTImage2Generate(prompt, qualityKey, ratioKey);\n    case "fal_seedream4": return falSeedream4Generate(prompt, qualityKey, ratioKey);\n    case "fal_flux_dev": return falFluxDevGenerate(prompt);`;
  if (src.includes('case "fal_nano2"')) return src;
  return src.replace(marker,cases);
}

function patchInference(src) {
  if (src.includes('lower.includes("nano banana")')) return src;
  const marker = `  if (\n    lower.includes(\n      "realism"`;
  const insert = `  if (lower.includes("nano banana") && lower.includes("pro")) modelKey = "nanop";\n  else if (lower.includes("nano banana")) modelKey = "nano2";\n  else if (lower.includes("gpt image")) modelKey = "gptimage2";\n  else if (lower.includes("seedream")) modelKey = "seedream4";\n  else if (lower.includes("flux.1 [dev]") || lower.includes("flux dev")) modelKey = "fluxdev";\n\n`;
  return src.replace(marker,insert + marker);
}

function patchUI(src) {
  const kb = bt(String.raw`/* =========================
   KEYBOARDS
========================= */
function homeKeyboard(){return{inline_keyboard:[[{text:"🖼️ IMAGE STUDIO",callback_data:"mode:image"},{text:"🎬 VIDEO STUDIO",callback_data:"mode:video"}],[{text:"✨ MODELS",callback_data:"home:models"},{text:"💳 CREDITS",callback_data:"home:credits"}]]};}
function imageKeyboard(){return{inline_keyboard:[[{text:"🎬 Pixlemeta Cinematic • LIVE",callback_data:"m:cinematic"}],[{text:"📸 Pixlemeta Realism • LIVE",callback_data:"m:realism"}],[{text:"🟪 Pixlemeta Ultra 8K • LIVE",callback_data:"m:ultra8k"}],[{text:"✏️ Pixlemeta EDIT • LIVE",callback_data:"m:edit"}],[{text:"🍌 Nano Banana 2 • LIVE",callback_data:"m:nano2"}],[{text:"🍌 Nano Banana Pro • LIVE",callback_data:"m:nanop"}],[{text:"🧠 GPT Image 2 • LIVE",callback_data:"m:gptimage2"}],[{text:"🌱 Seedream 4.0 • LIVE",callback_data:"m:seedream4"}],[{text:"⚡ FLUX.1 [dev] • LIVE",callback_data:"m:fluxdev"}],[{text:"⬅️ Back",callback_data:"x:home"},{text:"❌ Cancel",callback_data:"x:cancel"}]]};}
function qualityKeyboard(modelKey){const model=MODELS[modelKey];const buttons=Object.keys(model.qualities).map(q=>({text:`${q.toUpperCase()} • ${model.qualities[q].cost} credits`,callback_data:`q:${modelKey}:${q}`}));return{inline_keyboard:[buttons,[{text:"⬅️ Back",callback_data:"x:back_models"},{text:"❌ Cancel",callback_data:"x:cancel"}]]};}
function ratioKeyboard(modelKey,qualityKey){return{inline_keyboard:[[{text:"1:1",callback_data:`r:${modelKey}:${qualityKey}:sq`},{text:"4:5",callback_data:`r:${modelKey}:${qualityKey}:45`}],[{text:"3:4",callback_data:`r:${modelKey}:${qualityKey}:34`},{text:"16:9",callback_data:`r:${modelKey}:${qualityKey}:169`}],[{text:"9:16",callback_data:`r:${modelKey}:${qualityKey}:916`}],[{text:"⬅️ Back",callback_data:"x:back_quality"},{text:"❌ Cancel",callback_data:"x:cancel"}]]};}
function videoKeyboard(){return{inline_keyboard:[[{text:"⚡ Seedance 2.0 Fast • COMING SOON",callback_data:"v:soon"}],[{text:"🎞️ Seedance 2.0 • COMING SOON",callback_data:"v:soon"}],[{text:"🔥 Seedance 2.5 • COMING SOON",callback_data:"v:soon"}],[{text:"🎥 Kling 2.5 Turbo Pro • COMING SOON",callback_data:"v:soon"}],[{text:"🌊 WAN 2.2 • COMING SOON",callback_data:"v:soon"}],[{text:"🟢 Veo 3.1 • COMING SOON",callback_data:"v:soon"}],[{text:"🎚️ VIDEO QUALITY",callback_data:"v:quality"},{text:"⏱️ DURATION",callback_data:"v:duration"}],[{text:"🎞️ FPS",callback_data:"v:fps"},{text:"🔊 AUDIO",callback_data:"v:audio"}],[{text:"16:9",callback_data:"v:ratio:16:9"},{text:"9:16",callback_data:"v:ratio:9:16"},{text:"1:1",callback_data:"v:ratio:1:1"}],[{text:"4:3",callback_data:"v:ratio:4:3"},{text:"3:4",callback_data:"v:ratio:3:4"},{text:"21:9",callback_data:"v:ratio:21:9"}],[{text:"🖼️ IMAGE → VIDEO • COMING SOON",callback_data:"v:soon"}],[{text:"⬅️ Back",callback_data:"x:home"},{text:"❌ Cancel",callback_data:"x:cancel"}]]};}
`);
  src=replaceBetween(src,"/* =========================\n   KEYBOARDS\n========================= */","/* =========================\n   FLOW\n========================= */",kb);
  return src;
}

function patchMenus(src){
  const home=bt(String.raw`async function showHome(chatId,userId){const plan=await getPlan(userId);const credits=await getCredits(userId);return sendMessage(chatId,__BT__🚀 PIXLEMORPHIC AI\\n\\nPremium AI Creation Studio\\n\\n💳 Plan: ${plan.toUpperCase()}\\n⚡ Credits: ${credits}\\n\\nChoose your studio:__BT__,{reply_markup:homeKeyboard()});}
`);
  src=replaceBetween(src,"async function showHome(","async function showImageMenu(",home+"async function showImageMenu(");
  const image=bt(String.raw`async function showImageMenu(chatId,userId){await setFlow(userId,{step:"choose_model"});return sendMessage(chatId,__BT__🖼️ IMAGE STUDIO\\n\\nSelect an engine.\\n\\n🟢 LIVE = ready to generate\\n🟡 COMING SOON = not yet enabled__BT__,{reply_markup:imageKeyboard()});}
`);
  src=replaceBetween(src,"async function showImageMenu(","async function showVideoMenu(",image+"async function showVideoMenu(");
  const video=bt(String.raw`async function showVideoMenu(chatId,userId){await clearFlow(userId);return sendMessage(chatId,__BT__🎬 VIDEO STUDIO\\n\\nUpcoming generation engines\\n\\n🎚️ Quality: 480p • 580p • 720p • 1080p • 4K\\n⏱️ Duration: 5s • 8s • 10s • 15s\\n🎞️ Frame rate: 24 • 30 FPS\\n📐 Ratio: 16:9 • 9:16 • 1:1 • 4:3 • 3:4 • 21:9\\n🔊 Audio: model dependent\\n\\n🚧 Video generation is COMING SOON. Controls are preview-only and never consume credits.__BT__,{reply_markup:videoKeyboard()});}
`);
  return replaceBetween(src,"async function showVideoMenu(","async function cmdCredits(",video+"async function cmdCredits(");
}

function patchCallbacks(src){
  const marker="\n  if (\n    data.startsWith(\"m:\")";
  if(src.includes('data.startsWith("soon:")')) return src;
  const ins=bt(String.raw`
  if(data.startsWith("soon:")){return sendMessage(chatId,__BT__🟡 COMING SOON\\n\\nThis model is listed in the catalog but is not enabled yet. No credits were charged.__BT__,{reply_markup:imageKeyboard()});}
  if(data==="v:soon"){return sendMessage(chatId,__BT__🟡 VIDEO — COMING SOON\\n\\nProvider integration and cost testing are still pending. No credits were charged.__BT__,{reply_markup:videoKeyboard()});}
  if(data==="v:quality"){return sendMessage(chatId,__BT__🎚️ VIDEO QUALITY\\n\\n480p • Economy\\n580p • Economy+\\n720p • Standard\\n1080p • High\\n4K • Premium__BT__,{reply_markup:videoKeyboard()});}
  if(data==="v:duration"){return sendMessage(chatId,__BT__⏱️ DURATION\\n\\n5s • Trial-safe\\n8s • Standard\\n10s • Cinematic\\n15s • Premium__BT__,{reply_markup:videoKeyboard()});}
  if(data==="v:fps"){return sendMessage(chatId,__BT__🎞️ FPS\\n\\n24 FPS • Cinematic\\n30 FPS • Smooth__BT__,{reply_markup:videoKeyboard()});}
  if(data==="v:audio"){return sendMessage(chatId,__BT__🔊 AUDIO\\n\\nON • Native audio where supported\\nOFF • Silent__BT__,{reply_markup:videoKeyboard()});}
  if(data.startsWith("v:ratio:")){return sendMessage(chatId,__BT__📐 FRAME RATIO\\n\\nSelected: ${data.slice(8)}__BT__,{reply_markup:videoKeyboard()});}
`);
  if(src.indexOf(marker)<0) throw new Error("Callback marker missing");
  return src.replace(marker,"\n"+ins+marker);
}

function patchModelsText(src){
  const start="async function cmdModels(";
  const end="/* =========================\n   GENERATION\n========================= */";
  const block=bt(String.raw`async function cmdModels(chatId,userId){const plan=await getPlan(userId);return sendMessage(chatId,__BT__✨ PIXLEMORPHIC MODEL CATALOG\\n\\n🟢 LIVE NOW\\n🎬 Pixlemeta Cinematic\\n📸 Pixlemeta Realism\\n🟪 Pixlemeta Ultra 8K\\n✏️ Pixlemeta EDIT — Kontext Pro\\n🍌 Nano Banana 2\\n🍌 Nano Banana Pro\\n🧠 GPT Image 2\\n🌱 Seedream 4.0\\n⚡ FLUX.1 [dev]\\n\\n🎬 VIDEO — COMING SOON\\nSeedance 2.0 Fast • Seedance 2.0 • Seedance 2.5\\nKling 2.5 Turbo Pro • WAN 2.2 • Veo 3.1\\n\\nPlan: ${plan.toUpperCase()}__BT__,{reply_markup:homeKeyboard()});}
`);
  return replaceBetween(src,start,end,block+end);
}

try {
  source=activateEdit(source);
  source=activateModels(source);
  source=addFalEngines(source);
  source=patchRouter(source);
  source=patchInference(source);
  source=patchUI(source);
  source=patchMenus(source);
  source=patchModelsText(source);
  source=patchCallbacks(source);
  fs.writeFileSync(indexPath,source,"utf8");
  console.log("Bootstrap: Pixlemeta EDIT + FAL image stack + studio UI activated");
  require(indexPath);
} catch(error) {
  console.error("Bootstrap failed:",error);
  process.exit(1);
}
