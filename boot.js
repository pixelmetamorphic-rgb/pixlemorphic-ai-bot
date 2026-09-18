"use strict";
const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "index.js");
let source = fs.readFileSync(indexPath, "utf8");

function replaceBetween(src, startMarker, endMarker, replacement) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Bootstrap marker missing: ${startMarker}`);
  }
  return src.slice(0, start) + replacement + src.slice(end);
}

function activateEdit(src) {
  if (!src.includes('fal-ai/flux-pro/kontext')) {
    const modelStart = src.indexOf("\n  shark: {");
    const modelEnd = modelStart >= 0 ? src.indexOf("\n  }\n};", modelStart) : -1;

    if (modelStart < 0 || modelEnd < 0) {
      throw new Error("Could not locate legacy SHARK model block");
    }

    const editModel = `
  edit: {
    key: "edit",
    label: "✏️ Pixlemeta EDIT (Premium Edit)",
    type: "i2i",
    qualities: {
      "2k": { cost: 15 },
      "4k": { cost: 25 },
      "8k": { cost: 45 }
    },
    engines: {
      primary: "kontext_pro_edit",
      backup: null
    }
  }`;

    src = src.slice(0, modelStart) + editModel + src.slice(modelEnd + "\n  }".length);
  }

  return src
    .replace(/shark_v1_edit/g, "kontext_pro_edit")
    .replace(/sharkV1EditPipeline/g, "kontextProEditPipeline")
    .replace(/fal-ai\/flux\/dev\/image-to-image/g, "fal-ai/flux-pro/kontext")
    .replace(/"SHARK V1 returned no image"/g, '"Pixlemeta EDIT returned no image"')
    .replace(/\n  if \(qualityKey === "8k"\) \{\n    url = await falTopazUpscale\(\n      url,\n      4\n    \);\n  \}\n/g, "\n")
    .replace(/"shark"/g, '"edit"')
    .replace(/`shark:\$\{userId\}:image`/g, '`edit:${userId}:image`')
    .replace(/\/shark/g, "/edit")
    .replace(/cmdShark/g, "cmdEdit")
    .replace(/SHARK V1/g, "PIXLEMETA EDIT")
    .replace(/🦈/g, "✏️")
    .replace(/PHOTO \/ SHARK/g, "PHOTO / EDIT");
}

function upgradeUI(src) {
  const keyboardBlock = `/* =========================
   KEYBOARDS
========================= */

function homeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🖼️ IMAGE STUDIO", callback_data: "mode:image" },
        { text: "🎬 VIDEO STUDIO", callback_data: "mode:video" }
      ],
      [
        { text: "✨ MODELS", callback_data: "home:models" },
        { text: "💳 CREDITS", callback_data: "home:credits" }
      ]
    ]
  };
}

function imageKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🎬 Pixlemeta Cinematic", callback_data: "m:cinematic" }
      ],
      [
        { text: "📸 Pixlemeta Realism", callback_data: "m:realism" }
      ],
      [
        { text: "🟪 Pixlemeta Ultra 8K", callback_data: "m:ultra8k" }
      ],
      [
        { text: "✏️ Pixlemeta EDIT", callback_data: "m:edit" }
      ],
      [
        { text: "🍌 Nano Banana 2 • COMING SOON", callback_data: "soon:nano2" }
      ],
      [
        { text: "🧠 GPT Image 2 • COMING SOON", callback_data: "soon:gpt2" }
      ],
      [
        { text: "🌱 Seedream 4.0 • COMING SOON", callback_data: "soon:seedream4" }
      ],
      [
        { text: "⚡ FLUX.1 [dev] • COMING SOON", callback_data: "soon:fluxdev" }
      ],
      [
        { text: "⬅️ Back", callback_data: "x:home" },
        { text: "❌ Cancel", callback_data: "x:cancel" }
      ]
    ]
  };
}

function qualityKeyboard(modelKey) {
  const model = MODELS[modelKey];
  const buttons = Object.keys(model.qualities).map((q) => ({
    text: `${q.toUpperCase()} • ${model.qualities[q].cost} credits`,
    callback_data: `q:${modelKey}:${q}`
  }));

  return {
    inline_keyboard: [
      buttons,
      [
        { text: "⬅️ Back", callback_data: "x:back_models" },
        { text: "❌ Cancel", callback_data: "x:cancel" }
      ]
    ]
  };
}

