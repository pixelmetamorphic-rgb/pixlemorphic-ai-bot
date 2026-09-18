"use strict";
const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "index.js");
let source = fs.readFileSync(indexPath, "utf8");

function activateEdit(src) {
  if (src.includes('fal-ai/flux-pro/kontext') && src.includes('command === "/edit"')) {
    return src;
  }

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

  src = src
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

  fs.writeFileSync(indexPath, src, "utf8");
  console.log("Bootstrap: SHARK -> Pixlemeta EDIT / Kontext Pro activated");
  return src;
}

activateEdit(source);
require(indexPath);
