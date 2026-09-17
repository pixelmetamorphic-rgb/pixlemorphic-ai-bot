"use strict";

require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const Redis = require("ioredis");

const app = express();
app.use(express.json({ limit: "4mb" }));
app.disable("x-powered-by");

/* =========================
   ENV
========================= */

const TG_TOKEN = process.env.TG_TOKEN;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const FAL_API_KEY =
  process.env.FAL_API_KEY || process.env.FAL_KEY;
const REDIS_URL = process.env.REDIS_URL;
const TG_SECRET_TOKEN =
  process.env.TG_SECRET_TOKEN || "";
const PORT = parseInt(
  process.env.PORT || "8080",
  10
);

const ADMIN_ID = "1078816855";

const FAL_FLUX_PRO_MODEL =
  process.env.FAL_FLUX_PRO_MODEL ||
  "fal-ai/flux-pro/v1.1-ultra";

const REPLICATE_SDXL_VERSION =
  "39ed52f2a78e934b3ba6f1f50c7b07c7a1c77d9b29b19a70c2b6c38b1f86c7c5";

const MAX_PROMPT_LEN = 900;
const BUSY_LOCK_SECONDS = 180;

const GLOBAL_GEN_LIMIT = parseInt(
  process.env.GLOBAL_GEN_LIMIT || "3",
  10
);

const TG_MIN_GAP_MS = parseInt(
  process.env.TG_MIN_GAP_MS || "70",
  10
);

/* =========================
   REDIS
========================= */

let redis = null;

if (REDIS_URL) {
  redis = new Redis(REDIS_URL);

  redis.on("connect", () => {
    console.log("Redis connected");
  });

  redis.on("ready", () => {
    console.log("Redis ready");
  });

  redis.on("error", (err) => {
    console.error(
      "Redis error:",
      err.message
    );
  });
} else {
  console.warn("REDIS_URL missing");
}

/* =========================
   PLANS
========================= */

const PLAN_DEFAULT_CREDITS = {
  trial: 40,
  promo: 100,
  paid: 1200,
  admin: 999999999
};

/* =========================
   MODELS
========================= */

const MODELS = {
  cinematic: {
    key: "cinematic",
    label: "🎬 Pixlemeta Cinematic",
    type: "t2i",
    qualities: {
      "2k": {
        cost: 2
      },
      "4k": {
        cost: 4
      }
    },
    engines: {
      primary: "fal_schnell",
      backup: null
    }
  },

  realism: {
    key: "realism",
    label:
      "📸 Pixlemeta Realism (DSLR)",
    type: "t2i",
    qualities: {
      "2k": {
        cost: 6
      },
      "4k": {
        cost: 15
      }
    },
    engines: {
      primary:
        "fal_flux_ultra_realism",
      backup: "replicate_sdxl"
    }
  },

  ultra8k: {
    key: "ultra8k",
    label:
      "🟪 Pixlemeta Ultra 8K (True)",
    type: "t2i",
    qualities: {
      "8k": {
        cost: 30
      }
    },
    engines: {
      primary: "fal_flux_pro_8k",
      backup: null
    }
  },

  shark: {
    key: "shark",
    label:
      "🦈 Pixlemeta SHARK V1 (Premium Edit)",
    type: "i2i",
    qualities: {
      "2k": {
        cost: 15
      },
      "4k": {
        cost: 25
      },
      "8k": {
        cost: 45
      }
    },
    engines: {
      primary: "shark_v1_edit",
      backup: null
    }
  }
};

const PLAN_ACCESS = {
  trial: new Set([
    "cinematic",
    "realism"
  ]),
  promo: new Set(
    Object.keys(MODELS)
  ),
  paid: new Set(
    Object.keys(MODELS)
  ),
  admin: new Set(
    Object.keys(MODELS)
  )
};

/* =========================
   ASPECT RATIOS
========================= */

const RATIOS = {
  sq: {
    id: "sq",
    label: "1:1",
    width: 1024,
    height: 1024,
    ultraAspect: "1:1",
    exact: true
  },

  "45": {
    id: "45",
    label: "4:5",
    width: 1024,
    height: 1280,
    ultraAspect: "3:4",
    exact: false
  },

  "34": {
    id: "34",
    label: "3:4",
    width: 1024,
    height: 1365,
    ultraAspect: "3:4",
    exact: true
  },

  "169": {
    id: "169",
    label: "16:9",
    width: 1280,
    height: 720,
    ultraAspect: "16:9",
    exact: true
  },

  "916": {
    id: "916",
    label: "9:16",
    width: 720,
    height: 1280,
    ultraAspect: "9:16",
    exact: true
  }
};

/* =========================
   BASIC HELPERS
========================= */

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

function safeInt(
  value,
  fallback = 0
) {
  const n = parseInt(
    value,
    10
  );

  return Number.isFinite(n)
    ? n
    : fallback;
}

function clampPrompt(
  text,
  maxLen = MAX_PROMPT_LEN
) {
  return String(
    text || ""
  )
    .trim()
    .slice(0, maxLen);
}

function isAdmin(userId) {
  return (
    String(userId) === ADMIN_ID
  );
}

/* =========================
   REDIS HELPERS
========================= */

async function rGet(key) {
  if (!redis) {
    throw new Error(
      "Redis is not configured"
    );
  }

  return redis.get(key);
}

async function rSet(
  key,
  value,
  ttl = null
) {
  if (!redis) {
    throw new Error(
      "Redis is not configured"
    );
  }

  if (ttl) {
    return redis.set(
      key,
      value,
      "EX",
      ttl
    );
  }

  return redis.set(
    key,
    value
  );
}

async function rDel(key) {
  if (!redis) {
    throw new Error(
      "Redis is not configured"
    );
  }

  return redis.del(key);
}

async function rIncr(key) {
  if (!redis) {
    throw new Error(
      "Redis is not configured"
    );
  }

  return redis.incr(key);
}

/* =========================
   USER / PLAN
========================= */

async function getPlan(
  userId
) {
  if (isAdmin(userId)) {
    return "admin";
  }

  const plan =
    await rGet(
      `u:${userId}:plan`
    );

  if (
    plan === "trial" ||
    plan === "promo" ||
    plan === "paid" ||
    plan === "admin"
  ) {
    return plan;
  }

  return "trial";
}

