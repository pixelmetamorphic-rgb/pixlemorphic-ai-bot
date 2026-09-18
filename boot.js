"use strict";
const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "index.js");
let source = fs.readFileSync(indexPath, "utf8");

if (!(source.includes('key: "edit"') && source.includes('fal-ai/flux-pro/kontext') && source.includes('command === "/edit"'))) {
  const modelPattern = /  shark: \{.*?\n  \}\n};/s;
  const modelReplacement = `  edit: {
    key: "edit",
    label:
      "✏️ Pixlemeta EDIT (Premium Edit)",
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
  }
};`;

  const replaced = source.replace(modelPattern, modelReplacement);
  if (replaced === source) {
    throw new Error("Legacy SHARK model block not found");
  }
  source = replaced;
  source = source.replace(/shark_v1_edit/g, "kontext_pro_edit");
  source = source.replace(/sharkV1EditPipeline/g, "kontextProEditPipeline");
  source = source.replace(/fal-ai\/flux\/dev\/image-to-image/g, "fal-ai/flux-pro/kontext");
  source = source.replace(/"SHARK V1 returned no image"/g, '"Pixlemeta EDIT returned no image"');
  source = source.replace(/\n  if \(qualityKey === "8k"\) \{\n    url = await falTopazUpscale\(\n      url,\n      4\n    \);\n  \}\n/g, "\n");
  source = source.replace(/"shark"/g, '"edit"');
  source = source.replace(/`shark:\$\{userId\}:image`/g, '`edit:${userId}:image`');
  source = source.replace(/\/shark/g, "/edit");
  source = source.replace(/cmdShark/g, "cmdEdit");
  source = source.replace(/SHARK V1/g, "PIXLEMETA EDIT");
  source = source.replace(/🦈/g, "✏️");
  source = source.replace(/PHOTO \/ SHARK/g, "PHOTO / EDIT");
  fs.writeFileSync(indexPath, source, "utf8");
  console.log("Bootstrap: SHARK replaced with Pixlemeta EDIT / Kontext Pro");
} else {
  console.log("Bootstrap: Pixlemeta EDIT / Kontext Pro already active");
}

require(indexPath);