function ratioKeyboard(modelKey, qualityKey) {
  return {
    inline_keyboard: [
      [
        { text: "1:1", callback_data: `r:${modelKey}:${qualityKey}:sq` },
        { text: "4:5", callback_data: `r:${modelKey}:${qualityKey}:45` }
      ],
      [
        { text: "3:4", callback_data: `r:${modelKey}:${qualityKey}:34` },
        { text: "16:9", callback_data: `r:${modelKey}:${qualityKey}:169` }
      ],
      [
        { text: "9:16", callback_data: `r:${modelKey}:${qualityKey}:916` }
      ],
      [
        { text: "⬅️ Back", callback_data: "x:back_quality" },
        { text: "❌ Cancel", callback_data: "x:cancel" }
      ]
    ]
  };
}

function videoKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "⚡ Seedance 2.0 Fast • SOON", callback_data: "v:soon" },
        { text: "🎞️ Seedance 2.0 • SOON", callback_data: "v:soon" }
      ],
      [
        { text: "🔥 Seedance 2.5 • SOON", callback_data: "v:soon" },
        { text: "🎥 Kling 2.5 Turbo Pro • SOON", callback_data: "v:soon" }
      ],
      [
        { text: "🌊 WAN 2.2 • SOON", callback_data: "v:soon" },
        { text: "🟢 Veo 3.1 • SOON", callback_data: "v:soon" }
      ],
      [
        { text: "🎚️ VIDEO QUALITY", callback_data: "v:quality" },
        { text: "⏱️ DURATION", callback_data: "v:duration" }
      ],
      [
        { text: "16:9", callback_data: "v:ratio:16:9" },
        { text: "9:16", callback_data: "v:ratio:9:16" },
        { text: "1:1", callback_data: "v:ratio:1:1" }
      ],
      [
        { text: "4:3", callback_data: "v:ratio:4:3" },
        { text: "3:4", callback_data: "v:ratio:3:4" },
        { text: "21:9", callback_data: "v:ratio:21:9" }
      ],
      [
        { text: "🖼️ IMAGE → VIDEO • SOON", callback_data: "v:soon" }
      ],
      [
        { text: "⬅️ Back", callback_data: "x:home" },
        { text: "❌ Cancel", callback_data: "x:cancel" }
      ]
    ]
  };
}

`;

  src = replaceBetween(
    src,
    "/* =========================\n   KEYBOARDS\n========================= */",
    "/* =========================\n   FLOW\n========================= */",
    keyboardBlock
  );

  const homeBlock = `async function showHome(chatId, userId) {
  const plan = await getPlan(userId);
  const credits = await getCredits(userId);

  return sendMessage(
    chatId,
    ` + "`" + `🚀 PIXLEMORPHIC AI\n\n` + "`" + `" +
      ` + "`" + `Premium AI Creation Studio\n\n` + "`" + `" +
      ` + "`" + `💳 Plan: ${plan.toUpperCase()}\n` + "`" + `" +
      ` + "`" + `⚡ Credits: ${credits}\n\n` + "`" + `" +
      ` + "`" + `Choose your studio:` + "`" + `,
    { reply_markup: homeKeyboard() }
  );
}

`;

  src = replaceBetween(
    src,
    "async function showHome(",
    "async function showImageMenu(",
    homeBlock + "async function showImageMenu("
  );

  const imageMenuBlock = `async function showImageMenu(chatId, userId) {
  await setFlow(userId, { step: "choose_model" });

  return sendMessage(
    chatId,
    ` + "`" + `🖼️ IMAGE STUDIO\n\n` + "`" + `" +
      ` + "`" + `Select an engine.\n\n` + "`" + `" +
      ` + "`" + `🟢 LIVE = available now\n` + "`" + `" +
      ` + "`" + `🟡 SOON = integration scheduled` + "`" + `,
    { reply_markup: imageKeyboard() }
  );
}

`;

  src = replaceBetween(
    src,
    "async function showImageMenu(",
    "async function showVideoMenu(",
    imageMenuBlock + "async function showVideoMenu("
  );

  const videoMenuBlock = `async function showVideoMenu(chatId, userId) {
  await clearFlow(userId);

  return sendMessage(
    chatId,
    ` + "`" + `🎬 VIDEO STUDIO\n\n` + "`" + `" +
      ` + "`" + `Choose your upcoming engine and preview the controls below.\n\n` + "`" + `" +
      ` + "`" + `🎚️ Quality: 480p • 580p • 720p • 1080p • 4K\n` + "`" + `" +
      ` + "`" + `⏱️ Duration: 5s • 8s • 10s • 15s\n` + "`" + `" +
      ` + "`" + `🎞️ Frame: 24 • 30 FPS\n` + "`" + `" +
      ` + "`" + `📐 Ratio: 16:9 • 9:16 • 1:1 • 4:3 • 3:4 • 21:9\n\n` + "`" + `" +
      ` + "`" + `🚧 Video generation is being integrated. No credits are consumed by these preview controls.` + "`" + `,
    { reply_markup: videoKeyboard() }
  );
}