async function setPlan(
  userId,
  plan
) {
  if (
    !PLAN_DEFAULT_CREDITS[
      plan
    ]
  ) {
    throw new Error(
      "Invalid plan"
    );
  }

  await rSet(
    `u:${userId}:plan`,
    plan
  );

  await rSet(
    `u:${userId}:credits`,
    PLAN_DEFAULT_CREDITS[
      plan
    ]
  );
}

async function getCredits(
  userId
) {
  if (isAdmin(userId)) {
    return Infinity;
  }

  const value =
    await rGet(
      `u:${userId}:credits`
    );

  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  return Number(value);
}

async function ensureUser(
  userId
) {
  if (isAdmin(userId)) {
    await rSet(
      `u:${userId}:plan`,
      "admin"
    );

    return;
  }

  const existingPlan =
    await rGet(
      `u:${userId}:plan`
    );

  if (!existingPlan) {
    await rSet(
      `u:${userId}:plan`,
      "trial"
    );

    await rSet(
      `u:${userId}:credits`,
      PLAN_DEFAULT_CREDITS.trial
    );
  } else {
    const existingCredits =
      await rGet(
        `u:${userId}:credits`
      );

    if (
      existingCredits === null
    ) {
      await rSet(
        `u:${userId}:credits`,
        PLAN_DEFAULT_CREDITS[
          existingPlan
        ] || 0
      );
    }
  }
}

async function addCredits(
  userId,
  amount
) {
  const current =
    await getCredits(userId);

  if (current === Infinity) {
    return true;
  }

  await rSet(
    `u:${userId}:credits`,
    Math.max(
      0,
      current + amount
    )
  );

  return true;
}

async function deductCredits(
  userId,
  amount
) {
  if (isAdmin(userId)) {
    return true;
  }

  if (!redis) {
    throw new Error(
      "Redis is not configured"
    );
  }

  const key =
    `u:${userId}:credits`;

  const current =
    await getCredits(userId);

  if (
    current < amount
  ) {
    return false;
  }

  const result =
    await redis.eval(
      `
      local current =
        tonumber(redis.call(
          "GET",
          KEYS[1]
        ) or "0")

      local cost =
        tonumber(ARGV[1])

      if current < cost then
        return 0
      end

      redis.call(
        "DECRBY",
        KEYS[1],
        cost
      )

      return 1
      `,
      1,
      key,
      amount
    );

  return Number(result) === 1;
}

/* =========================
   BAN SYSTEM
========================= */

async function isBanned(
  userId
) {
  const value =
    await rGet(
      `u:${userId}:banned`
    );

  return value === "1";
}

async function setBan(
  userId,
  banned
) {
  if (banned) {
    await rSet(
      `u:${userId}:banned`,
      "1"
    );
  } else {
    await rDel(
      `u:${userId}:banned`
    );
  }
}

/* =========================
   ACCESS / MODEL HELPERS
========================= */

function isValidModel(
  modelKey
) {
  return Boolean(
    MODELS[modelKey]
  );
}

function isValidQuality(
  modelKey,
  qualityKey
) {
  return Boolean(
    MODELS[modelKey]?.qualities[
      qualityKey
    ]
  );
}

function getCost(
  modelKey,
  qualityKey
) {
  if (
    !isValidQuality(
      modelKey,
      qualityKey
    )
  ) {
    return null;
  }

  return MODELS[
    modelKey
  ].qualities[
    qualityKey
  ].cost;
}

function modelLabel(
  modelKey
) {
  return (
    MODELS[modelKey]?.label ||
    modelKey
  );
}

function qualityLabel(
  modelKey,
  qualityKey
) {
  const q =
    MODELS[
      modelKey
    ]?.qualities[
      qualityKey
    ];

  if (!q) {
    return qualityKey;
  }

  return qualityKey.toUpperCase();
}

function getRatio(
  ratioKey
) {
  return (
    RATIOS[ratioKey] ||
    RATIOS.sq
  );
}

async function canAccess(
  userId,
  modelKey
) {
  const plan =
    await getPlan(userId);

  return Boolean(
    PLAN_ACCESS[
      plan
    ]?.has(modelKey)
  );
}

/* =========================
   RATE LIMIT
========================= */

async function rateLimit(
  userId
) {
  if (!redis) {
    return true;
  }

  const key =
    `rate:${userId}`;

  const exists =
    await redis.get(key);

  if (exists) {
    return false;
  }

  await redis.set(
    key,
    "1",
    "PX",
    TG_MIN_GAP_MS
  );

  return true;
}

/* =========================
   BUSY LOCK
========================= */

async function acquireBusy(
  userId
) {
  if (!redis) {
    return true;
  }

  const result =
    await redis.set(
      `busy:${userId}`,
      "1",
      "NX",
      "EX",
      BUSY_LOCK_SECONDS
    );

  return result === "OK";
}

async function releaseBusy(
  userId
) {
  if (!redis) {
    return;
  }

  await redis.del(
    `busy:${userId}`
  );
}

/* =========================
   GLOBAL GENERATION LIMIT
========================= */

async function acquireGlobalSlot() {
  if (!redis) {
    return true;
  }

  const key =
    "global:generation";

  const count =
    await redis.incr(key);

  await redis.expire(
    key,
    300
  );

  if (
    count >
    GLOBAL_GEN_LIMIT
  ) {
    await redis.decr(
      key
    );

    return false;
  }

  return true;
}

async function releaseGlobalSlot() {
  if (!redis) {
    return;
  }

  const key =
    "global:generation";

  const value =
    await redis.decr(key);

  if (value <= 0) {
    await redis.del(key);
  }
}

/* =========================
   TELEGRAM API
========================= */

async function telegramRequest(
  method,
  body
) {
  if (!TG_TOKEN) {
    throw new Error(
      "TG_TOKEN is not configured"
    );
  }

  const url =
    `https://api.telegram.org/bot${TG_TOKEN}/${method}`;

  for (
    let attempt = 0;
    attempt < 4;
    attempt++
  ) {
    const response =
      await fetch(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify(
            body
          )
        }
      );

    const data =
      await response.json();

    if (
      response.status === 429
    ) {
      const retryAfter =
        data?.parameters
          ?.retry_after || 1;

      await sleep(
        retryAfter * 1000
      );

      continue;
    }

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        `Telegram ${method} failed: ` +
        JSON.stringify(data)
      );
    }

    return data.result;
  }

  throw new Error(
    `Telegram ${method} rate limited`
  );
}

async function sendMessage(
  chatId,
  text,
  extra = {}
) {
  return telegramRequest(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      ...extra
    }
  );
}

async function sendPhoto(
  chatId,
  photo,
  caption = ""
) {
  return telegramRequest(
    "sendPhoto",
    {
      chat_id: chatId,
      photo,
      caption
    }
  );
}

async function sendDocument(
  chatId,
  document,
  caption = ""
) {
  return telegramRequest(
    "sendDocument",
    {
      chat_id: chatId,
      document,
      caption
    }
  );
}

async function answerCallbackQuery(
  callbackQueryId
) {
  return telegramRequest(
    "answerCallbackQuery",
    {
      callback_query_id:
        callbackQueryId
    }
  );
}

async function tgGetFileUrl(
  fileId
) {
  const file =
    await telegramRequest(
      "getFile",
      {
        file_id: fileId
      }
    );

  if (!file?.file_path) {
    throw new Error(
      "Telegram file path missing"
    );
  }

  return (
    `https://api.telegram.org/file/bot` +
    `${TG_TOKEN}/${file.file_path}`
  );
}

/* =========================
   FAL
========================= */

async function falRun(
  model,
  input
) {
  if (!FAL_API_KEY) {
    throw new Error(
      "FAL_API_KEY is not configured"
    );
  }

  const url =
    `https://fal.run/${model}`;

  const response =
    await fetch(
      url,
      {
        method: "POST",
        headers: {
          Authorization:
            `Key ${FAL_API_KEY}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(
          input
        )
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    throw new Error(
      `FAL ${response.status}: ` +
      JSON.stringify(data)
    );
  }

  return data;
}

function pickFirstImageUrl(
  data
) {
  if (
    data?.images &&
    Array.isArray(
      data.images
    ) &&
    data.images[0]
  ) {
    return (
      data.images[0].url ||
      data.images[0].image_url ||
      data.images[0]
    );
  }

  if (
    data?.image?.url
  ) {
    return data.image.url;
  }

  if (
    data?.output?.images &&
    Array.isArray(
      data.output.images
    ) &&
    data.output.images[0]
  ) {
    return (
      data.output.images[0].url ||
      data.output.images[0]
    );
  }

  if (
    typeof data?.url ===
    "string"
  ) {
    return data.url;
  }

  return null;
}

/* =========================
   PROMPT BUILDER
========================= */

function buildPrompt(
  prompt
) {
  const clean =
    clampPrompt(prompt);

  if (!clean) {
    return "";
  }

  return clean;
}

/* =========================
   RATIO INFERENCE
========================= */

function inferRatioFromText(
  text
) {
  const lower =
    String(
      text || ""
    ).toLowerCase();

  if (
    lower.includes("9:16") ||
    lower.includes(
      "vertical"
    ) ||
    lower.includes(
      "portrait ratio"
    )
  ) {
    return "916";
  }

  if (
    lower.includes("16:9") ||
    lower.includes(
      "landscape"
    ) ||
    lower.includes(
      "cinematic wide"
    )
  ) {
    return "169";
  }

  if (
    lower.includes("4:5")
  ) {
    return "45";
  }

  if (
    lower.includes("3:4")
  ) {
    return "34";
  }

  return "sq";
}

/* =========================
   MODEL / QUALITY INFERENCE
========================= */

function inferModelQualityFromText(
  text
) {
  const lower =
    String(
      text || ""
    ).toLowerCase();

  let modelKey =
    "cinematic";

  let qualityKey =
    "2k";

  if (
    lower.includes(
      "realism"
    ) ||
    lower.includes(
      "realistic"
    ) ||
    lower.includes(
      "dslr"
    )
  ) {
    modelKey =
      "realism";
  }

  if (
    lower.includes(
      "ultra 8k"
    ) ||
    lower.includes(
      "8k"
    )
  ) {
    modelKey =
      "ultra8k";
    qualityKey =
      "8k";
  }

  if (
    lower.includes(
      "shark"
    )
  ) {
    modelKey =
      "shark";
  }

  if (
    lower.includes(
      "4k"
    )
  ) {
    qualityKey =
      "4k";
  }

  return {
    modelKey,
    qualityKey
  };
}

/* =========================
   FAL SCHNELL
========================= */

async function falSchnellGenerate(
  prompt,
  qualityKey,
  ratioKey
) {
  const ratio =
    getRatio(
      ratioKey
    );

  const data =
    await falRun(
      "fal-ai/flux/schnell",
      {
        prompt,
        image_size: {
          width:
            ratio.width,
          height:
            ratio.height
        },
        num_images: 1
      }
    );

  const url =
    pickFirstImageUrl(
      data
    );

  if (!url) {
    throw new Error(
      "FAL Schnell returned no image"
    );
  }

  return {
    url,
    type: "image",
    ratio:
      ratio.label,
    approximate:
      ratioKey === "45"
  };
}

/* =========================
   FAL FLUX ULTRA REALISM
========================= */

async function falFluxUltraRealism(
  prompt,
  qualityKey,
  ratioKey
) {
  const ratio =
    getRatio(
      ratioKey
    );

  const data =
    await falRun(
      "fal-ai/flux-pro/v1.1-ultra",
      {
        prompt,
        aspect_ratio:
          ratio.ultraAspect,
        num_images: 1,
        output_format:
          "jpeg"
      }
    );

  const url =
    pickFirstImageUrl(
      data
    );

  if (!url) {
    throw new Error(
      "FAL Flux Ultra returned no image"
    );
  }

  return {
    url,
    type: "image",
    ratio:
      ratio.label,
    approximate:
      !ratio.exact
  };
}

/* =========================
   FAL FLUX PRO 8K
========================= */

async function falFluxProGenerate8K(
  prompt,
  qualityKey,
  ratioKey
) {
  const ratio =
    getRatio(
      ratioKey
    );

  const data =
    await falRun(
      FAL_FLUX_PRO_MODEL,
      {
        prompt,
        aspect_ratio:
          ratio.ultraAspect,
        num_images: 1,
        output_format:
          "png"
      }
    );

  const url =
    pickFirstImageUrl(
      data
    );

  if (!url) {
    throw new Error(
      "FAL Flux Pro 8K returned no image"
    );
  }

  return {
    url,
    type: "image",
    ratio:
      ratio.label,
    approximate:
      !ratio.exact
  };
}

/* =========================
   TOPAZ UPSCALE
========================= */

async function falTopazUpscale(
  imageUrl,
  scale = 4
) {
  const data =
    await falRun(
      "fal-ai/topaz/upscale/image",
      {
        image_url:
          imageUrl,
        upscale_factor:
          scale
      }
    );

  const url =
    pickFirstImageUrl(
      data
    );

  if (!url) {
    throw new Error(
      "Topaz returned no image"
    );
  }

  return url;
}

/* =========================
   REPLICATE SDXL
========================= */

async function replicateSDXLGenerate(
  prompt
) {
  if (
    !REPLICATE_API_TOKEN
  ) {
    throw new Error(
      "REPLICATE_API_TOKEN is not configured"
    );
  }

  const createResponse =
    await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(
          {
            version:
              REPLICATE_SDXL_VERSION,
            input: {
              prompt
            }
          }
        )
      }
    );

  const prediction =
    await createResponse.json();

  if (
    !createResponse.ok
  ) {
    throw new Error(
      `Replicate ${createResponse.status}: ` +
      JSON.stringify(
        prediction
      )
    );
  }

  const predictionUrl =
    prediction.urls?.get;

  if (!predictionUrl) {
    throw new Error(
      "Replicate polling URL missing"
    );
  }

  for (
    let i = 0;
    i < 90;
    i++
  ) {
    await sleep(2000);

    const response =
      await fetch(
        predictionUrl,
        {
          headers: {
            Authorization:
              `Bearer ${REPLICATE_API_TOKEN}`
          }
        }
      );

    const data =
      await response.json();

    if (
      data.status ===
      "succeeded"
    ) {
      const output =
        data.output;

      if (
        Array.isArray(
          output
        )
      ) {
        return output[0];
      }

      if (
        typeof output ===
        "string"
      ) {
        return output;
      }

      throw new Error(
        "Replicate output missing"
      );
    }

    if (
      data.status ===
        "failed" ||
      data.status ===
        "canceled"
    ) {
      throw new Error(
        data.error ||
        `Replicate ${data.status}`
      );
    }
  }

  throw new Error(
    "Replicate generation timed out"
  );
}
async function sharkV1EditPipeline(
  imageUrl,
  instruction,
  qualityKey
) {
  const prompt =
    clampPrompt(instruction);

  if (!prompt) {
    throw new Error(
      "Edit instruction is empty"
    );
  }

  const data =
    await falRun(
      "fal-ai/flux/dev/image-to-image",
      {
        image_url: imageUrl,
        prompt,
        strength: 0.75,
        num_images: 1
      }
    );

  let url =
    pickFirstImageUrl(data);

  if (!url) {
    throw new Error(
      "SHARK V1 returned no image"
    );
  }

  if (qualityKey === "8k") {
    url = await falTopazUpscale(
      url,
      4
    );
  }

  return {
    url,
    type: "image"
  };
}

/* =========================
   ENGINE ROUTER
========================= */

async function runEngine(
  engine,
  prompt,
  qualityKey,
  ratioKey,
  extra = {}
) {
  switch (engine) {
    case "fal_schnell":
      return falSchnellGenerate(
        prompt,
        qualityKey,
        ratioKey
      );

    case "fal_flux_ultra_realism":
      return falFluxUltraRealism(
        prompt,
        qualityKey,
        ratioKey
      );

    case "fal_flux_pro_8k":
      return falFluxProGenerate8K(
        prompt,
        qualityKey,
        ratioKey
      );

    case "replicate_sdxl": {
      const url =
        await replicateSDXLGenerate(
          prompt
        );

      return {
        url,
        type: "image",
        ratio:
          getRatio(ratioKey).label
      };
    }

    case "shark_v1_edit":
      return sharkV1EditPipeline(
        extra.imageUrl,
        prompt,
        qualityKey
      );

    default:
      throw new Error(
        `Unknown engine: ${engine}`
      );
  }
}

/* =========================
   MODEL GENERATION
========================= */

async function generateWithModel(
  modelKey,
  qualityKey,
  prompt,
  ratioKey = "sq",
  extra = {}
) {
  const model =
    MODELS[modelKey];

  if (!model) {
    throw new Error(
      "Invalid model"
    );
  }

  if (
    !model.qualities[qualityKey]
  ) {
    throw new Error(
      "Invalid quality"
    );
  }

  const finalPrompt =
    buildPrompt(prompt);

  if (!finalPrompt) {
    throw new Error(
      "Prompt is empty"
    );
  }

  const primary =
    model.engines.primary;

  try {
    return await runEngine(
      primary,
      finalPrompt,
      qualityKey,
      ratioKey,
      extra
    );
  } catch (primaryError) {
    console.error(
      "Primary engine failed:",
      primaryError.message
    );

    const backup =
      model.engines.backup;

    if (!backup) {
      throw primaryError;
    }

    console.log(
      `Trying backup engine: ${backup}`
    );

    return runEngine(
      backup,
      finalPrompt,
      qualityKey,
      ratioKey,
      extra
    );
  }
}

/* =========================
   KEYBOARDS
========================= */

function homeKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🖼️ IMAGE",
          callback_data:
            "mode:image"
        },
        {
          text: "🎬 VIDEO",
          callback_data:
            "mode:video"
        }
      ],
      [
        {
          text: "💳 Credits",
          callback_data:
            "home:credits"
        },
        {
          text: "📚 Models",
          callback_data:
            "home:models"
        }
      ]
    ]
  };
}

function imageKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text:
            "🎬 Pixlemeta Cinematic",
          callback_data:
            "m:cinematic"
        }
      ],
      [
        {
          text:
            "📸 Pixlemeta Realism",
          callback_data:
            "m:realism"
        }
      ],
      [
        {
          text:
            "🟪 Pixlemeta Ultra 8K",
          callback_data:
            "m:ultra8k"
        }
      ],
      [
        {
          text:
            "🦈 Pixlemeta SHARK V1",
          callback_data:
            "m:shark"
        }
      ],
      [
        {
          text: "⬅️ Back",
          callback_data:
            "x:home"
        },
        {
          text: "❌ Cancel",
          callback_data:
            "x:cancel"
        }
      ]
    ]
  };
}

function qualityKeyboard(
  modelKey
) {
  const model =
    MODELS[modelKey];

  const buttons =
    Object.keys(
      model.qualities
    ).map(
      (q) => ({
        text:
          `${q.toUpperCase()} • ` +
          `${model.qualities[q].cost} credits`,
        callback_data:
          `q:${modelKey}:${q}`
      })
    );

  return {
    inline_keyboard: [
      buttons,
      [
        {
          text: "⬅️ Back",
          callback_data:
            "x:back_models"
        },
        {
          text: "❌ Cancel",
          callback_data:
            "x:cancel"
        }
      ]
    ]
  };
}

function ratioKeyboard(
  modelKey,
  qualityKey
) {
  return {
    inline_keyboard: [
      [
        {
          text: "1:1",
          callback_data:
            `r:${modelKey}:${qualityKey}:sq`
        },
        {
          text: "4:5",
          callback_data:
            `r:${modelKey}:${qualityKey}:45`
        }
      ],
      [
        {
          text: "3:4",
          callback_data:
            `r:${modelKey}:${qualityKey}:34`
        },
        {
          text: "16:9",
          callback_data:
            `r:${modelKey}:${qualityKey}:169`
        }
      ],
      [
        {
          text: "9:16",
          callback_data:
            `r:${modelKey}:${qualityKey}:916`
        }
      ],
      [
        {
          text: "⬅️ Back",
          callback_data:
            "x:back_quality"
        },
        {
          text: "❌ Cancel",
          callback_data:
            "x:cancel"
        }
      ]
    ]
  };
}

function videoKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "⬅️ Back",
          callback_data:
            "x:home"
        }
      ]
    ]
  };
}

/* =========================
   FLOW
========================= */

async function setFlow(
  userId,
  data
) {
  await rSet(
    `flow:${userId}`,
    JSON.stringify(data),
    900
  );
}

async function getFlow(
  userId
) {
  const raw =
    await rGet(
      `flow:${userId}`
    );

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function clearFlow(
  userId
) {
  await rDel(
    `flow:${userId}`
  );
}

async function showHome(
  chatId,
  userId
) {
  const plan =
    await getPlan(userId);

  const credits =
    await getCredits(userId);

  return sendMessage(
    chatId,
    `🚀 PIXELMETA AI

` +
    `Create something extraordinary.

` +
    `💳 Plan: ${plan.toUpperCase()}
` +
    `⚡ Credits: ${credits}

` +
    `Choose what you want to create:`,
    {
      reply_markup:
        homeKeyboard()
    }
  );
}

async function showImageMenu(
  chatId,
  userId
) {
  await setFlow(
    userId,
    {
      step:
        "choose_model"
    }
  );

  return sendMessage(
    chatId,
    `🖼️ IMAGE GENERATION

` +
    `Choose your engine:`,
    {
      reply_markup:
        imageKeyboard()
    }
  );
}

async function showVideoMenu(
  chatId,
  userId
) {
  await clearFlow(
    userId
  );

  return sendMessage(
    chatId,
    `🎬 PIXELMETA VIDEO

` +
    `Video generation is coming soon.

` +
    `Our upcoming engines:

` +
    `⚡ Seedance
` +
    `🎥 Kling
` +
    `🌊 WAN
` +
    `✨ Veo
` +
    `🎞️ More cinematic models

` +
    `🚧 Currently in development`,
    {
      reply_markup:
        videoKeyboard()
    }
  );
}

async function cmdCredits(
  chatId,
  userId
) {
  const plan =
    await getPlan(userId);

  const credits =
    await getCredits(userId);

  return sendMessage(
    chatId,
    `💳 YOUR CREDITS

` +
    `Plan: ${plan.toUpperCase()}
` +
    `Available credits: ${credits}`,
    {
      reply_markup:
        homeKeyboard()
    }
  );
}

async function cmdModels(
  chatId,
  userId
) {
  const plan =
    await getPlan(userId);

  const lines = [
    `📚 PIXELMETA MODELS`,
    ``,
    `🎬 Cinematic`,
    `2K • 2 credits`,
    `4K • 4 credits`,
    ``,
    `📸 Realism`,
    `2K • 6 credits`,
    `4K • 15 credits`,
    ``,
    `🟪 Ultra 8K`,
    `8K • 30 credits`,
    ``,
    `🦈 SHARK V1`,
    `2K • 15 credits`,
    `4K • 25 credits`,
    `8K • 45 credits`,
    ``,
    `Your plan: ${plan.toUpperCase()}`
  ];

  return sendMessage(
    chatId,
    lines.join("\n"),
    {
      reply_markup:
        homeKeyboard()
    }
  );
}

/* =========================
   GENERATION
========================= */

async function performGeneration(
  chatId,
  userId,
  modelKey,
  qualityKey,
  ratioKey,
  prompt,
  extra = {}
) {
  const cost =
    getCost(
      modelKey,
      qualityKey
    );

  if (cost === null) {
    throw new Error(
      "Invalid model or quality"
    );
  }

  if (
    !(await canAccess(
      userId,
      modelKey
    ))
  ) {
    await sendMessage(
      chatId,
      "🔒 This model is not available on your current plan."
    );

    return;
  }

  const credits =
    await getCredits(userId);

  if (credits < cost) {
    await sendMessage(
      chatId,
      `❌ Not enough credits.

` +
      `Required: ${cost}
` +
      `Available: ${credits}`
    );

    return;
  }

  if (
    !(await acquireBusy(
      userId
    ))
  ) {
    await sendMessage(
      chatId,
      "⏳ You already have a generation running. Please wait."
    );

    return;
  }

  let globalSlot =
    false;

  try {
    globalSlot =
      await acquireGlobalSlot();

    if (!globalSlot) {
      await sendMessage(
        chatId,
        "⏳ Generation queue is busy. Please try again shortly."
      );

      return;
    }

    const ratio =
      getRatio(ratioKey);

    await sendMessage(
      chatId,
      `🎨 GENERATING...

` +
      `${modelLabel(modelKey)}
` +
      `Quality: ${qualityLabel(
        modelKey,
        qualityKey
      )}
` +
      `Ratio: ${ratio.label}

` +
      `Please wait...`
    );

    const result =
      await generateWithModel(
        modelKey,
        qualityKey,
        prompt,
        ratioKey,
        extra
      );

    if (!result?.url) {
      throw new Error(
        "Generation returned no URL"
      );
    }

    const deducted =
      await deductCredits(
        userId,
        cost
      );

    if (!deducted) {
      throw new Error(
        "Credit deduction failed"
      );
    }

    let caption =
      `✨ PIXELMETA AI

` +
      `${modelLabel(modelKey)}
` +
      `Quality: ${qualityLabel(
        modelKey,
        qualityKey
      )}
` +
      `Ratio: ${ratio.label}
` +
      `⚡ Used: ${cost} credits`;

    if (
      result.approximate &&
      ratioKey === "45"
    ) {
      caption +=
        `

ℹ️ 4:5 uses the closest native base ratio on this engine.`;
    }

    if (
      qualityKey === "8k"
    ) {
      await sendDocument(
        chatId,
        result.url,
        caption
      );
    } else {
      await sendPhoto(
        chatId,
        result.url,
        caption
      );
    }
  } catch (error) {
    console.error(
      "Generation error:",
      error
    );

    try {
      await sendMessage(
        chatId,
        `❌ Generation failed.

` +
        `${error.message || "Unknown error"}

` +
        `Your credits were not charged for this failed generation.`
      );
    } catch (
      telegramError
    ) {
      console.error(
        "Failed to send generation error:",
        telegramError.message
      );
    }
  } finally {
    if (globalSlot) {
      await releaseGlobalSlot();
    }

    await releaseBusy(
      userId
    );
  }
}

async function quickGen(
  chatId,
  userId,
  text
) {
  const parsed =
    inferModelQualityFromText(
      text
    );

  const ratioKey =
    inferRatioFromText(
      text
    );

  const modelKey =
    parsed.modelKey;

  let qualityKey =
    parsed.qualityKey;

  if (
    modelKey === "ultra8k"
  ) {
    qualityKey = "8k";
  }

  if (
    modelKey === "shark"
  ) {
    await sendMessage(
      chatId,
      `🦈 SHARK V1 requires an image.

` +
      `Send a photo and use:
` +
      `/shark <edit instruction>`
    );

    return;
  }

  if (
    !isValidQuality(
      modelKey,
      qualityKey
    )
  ) {
    qualityKey =
      Object.keys(
        MODELS[
          modelKey
        ].qualities
      )[0];
  }

  return performGeneration(
    chatId,
    userId,
    modelKey,
    qualityKey,
    ratioKey,
    text
  );
}

async function cmdShark(
  chatId,
  userId,
  text
) {
  const instruction =
    text
      .replace(
        /^\/shark/i,
        ""
      )
      .trim();

  if (!instruction) {
    await sendMessage(
      chatId,
      `🦈 SHARK V1

` +
      `Send a photo first, then use:
` +
      `/shark <edit instruction>`
    );

    return;
  }

  const imageUrl =
    await rGet(
      `shark:${userId}:image`
    );

  if (!imageUrl) {
    await sendMessage(
      chatId,
      "📷 Please send an image first."
    );

    return;
  }

  return performGeneration(
    chatId,
    userId,
    "shark",
    "4k",
    "sq",
    instruction,
    {
      imageUrl
    }
  );
}

/* =========================
   CALLBACKS
========================= */

async function onCallback(
  query
) {
  const userId =
    query.from?.id;

  const chatId =
    query.message?.chat?.id;

  const data =
    query.data || "";

  if (
    !userId ||
    !chatId
  ) {
    return;
  }

  try {
    await answerCallbackQuery(
      query.id
    );
  } catch (error) {
    console.error(
      "Callback answer error:",
      error.message
    );
  }

  if (
    data === "x:cancel"
  ) {
    await clearFlow(
      userId
    );

    return sendMessage(
      chatId,
      "❌ Operation cancelled.",
      {
        reply_markup:
          homeKeyboard()
      }
    );
  }

  if (
    data === "x:home"
  ) {
    return showHome(
      chatId,
      userId
    );
  }

  if (
    data === "mode:image"
  ) {
    return showImageMenu(
      chatId,
      userId
    );
  }

  if (
    data === "mode:video"
  ) {
    return showVideoMenu(
      chatId,
      userId
    );
  }

  if (
    data === "home:credits"
  ) {
    return cmdCredits(
      chatId,
      userId
    );
  }

  if (
    data === "home:models"
  ) {
    return cmdModels(
      chatId,
      userId
    );
  }

  if (
    data === "x:back_models"
  ) {
    return showImageMenu(
      chatId,
      userId
    );
  }

  if (
    data === "x:back_quality"
  ) {
    const flow =
      await getFlow(
        userId
      );

    if (
      flow?.modelKey
    ) {
      await setFlow(
        userId,
        {
          step:
            "choose_quality",
          modelKey:
            flow.modelKey
        }
      );

      return sendMessage(
        chatId,
        `⚙️ CHOOSE QUALITY

` +
        `${modelLabel(
          flow.modelKey
        )}`,
        {
          reply_markup:
            qualityKeyboard(
              flow.modelKey
            )
        }
      );
    }

    return showImageMenu(
      chatId,
      userId
    );
  }

  if (
    data.startsWith("m:")
  ) {
    const modelKey =
      data.slice(2);

    if (
      !isValidModel(
        modelKey
      )
    ) {
      return;
    }

    if (
      !(await canAccess(
        userId,
        modelKey
      ))
    ) {
      return sendMessage(
        chatId,
        "🔒 This model is locked on your current plan."
      );
    }

    if (
      modelKey === "shark"
    ) {
      await clearFlow(
        userId
      );

      return sendMessage(
        chatId,
        `🦈 SHARK V1 — PREMIUM EDIT

` +
        `Send a photo, then use:

` +
        `/shark <edit instruction>`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    "⬅️ Back",
                  callback_data:
                    "x:back_models"
                },
                {
                  text:
                    "❌ Cancel",
                  callback_data:
                    "x:cancel"
                }
              ]
            ]
          }
        }
      );
    }

    await setFlow(
      userId,
      {
        step:
          "choose_quality",
        modelKey
      }
    );

    return sendMessage(
      chatId,
      `⚙️ CHOOSE QUALITY

` +
      `${modelLabel(
        modelKey
      )}`,
      {
        reply_markup:
          qualityKeyboard(
            modelKey
          )
      }
    );
  }

  if (
    data.startsWith("q:")
  ) {
    const parts =
      data.split(":");

    const modelKey =
      parts[1];

    const qualityKey =
      parts[2];

    if (
      !isValidModel(
        modelKey
      ) ||
      !isValidQuality(
        modelKey,
        qualityKey
      )
    ) {
      return;
    }

    if (
      !(await canAccess(
        userId,
        modelKey
      ))
    ) {
      return sendMessage(
        chatId,
        "🔒 This model is locked on your current plan."
      );
    }

    const cost =
      getCost(
        modelKey,
        qualityKey
      );

    const credits =
      await getCredits(
        userId
      );

    if (
      credits < cost
    ) {
      return sendMessage(
        chatId,
        `❌ Not enough credits.

` +
        `Required: ${cost}
` +
        `Available: ${credits}`
      );
    }

    await setFlow(
      userId,
      {
        step:
          "choose_ratio",
        modelKey,
        qualityKey
      }
    );

    return sendMessage(
      chatId,
      `📐 CHOOSE ASPECT RATIO

` +
      `${modelLabel(
        modelKey
      )}
` +
      `Quality: ${qualityLabel(
        modelKey,
        qualityKey
      )}`,
      {
        reply_markup:
          ratioKeyboard(
            modelKey,
            qualityKey
          )
      }
    );
  }

  if (
    data.startsWith("r:")
  ) {
    const parts =
      data.split(":");

    const modelKey =
      parts[1];

    const qualityKey =
      parts[2];

    const ratioKey =
      parts[3];

    if (
      !isValidModel(
        modelKey
      ) ||
      !isValidQuality(
        modelKey,
        qualityKey
      ) ||
      !RATIOS[ratioKey]
    ) {
      return;
    }

    if (
      !(await canAccess(
        userId,
        modelKey
      ))
    ) {
      return sendMessage(
        chatId,
        "🔒 This model is locked on your current plan."
      );
    }

    await setFlow(
      userId,
      {
        step:
          "await_prompt",
        modelKey,
        qualityKey,
        ratioKey
      }
    );

    const ratio =
      getRatio(
        ratioKey
      );

    let note = "";

    if (
      ratioKey === "45" &&
      modelKey !==
        "cinematic"
    ) {
      note =
        `

ℹ️ This engine uses its closest native base ratio for 4:5.`;
    }

    return sendMessage(
      chatId,
      `✍️ SEND YOUR PROMPT

` +
      `${modelLabel(
        modelKey
      )}
` +
      `Quality: ${qualityLabel(
        modelKey,
        qualityKey
      )}
` +
      `Ratio: ${ratio.label}` +
      note +
      `

Example:
` +
      `A cinematic portrait, dramatic lighting, ultra detailed`
    );
  }
}
/* =========================
   MESSAGES
========================= */

async function onMessage(message) {
  const chatId =
    message.chat?.id;

  const userId =
    message.from?.id;

  if (!chatId || !userId) {
    return;
  }

  if (
    await isBanned(userId)
  ) {
    return sendMessage(
      chatId,
      "🚫 Your access is currently restricted."
    );
  }

  await ensureUser(userId);

  /* =========================
     PHOTO / SHARK
  ========================= */

  if (message.photo?.length) {
    try {
      const photo =
        message.photo[
          message.photo.length - 1
        ];

      const url =
        await tgGetFileUrl(
          photo.file_id
        );

      await rSet(
        `shark:${userId}:image`,
        url,
        1800
      );

      return sendMessage(
        chatId,
        `📷 Image received.\n\n` +
        `Now use:\n` +
        `/shark <edit instruction>`
      );
    } catch (error) {
      console.error(
        "Photo handling error:",
        error
      );

      return sendMessage(
        chatId,
        "❌ Could not process this image. Please try again."
      );
    }
  }

  const text =
    String(
      message.text || ""
    ).trim();

  if (!text) {
    return;
  }

  if (
    !(await rateLimit(userId))
  ) {
    return;
  }

  const parts =
    text.split(/\s+/);

  const command =
    (parts[0] || "")
      .split("@")[0]
      .toLowerCase();

  const args =
    parts
      .slice(1)
      .join(" ")
      .trim();

  /* =========================
     BASIC COMMANDS
  ========================= */

  if (
    command === "/start"
  ) {
    await clearFlow(
      userId
    );

    return showHome(
      chatId,
      userId
    );
  }

  if (
    command === "/gen"
  ) {
    await clearFlow(
      userId
    );

    if (args) {
      return quickGen(
        chatId,
        userId,
        args
      );
    }

    return showHome(
      chatId,
      userId
    );
  }

  if (
    command === "/image"
  ) {
    return showImageMenu(
      chatId,
      userId
    );
  }

  if (
    command === "/video"
  ) {
    return showVideoMenu(
      chatId,
      userId
    );
  }

  if (
    command === "/credits"
  ) {
    return cmdCredits(
      chatId,
      userId
    );
  }

  if (
    command === "/models"
  ) {
    return cmdModels(
      chatId,
      userId
    );
  }

  if (
    command === "/cancel"
  ) {
    await clearFlow(
      userId
    );

    return sendMessage(
      chatId,
      "❌ Cancelled.",
      {
        reply_markup:
          homeKeyboard()
      }
    );
  }

  if (
    command === "/shark"
  ) {
    return cmdShark(
      chatId,
      userId,
      text
    );
  }

  /* =========================
     ADMIN
  ========================= */

  if (
    isAdmin(userId) &&
    command === "/admin"
  ) {
    return handleAdmin(
      chatId,
      userId,
      text
    );
  }

  /* =========================
     ACTIVE GENERATION FLOW
  ========================= */

  const flow =
    await getFlow(userId);

  if (
    flow?.step ===
    "await_prompt"
  ) {
    const prompt =
      clampPrompt(text);

    if (!prompt) {
      return sendMessage(
        chatId,
        "✍️ Please send a prompt."
      );
    }

    await clearFlow(
      userId
    );

    return performGeneration(
      chatId,
      userId,
      flow.modelKey,
      flow.qualityKey,
      flow.ratioKey,
      prompt
    );
  }

  return sendMessage(
    chatId,
    `Use /gen to start.\n\n` +
    `Or choose an option below:`,
    {
      reply_markup:
        homeKeyboard()
    }
  );
}

/* =========================
   ADMIN
========================= */

function parseArgs(text) {
  return text
    .trim()
    .split(/\s+/)
    .slice(1);
}

async function handleAdmin(
  chatId,
  userId,
  text
) {
  if (
    !isAdmin(userId)
  ) {
    return;
  }

  const args =
    parseArgs(text);

  const command =
    text
      .split(/\s+/)[0]
      .toLowerCase();

  if (
    command === "/admin" &&
    !args[0]
  ) {
    return sendMessage(
      chatId,
      `👑 ADMIN PANEL

` +
      `/admin addcredit <id> <amount>
` +
      `/admin resetcredits <id>
` +
      `/admin settrial <id>
` +
      `/admin setpromo <id>
` +
      `/admin setpaid <id>
` +
      `/admin ban <id>
` +
      `/admin unban <id>
` +
      `/admin stats`
    );
  }

  const action =
    args[0]?.toLowerCase();

  const target =
    args[1];

  /* =========================
     ADD CREDITS
  ========================= */

  if (
    action === "addcredit" &&
    target
  ) {
    const amount =
      safeInt(
        args[2],
        0
      );

    if (
      amount <= 0
    ) {
      return sendMessage(
        chatId,
        "❌ Invalid credit amount."
      );
    }

    await addCredits(
      target,
      amount
    );

    return sendMessage(
      chatId,
      `✅ Added ${amount} credits to ${target}.`
    );
  }

  /* =========================
     RESET CREDITS
  ========================= */

  if (
    action === "resetcredits" &&
    target
  ) {
    const plan =
      await getPlan(
        target
      );

    await rSet(
      `u:${target}:credits`,
      PLAN_DEFAULT_CREDITS[
        plan
      ] || 0
    );

    return sendMessage(
      chatId,
      `✅ Credits reset for ${target}.`
    );
  }

  /* =========================
     TRIAL
  ========================= */

  if (
    action === "settrial" &&
    target
  ) {
    await setPlan(
      target,
      "trial"
    );

    return sendMessage(
      chatId,
      `✅ ${target} → trial`
    );
  }

  /* =========================
     PROMO
  ========================= */

  if (
    action === "setpromo" &&
    target
  ) {
    await setPlan(
      target,
      "promo"
    );

    return sendMessage(
      chatId,
      `✅ ${target} → promo`
    );
  }

  /* =========================
     PAID
  ========================= */

  if (
    action === "setpaid" &&
    target
  ) {
    await setPlan(
      target,
      "paid"
    );

    return sendMessage(
      chatId,
      `✅ ${target} → paid`
    );
  }

  /* =========================
     BAN
  ========================= */

  if (
    action === "ban" &&
    target
  ) {
    await setBan(
      target,
      true
    );

    return sendMessage(
      chatId,
      `🚫 Banned ${target}.`
    );
  }

  /* =========================
     UNBAN
  ========================= */

  if (
    action === "unban" &&
    target
  ) {
    await setBan(
      target,
      false
    );

    return sendMessage(
      chatId,
      `✅ Unbanned ${target}.`
    );
  }

  /* =========================
     STATS
  ========================= */

  if (
    action === "stats"
  ) {
    return sendMessage(
      chatId,
      `📊 PIXELMETA AI

` +
      `Global generation limit: ${GLOBAL_GEN_LIMIT}
` +
      `Redis: ${
        redis
          ? "Configured"
          : "Missing"
      }
` +
      `FAL: ${
        FAL_API_KEY
          ? "Configured"
          : "Missing"
      }
` +
      `Replicate: ${
        REPLICATE_API_TOKEN
          ? "Configured"
          : "Missing"
      }`
    );
  }

  return sendMessage(
    chatId,
    "❌ Unknown admin command."
  );
}

/* =========================
   EXPRESS / WEBHOOK
========================= */

app.get(
  "/",
  (req, res) => {
    res
      .status(200)
      .send(
        "PIXELMETA AI is alive."
      );
  }
);

/* =========================
   RAILWAY ROOT WEBHOOK
   IMPORTANT FIX
========================= */

app.post(
  "/",
  (req, res) => {
    try {
      if (
        TG_SECRET_TOKEN &&
        req.headers[
          "x-telegram-bot-api-secret-token"
        ] !== TG_SECRET_TOKEN
      ) {
        return res
          .status(401)
          .send(
            "Unauthorized"
          );
      }

      const update =
        req.body;

      /*
       * Telegram ko immediately
       * HTTP 200 response.
       */
      res.sendStatus(200);

      /*
       * Update ko background
       * mein process karo.
       */
      Promise.resolve()
        .then(
          async () => {
            if (
              update?.callback_query
            ) {
              await onCallback(
                update.callback_query
              );

              return;
            }

            if (
              update?.message
            ) {
              await onMessage(
                update.message
              );
            }
          }
        )
        .catch(
          (error) => {
            console.error(
              "Root webhook background error:",
              error
            );
          }
        );
    } catch (error) {
      console.error(
        "Root webhook error:",
        error
      );

      /*
       * Telegram ko 200 dena
       * zaroori hai.
       */
      return res.sendStatus(
        200
      );
    }
  }
);

/* =========================
   TELEGRAM WEBHOOK
========================= */

app.post(
  "/telegram/webhook",
  (req, res) => {
    try {
      if (
        TG_SECRET_TOKEN &&
        req.headers[
          "x-telegram-bot-api-secret-token"
        ] !== TG_SECRET_TOKEN
      ) {
        return res
          .status(401)
          .send(
            "Unauthorized"
          );
      }

      const update =
        req.body;

      /*
       * Telegram ko immediately
       * acknowledge.
       */
      res.sendStatus(200);

      /*
       * Background processing.
       */
      Promise.resolve()
        .then(
          async () => {
            if (
              update?.callback_query
            ) {
              await onCallback(
                update.callback_query
              );

              return;
            }

            if (
              update?.message
            ) {
              await onMessage(
                update.message
              );
            }
          }
        )
        .catch(
          (error) => {
            console.error(
              "Webhook background error:",
              error
            );
          }
        );
    } catch (error) {
      console.error(
        "Webhook error:",
        error
      );

      return res.sendStatus(
        200
      );
    }
  }
);

/* =========================
   HEALTH
========================= */

app.get(
  "/health",
  async (req, res) => {
    let redisStatus =
      false;

    if (redis) {
      try {
        redisStatus =
          (
            await redis.ping()
          ) === "PONG";
      } catch {
        redisStatus =
          false;
      }
    }

    res.json({
      ok: true,
      service:
        "pixlemorphic-ai-bot",
      redis:
        redisStatus,
      fal:
        Boolean(
          FAL_API_KEY
        ),
      replicate:
        Boolean(
          REPLICATE_API_TOKEN
        ),
      telegram:
        Boolean(
          TG_TOKEN
        ),
      globalGenerationLimit:
        GLOBAL_GEN_LIMIT,
      time:
        new Date().toISOString()
    });
  }
);

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  () => {
    console.log(
      `PIXELMETA AI running on port ${PORT}`
    );

    console.log(
      `Global generation limit: ${GLOBAL_GEN_LIMIT}`
    );

    console.log(
      `Telegram configured: ${Boolean(
        TG_TOKEN
      )}`
    );

    console.log(
      `Redis configured: ${Boolean(
        REDIS_URL
      )}`
    );

    console.log(
      `FAL configured: ${Boolean(
        FAL_API_KEY
      )}`
    );

    console.log(
      `Replicate configured: ${Boolean(
        REPLICATE_API_TOKEN
      )}`
    );
  }
);

/* =========================
   PROCESS ERROR HANDLERS
========================= */

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);