`;

  src = replaceBetween(
    src,
    "async function showVideoMenu(",
    "async function cmdCredits(",
    videoMenuBlock + "async function cmdCredits("
  );

  const modelsBlock = `async function cmdModels(chatId, userId) {
  const plan = await getPlan(userId);

  const text =
    ` + "`" + `✨ PIXLEMORPHIC MODEL CATALOG\n\n` + "`" + `" +
    ` + "`" + `🟢 LIVE NOW\n` + "`" + `" +
    ` + "`" + `🎬 Pixlemeta Cinematic\n` + "`" + `" +
    ` + "`" + `📸 Pixlemeta Realism\n` + "`" + `" +
    ` + "`" + `🟪 Pixlemeta Ultra 8K\n` + "`" + `" +
    ` + "`" + `✏️ Pixlemeta EDIT — Kontext Pro\n\n` + "`" + `" +
    ` + "`" + `🟡 COMING SOON\n` + "`" + `" +
    ` + "`" + `🍌 Nano Banana 2\n` + "`" + `" +
    ` + "`" + `🧠 GPT Image 2\n` + "`" + `" +
    ` + "`" + `🌱 Seedream 4.0\n` + "`" + `" +
    ` + "`" + `⚡ FLUX.1 [dev]\n` + "`" + `" +
    ` + "`" + `🎬 Seedance 2.0 / 2.5\n` + "`" + `" +
    ` + "`" + `🎥 Kling 2.5 Turbo Pro\n` + "`" + `" +
    ` + "`" + `🌊 WAN 2.2\n` + "`" + `" +
    ` + "`" + `🟢 Veo 3.1\n\n` + "`" + `" +
    ` + "`" + `Plan: ${plan.toUpperCase()}` + "`" + `;

  return sendMessage(chatId, text, { reply_markup: homeKeyboard() });
}

`;

  src = replaceBetween(
    src,
    "async function cmdModels(",
    "/* =========================\n   GENERATION\n========================= */",
    modelsBlock + "/* =========================\n   GENERATION\n========================= */"
  );

  const callbackMarker = "\n  if (\n    data.startsWith(\"m:\")";
  const callbackInsert = `
  if (data.startsWith("soon:")) {
    return sendMessage(
      chatId,
      "🟡 COMING SOON\\n\\nThis model is already listed in the new UI. Its provider integration is scheduled next. No credits were charged.",
      { reply_markup: imageKeyboard() }
    );
  }

  if (data === "v:soon") {
    return sendMessage(
      chatId,
      "🟡 VIDEO MODEL — COMING SOON\\n\\nThe model is visible now, but generation is intentionally disabled until its provider integration and credit-cost test are completed.",
      { reply_markup: videoKeyboard() }
    );
  }

  if (data === "v:quality") {
    return sendMessage(
      chatId,
      "🎚️ VIDEO QUALITY\\n\\n480p • Economy\\n580p • Economy+\\n720p • Standard\\n1080p • High\\n4K • Premium\\n\\nThese are UI controls only until video generation is activated.",
      { reply_markup: videoKeyboard() }
    );
  }

  if (data === "v:duration") {
    return sendMessage(
      chatId,
      "⏱️ VIDEO DURATION\\n\\n5s • Trial-safe\\n8s • Standard\\n10s • Cinematic\\n15s • Premium\\n\\nFinal limits will be enforced by the video backend when each model is integrated.",
      { reply_markup: videoKeyboard() }
    );
  }

  if (data.startsWith("v:ratio:")) {
    const ratio = data.slice("v:ratio:".length);
    return sendMessage(
      chatId,
      `📐 FRAME RATIO\\n\\nSelected: ${ratio}\\n\\nThis is a preview selection. The final provider-specific validation will happen when video generation is enabled.`,
      { reply_markup: videoKeyboard() }
    );
  }
`;

  if (src.indexOf(callbackMarker) < 0) {
    throw new Error("Callback insertion marker missing");
  }
  src = src.replace(callbackMarker, callbackInsert + callbackMarker);

  return src;
}

try {
  source = activateEdit(source);
  source = upgradeUI(source);
  fs.writeFileSync(indexPath, source, "utf8");
  console.log("Bootstrap: Pixlemeta EDIT + premium Image/Video UI activated");
  require(indexPath);
} catch (error) {
  console.error("Bootstrap failed:", error);
  process.exit(1);
}
