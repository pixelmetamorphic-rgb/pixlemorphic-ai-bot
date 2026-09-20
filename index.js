"use strict";

require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const FormData = require("form-data");
const Redis = require("ioredis");
const { randomUUID } = require("crypto");

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
const RUNWARE_API_KEY = process.env.RUNWARE_API_KEY || "";
const RUNWARE_TIMEOUT_MS = 360000;
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

const FAL_TIMEOUT_MS = parseInt(
  process.env.FAL_TIMEOUT_MS || "120000",
  10
);

const FAL_QUEUE_TIMEOUT_MS = parseInt(
  process.env.FAL_QUEUE_TIMEOUT_MS || "360000",
  10
);

const FAL_QUEUE_POLL_MS = parseInt(
  process.env.FAL_QUEUE_POLL_MS || "3000",
  10
);

const FAL_QUEUE_HTTP_TIMEOUT_MS = parseInt(
  process.env.FAL_QUEUE_HTTP_TIMEOUT_MS || "30000",
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
      "2k": { cost: 2 },
      "4k": { cost: 4 }
    },
    engines: {
      primary: "fal_schnell",
      backup: null
    }
  },

  realism: {
    key: "realism",
    label: "📸 Pixlemeta Realism (DSLR)",
    type: "t2i",
    qualities: {
      "2k": { cost: 6 },
      "4k": { cost: 15 }
    },
    engines: {
      primary: "fal_flux_ultra_realism",
      backup: "replicate_sdxl"
    }
  },

  ultra8k: {
    key: "ultra8k",
    label: "🟪 Pixlemeta Ultra 8K Realism",
    type: "t2i",
    qualities: {
      "8k": { cost: 30 }
    },
    engines: {
      primary: "fal_flux_pro_8k",
      backup: null
    }
  },

  edit: {
    key: "edit",
    label: "✏️ Pixlemeta EDIT (FLUX.1 Kontext Pro)",
    type: "i2i",
    qualities: {
      "pro": { cost: 15 }
    },
    engines: {
      primary: "kontext_pro_edit",
      backup: null
    }
  },

  seedream4: {
    key: "seedream4",
    label: "🌱 Seedream 4.0",
    type: "t2i",
    qualities: {
      "2k": { cost: 6 },
      "4k": { cost: 12 }
    },
    engines: {
      primary: "fal_seedream4",
      backup: null
    }
  },

  seedream45: {
    key: "seedream45",
    label: "🌿 Seedream 4.5",
    type: "t2i",
    qualities: {
      "2k": { cost: 8 },
      "4k": { cost: 16 }
    },
    engines: {
      primary: "fal_seedream45",
      backup: null
    }
  },

  fluxdev: {
    key: "fluxdev",
    label: "⚡ FLUX.1 [dev]",
    type: "t2i",
    qualities: {
      "2k": { cost: 4 }
    },
    engines: {
      primary: "fal_flux_dev",
      backup: null
    }
  },

  flux2klein9b: {
    key: "flux2klein9b",
    label: "FLUX.2 [klein] 9B",
    type: "t2i",
    adminOnly: true,
    qualities: { "1k": { cost: 0 }, "2k": { cost: 0 } },
    engines: { primary: "runware_flux2klein9b", backup: null }
  },
  seedream50lite: {
    key: "seedream50lite",
    label: "Seedream 5.0 Lite",
    type: "t2i",
    adminOnly: true,
    ratios: ["sq", "34", "169", "916"],
    qualities: { "2k": { cost: 0 } },
    engines: { primary: "runware_seedream50lite", backup: null }
  },
  seedream50pro: {
    key: "seedream50pro",
    label: "Seedream 5.0 Pro",
    type: "t2i",
    adminOnly: true,
    qualities: { "1k": { cost: 0 }, "2k": { cost: 0 } },
    engines: { primary: "runware_seedream50pro", backup: null }
  },
  qwenimage30pro: {
    key: "qwenimage30pro",
    label: "Qwen-Image-3.0-Pro",
    type: "t2i",
    adminOnly: true,
    qualities: { "1k": { cost: 0 }, "2k": { cost: 0 } },
    engines: { primary: "runware_qwenimage30pro", backup: null }
  },
  nanobananapro: {
    key: "nanobananapro",
    label: "Nano Banana Pro",
    type: "t2i",
    adminOnly: true,
    qualities: {
      "1k": { cost: 0 },
      "2k": { cost: 0 },
      "4k": { cost: 0 }
    },
    engines: { primary: "fal_nano_banana_pro", backup: null }
  },
  ideogramv3: {
    key: "ideogramv3",
    label: "Ideogram V3",
    type: "t2i",
    adminOnly: true,
    ratios: ["sq", "34", "169", "916"],
    qualities: { "2k": { cost: 0 } },
    engines: { primary: "fal_ideogram_v3", backup: null }
  },

  gptimage2: {
    key: "gptimage2",
    label: "🧠 GPT Image 2",
    type: "t2i",
    qualities: {
      "2k": { cost: 25 },
      "4k": { cost: 50 }
    },
    engines: {
      primary: "fal_gpt_image2",
      backup: null
    }
  }
};

const PLAN_ACCESS = {
  trial: new Set([
    "cinematic",
    "realism"
  ]),
  promo: new Set([
    "cinematic",
    "realism",
    "ultra8k"
  ]),
  paid: new Set([
    "cinematic",
    "realism",
    "ultra8k"
  ]),
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
  if (MODELS[modelKey]?.adminOnly) {
    return isAdmin(userId);
  }
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
  userId,
  ttl = BUSY_LOCK_SECONDS
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
      ttl
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
  try {
    return await telegramRequest(
      "sendPhoto",
      {
        chat_id: chatId,
        photo,
        caption
      }
    );
  } catch (directError) {
    const isRemoteUrl =
      typeof photo === "string" &&
      (photo.startsWith("https://") ||
        photo.startsWith("http://"));

    if (!isRemoteUrl) {
      throw directError;
    }

    console.warn(
      "Telegram URL photo delivery failed; using streamed upload fallback:",
      directError.message
    );

    const remote = await fetch(
      photo,
      {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "PIXLEMORPHIC-AI/1.0"
        }
      }
    );

    if (!remote.ok) {
      throw new Error(
        "Result download failed: HTTP " + remote.status
      );
    }

    const contentType =
      remote.headers.get("content-type") ||
      "image/jpeg";

    const contentLength = Number(
      remote.headers.get("content-length") || 0
    );

    const maxPhotoBytes =
      9.5 * 1024 * 1024;

    if (
      contentLength > 0 &&
      contentLength > maxPhotoBytes
    ) {
      console.warn(
        "Result exceeds safe Telegram photo size; sending as document instead."
      );

      return sendDocument(
        chatId,
        photo,
        caption
      );
    }

    let extension = "jpg";

    if (contentType.includes("png")) {
      extension = "png";
    } else if (
      contentType.includes("webp")
    ) {
      extension = "webp";
    }

    const form = new FormData();

    form.append(
      "chat_id",
      String(chatId)
    );

    if (caption) {
      form.append(
        "caption",
        caption
      );
    }

    const fileOptions = {
      filename:
        "pixlemeta-result." + extension,
      contentType
    };

    if (contentLength > 0) {
      fileOptions.knownLength =
        contentLength;
    }

    form.append(
      "photo",
      remote.body,
      fileOptions
    );

    try {
      const uploadResponse =
        await fetch(
          "https://api.telegram.org/bot" + TG_TOKEN + "/sendPhoto",
          {
            method: "POST",
            headers: form.getHeaders(),
            body: form
          }
        );

      const uploadText =
        await uploadResponse.text();

      let uploadData;

      try {
        uploadData =
          JSON.parse(uploadText);
      } catch {
        uploadData = {
          raw: uploadText
        };
      }

      if (
        !uploadResponse.ok ||
        !uploadData?.ok
      ) {
        throw new Error(
          "Telegram streamed photo upload failed: " +
          JSON.stringify(uploadData)
        );
      }

      return uploadData.result;
    } catch (streamError) {
      console.warn(
        "Telegram streamed photo upload failed; sending as document fallback:",
        streamError.message
      );

      return sendDocument(
        chatId,
        photo,
        caption
      );
    }
  }
}

async function sendDocument(
  chatId,
  document,
  caption = ""
) {
  try {
    return await telegramRequest(
      "sendDocument",
      {
        chat_id:
          chatId,
        document,
        caption
      }
    );
  } catch (directError) {
    if (
      typeof document !==
        "string" ||
      !/^https?:\/\//i.test(
        document
      )
    ) {
      throw directError;
    }

    console.warn(
      "Telegram URL document delivery failed; using streamed upload fallback:",
      directError.message
    );

    const remote =
      await fetch(
        document,
        {
          method:
            "GET",
          redirect:
            "follow",
          headers: {
            "User-Agent":
              "PIXLEMORPHIC-AI/1.0"
          }
        }
      );

    if (!remote.ok) {
      throw new Error(
        `Result download failed: HTTP ${remote.status}`
      );
    }

    const contentType =
      remote.headers.get(
        "content-type"
      ) ||
      "application/octet-stream";

    const contentLength =
      Number(
        remote.headers.get(
          "content-length"
        ) ||
        0
      );

    const maxUploadBytes =
      49 * 1024 * 1024;

    if (
      contentLength > 0 &&
      contentLength >
        maxUploadBytes
    ) {
      throw new Error(
        `8K result is too large for Telegram upload (${Math.ceil(
          contentLength /
          1024 /
          1024
        )} MB). Please retry; the bot now uses compressed 8K JPEG output.`
      );
    }

    let extension =
      "jpg";

    if (
      contentType.includes(
        "png"
      )
    ) {
      extension =
        "png";
    } else if (
      contentType.includes(
        "webp"
      )
    ) {
      extension =
        "webp";
    }

    const form =
      new FormData();

    form.append(
      "chat_id",
      String(chatId)
    );

    if (caption) {
      form.append(
        "caption",
        caption
      );
    }

    const fileOptions = {
      filename:
        `pixlemeta-ultra8k.${extension}`,
      contentType
    };

    if (
      contentLength > 0
    ) {
      fileOptions.knownLength =
        contentLength;
    }

    form.append(
      "document",
      remote.body,
      fileOptions
    );

    const uploadResponse =
      await fetch(
        `https://api.telegram.org/bot${TG_TOKEN}/sendDocument`,
        {
          method:
            "POST",
          headers:
            form.getHeaders(),
          body:
            form
        }
      );

    const uploadText =
      await uploadResponse.text();

    let uploadData;

    try {
      uploadData =
        JSON.parse(
          uploadText
        );
    } catch {
      uploadData = {
        raw:
          uploadText
      };
    }

    if (
      !uploadResponse.ok ||
      !uploadData?.ok
    ) {
      throw new Error(
        "Telegram streamed document upload failed: " +
        JSON.stringify(
          uploadData
        )
      );
    }

    return uploadData.result;
  }
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

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      FAL_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        `https://fal.run/${model}`,
        {
          method: "POST",
          headers: {
            Authorization:
              `Key ${FAL_API_KEY}`,
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify(input),
          signal:
            controller.signal
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
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        `FAL request timed out for ${model}`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise(
    (resolve) => setTimeout(resolve, ms)
  );
}

async function falQueueJson(
  url,
  {
    method = "GET",
    body,
    timeoutMs =
      FAL_QUEUE_HTTP_TIMEOUT_MS
  } = {}
) {
  if (!FAL_API_KEY) {
    throw new Error(
      "FAL_API_KEY is not configured"
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          method,
          headers: {
            Authorization:
              `Key ${FAL_API_KEY}`,
            ...(body ===
            undefined
              ? {}
              : {
                  "Content-Type":
                    "application/json"
                })
          },
          ...(body === undefined
            ? {}
            : {
                body:
                  JSON.stringify(
                    body
                  )
              }),
          signal:
            controller.signal
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
        `FAL queue ${response.status}: ` +
          JSON.stringify(data)
      );
    }

    return data;
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        "FAL queue HTTP request timed out"
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function falQueueRun(
  model,
  input,
  {
    timeoutMs =
      FAL_QUEUE_TIMEOUT_MS,
    pollMs =
      FAL_QUEUE_POLL_MS
  } = {}
) {
  const submitUrl =
    `https://queue.fal.run/${model}`;

  const submitted =
    await falQueueJson(
      submitUrl,
      {
        method: "POST",
        body: input
      }
    );

  const requestId =
    submitted?.request_id;

  if (!requestId) {
    throw new Error(
      `FAL queue returned no request_id for ${model}`
    );
  }

  const statusUrl =
    submitted?.status_url ||
    `${submitUrl}/requests/${requestId}/status`;

  const responseUrl =
    submitted?.response_url ||
    `${submitUrl}/requests/${requestId}`;

  const cancelUrl =
    submitted?.cancel_url ||
    `${submitUrl}/requests/${requestId}/cancel`;

  const startedAt =
    Date.now();

  while (
    Date.now() -
      startedAt <
    timeoutMs
  ) {
    const status =
      await falQueueJson(
        statusUrl
      );

    const state =
      String(
        status?.status || ""
      ).toUpperCase();

    if (
      state ===
      "COMPLETED"
    ) {
      const result =
        await falQueueJson(
          responseUrl
        );

      if (
        result?.response &&
        typeof result.response ===
          "object"
      ) {
        return result.response;
      }

      if (
        result?.data &&
        typeof result.data ===
          "object"
      ) {
        return result.data;
      }

      return result;
    }

    if (
      state === "FAILED" ||
      state === "CANCELED" ||
      state === "CANCELLED"
    ) {
      throw new Error(
        `FAL queue ${state.toLowerCase()} for ${model}: ` +
          JSON.stringify(
            status?.error ||
              status?.detail ||
              status
          )
      );
    }

    await sleep(pollMs);
  }

  try {
    await falQueueJson(
      cancelUrl,
      {
        method: "PUT"
      }
    );
  } catch (cancelError) {
    console.error(
      "FAL queue cancel failed:",
      cancelError?.message ||
        cancelError
    );
  }

  throw new Error(
    `FAL queue timed out for ${model} after ${Math.round(
      timeoutMs / 1000
    )}s`
  );
}

function pickFirstImageUrl(
  data
) {
  if (
    data?.images &&
    Array.isArray(
      data.images
    ) &&    data.images[0]
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
    lower.includes("realism") ||
    lower.includes("realistic") ||
    lower.includes("dslr")
  ) {
    modelKey =
      "realism";
  }

  if (
    lower.includes("ultra 8k") ||
    lower.includes("8k")
  ) {
    modelKey =
      "ultra8k";
    qualityKey =
      "8k";
  }

  if (
    lower.includes("seedream 4.5") ||
    lower.includes("seedream45") ||
    lower.includes("seedream v4.5")
  ) {
    modelKey =
      "seedream45";
  } else if (
    lower.includes("seedream")
  ) {
    modelKey =
      "seedream4";
  }

  if (
    lower.includes("flux dev") ||
    lower.includes("flux.1 dev")
  ) {
    modelKey =
      "fluxdev";
    qualityKey =
      "2k";
  }

  if (
    lower.includes("gpt image")
  ) {
    modelKey =
      "gptimage2";
  }

  if (
    lower.includes("4k") &&
    modelKey !==
      "ultra8k"
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
   PREMIUM IMAGE HELPERS
========================= */

function buildUltraRealismPrompt(
  prompt
) {
  const clean =
    clampPrompt(prompt);

  return (
    clean +
    ", authentic real-life photography, natural human skin texture with visible pores and fine detail, realistic anatomy and body proportions, true-to-life colors, physically natural lighting, realistic hair and fabric texture, subtle camera-like contrast, documentary-grade photorealism, no waxy skin, no plastic face, no CGI appearance, no artificial HDR, no oversaturated colors"
  );
}

const IMAGE_SIZE_2K = {
  sq: { width: 2048, height: 2048 },
  "45": { width: 1600, height: 2000 },
  "34": { width: 1536, height: 2048 },
  "169": { width: 2048, height: 1152 },
  "916": { width: 1152, height: 2048 }
};

const SEEDREAM45_SIZE_2K = {
  sq: { width: 2048, height: 2048 },
  "45": { width: 2048, height: 2560 },
  "34": { width: 1920, height: 2560 },
  "169": { width: 2560, height: 1440 },
  "916": { width: 1440, height: 2560 }
};

const IMAGE_SIZE_4K = {
  sq: { width: 4096, height: 4096 },
  "45": { width: 3200, height: 4000 },
  "34": { width: 3072, height: 4096 },
  "169": { width: 4096, height: 2304 },
  "916": { width: 2304, height: 4096 }
};

const GPT_IMAGE_4K_SIZE = {
  sq: { width: 2880, height: 2880 },
  "45": { width: 2560, height: 3200 },
  "34": { width: 2304, height: 3072 },
  "169": { width: 3840, height: 2160 },
  "916": { width: 2160, height: 3840 }
};

function imageSizeFor(
  ratioKey,
  qualityKey,
  family = "standard"
) {
  const key =
    RATIOS[ratioKey]
      ? ratioKey
      : "sq";

  if (
    family === "gpt" &&
    qualityKey === "4k"
  ) {
    return GPT_IMAGE_4K_SIZE[key];
  }

  if (
    qualityKey === "4k"
  ) {
    return IMAGE_SIZE_4K[key];
  }

  return IMAGE_SIZE_2K[key];
}

function seedream45SizeFor(
  ratioKey,
  qualityKey
) {
  const key =
    RATIOS[ratioKey]
      ? ratioKey
      : "sq";

  if (
    qualityKey ===
    "4k"
  ) {
    return IMAGE_SIZE_4K[key];
  }

  return SEEDREAM45_SIZE_2K[key];
}

function ideogramImageSizeFor(ratioKey) {
  const sizes = {
    sq: "square_hd",
    "34": "portrait_4_3",
    "169": "landscape_16_9",
    "916": "portrait_16_9"
  };

  return sizes[ratioKey] || "square_hd";
}

function safeErrorText(
  error
) {
  return String(
    error?.message ||
    "Unknown provider error"
  )
    .replace(
      /Key\s+[A-Za-z0-9._-]+/g,
      "Key [hidden]"
    )
    .slice(
      0,
      900
    );
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
        prompt:
          buildUltraRealismPrompt(
            prompt
          ),
        aspect_ratio:
          ratio.ultraAspect,
        raw:
          true,
        enhance_prompt:
          false,
        num_images:
          1,
        output_format:
          "jpeg",
        safety_tolerance:
          "2"
      }
    );

  const baseUrl =
    pickFirstImageUrl(
      data
    );

  if (!baseUrl) {
    throw new Error(
      "FAL Flux Pro Ultra returned no image"
    );
  }

  const upscaleData =
    await falRun(
      "topaz/upscale/image/precision",
      {
        image_url:
          baseUrl,
        model:
          "High Fidelity V3",
        upscale_factor:
          4,
        output_format:
          "jpeg",
        compression:
          0,
        noise:
          0,
        halo:
          0,
        grain:
          0.01,
        recover_detail:
          0.95
      }
    );

  const finalUrl =
    pickFirstImageUrl(
      upscaleData
    );

  if (!finalUrl) {
    throw new Error(
      "Ultra 8K precision upscale returned no image"
    );
  }

  return {
    url:
      finalUrl,
    type:
      "image",
    ratio:
      ratio.label,
    approximate:
      !ratio.exact,
    ultraRealism:
      true
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
async function kontextProEditPipeline(
  imageUrl,
  instruction
) {
  const prompt =
    clampPrompt(
      instruction
    );

  if (!imageUrl) {
    throw new Error(
      "Source image is missing"
    );
  }

  if (!prompt) {
    throw new Error(
      "Edit instruction is empty"
    );
  }

  const data =
    await falRun(
      "fal-ai/flux-pro/kontext",
      {
        image_url:
          imageUrl,
        prompt,
        guidance_scale:
          3.5,
        num_images:
          1,
        output_format:
          "jpeg",
        safety_tolerance:
          "2",
        enhance_prompt:
          false
      }
    );

  const url =
    pickFirstImageUrl(
      data
    );

  if (!url) {
    throw new Error(
      "FLUX.1 Kontext Pro returned no image"
    );
  }

  return {
    url,
    type:
      "image"
  };
}

/* =========================
   NEW FAL IMAGE ENGINES
========================= */

async function falNanoBananaProGenerate(
  prompt,
  qualityKey,
  ratioKey
) {
  const data =
    await falQueueRun(
      "fal-ai/nano-banana-pro",
      {
        prompt,
        aspect_ratio: getRatio(ratioKey).label,
        resolution: qualityKey.toUpperCase(),
        num_images: 1,
        output_format: "png",
        limit_generations: true
      }
    );

  const url =
    pickFirstImageUrl(data);

  if (!url) {
    throw new Error(
      "Nano Banana Pro returned no image"
    );
  }

  return {
    url,
    type: "image",
    ratio: getRatio(ratioKey).label,
    providerModel: "nano-banana-pro"
  };
}

async function falIdeogramV3Generate(
  prompt,
  qualityKey,
  ratioKey
) {
  const data =
    await falQueueRun(
      "fal-ai/ideogram/v3",
      {
        prompt,
        image_size: ideogramImageSizeFor(ratioKey),
        rendering_speed: "BALANCED",
        style: "AUTO",
        expand_prompt: true,
        num_images: 1
      }
    );

  const url =
    pickFirstImageUrl(data);

  if (!url) {
    throw new Error(
      "Ideogram V3 returned no image"
    );
  }

  return {
    url,
    type: "image",
    ratio: getRatio(ratioKey).label,
    providerModel: "ideogram-v3"
  };
}

async function falSeedream4Generate(
  prompt,
  qualityKey,
  ratioKey
) {
  const size =
    imageSizeFor(
      ratioKey,
      qualityKey
    );

  const data =
    await falRun(
      "fal-ai/bytedance/seedream/v4/text-to-image",
      {
        prompt,
        image_size:
          size,
        num_images:
          1,
        max_images:
          1,
        enable_safety_checker:
          true,
        enhance_prompt_mode:
          "standard"
      }
    );

  const url =
    pickFirstImageUrl(
      data
    );

  if (!url) {
    throw new Error(
      "Seedream 4.0 returned no image"
    );
  }

  return {
    url,
    type:
      "image",
    ratio:
      getRatio(
        ratioKey
      ).label,
    providerModel:
      "seedream-4.0"
  };
}

async function falSeedream45Generate(
  prompt,
  qualityKey,
  ratioKey
) {
  const size =
    seedream45SizeFor(
      ratioKey,
      qualityKey
    );

  const data =
    await falRun(
      "fal-ai/bytedance/seedream/v4.5/text-to-image",
      {
        prompt,
        image_size:
          size,
        num_images:
          1,
        max_images:
          1,
        enable_safety_checker:
          true
      }
    );

  const url =
    pickFirstImageUrl(
      data
    );

  if (!url) {
    throw new Error(
      "Seedream 4.5 returned no image"
    );
  }

  return {
    url,
    type:
      "image",
    ratio:
      getRatio(
        ratioKey
      ).label,
    providerModel:
      "seedream-4.5"
  };
}

async function falFluxDevGenerate(
  prompt,
  qualityKey,
  ratioKey
) {
  const size =
    imageSizeFor(
      ratioKey,
      "2k"
    );

  const data =
    await falRun(
      "fal-ai/flux/dev",
      {
        prompt,
        image_size:
          size,
        num_inference_steps:
          28,
        guidance_scale:
          3.5,
        num_images:
          1,
        enable_safety_checker:
          true,
        output_format:
          "jpeg",
        acceleration:
          "none"
      }
    );

  const url =
    pickFirstImageUrl(
      data
    );

  if (!url) {
    throw new Error(
      "FLUX.1 [dev] returned no image"
    );
  }

  return {
    url,
    type:
      "image",
    ratio:
      getRatio(
        ratioKey
      ).label
  };
}

async function falGPTImage2Generate(
  prompt,
  qualityKey,
  ratioKey
) {
  const size =
    imageSizeFor(
      ratioKey,
      qualityKey,
      "gpt"
    );

  const data =
    await falQueueRun(
      "openai/gpt-image-2",
      {
        prompt,
        image_size:
          size,
        background:
          "auto",
        quality:
          qualityKey ===
          "4k"
            ? "high"
            : "medium",
        num_images:
          1,
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
      "GPT Image 2 returned no image"
    );
  }

  return {
    url,
    type:
      "image",
    ratio:
      getRatio(
        ratioKey
      ).label
  };
}

/* =========================
   ENGINE ROUTER
========================= */

// Backend-only IDs. Testing prices are deliberately unset (admin costs zero).
const RUNWARE_MODELS = {
  runware_flux2klein9b: { model: "runware:400@2", steps: 4 },
  runware_seedream50lite: { model: "bytedance:seedream@5.0-lite" },
  runware_seedream50pro: { model: "bytedance:seedream@5.0-pro" },
  runware_qwenimage30pro: { model: "alibaba:qwen-image@3.0-pro" }
};

function runwareSizeFor(engine, qualityKey, ratioKey) {
  if (engine === "runware_seedream50lite") {
    const sizes = {
      sq: { width: 2048, height: 2048 },
      "34": { width: 1728, height: 2304 },
      "169": { width: 2848, height: 1600 },
      "916": { width: 1600, height: 2848 }
    };
    if (qualityKey !== "2k" || !sizes[ratioKey]) {
      throw new Error("Unsupported image dimensions");
    }
    return sizes[ratioKey];
  }
  if (!["1k", "2k"].includes(qualityKey) || !RATIOS[ratioKey]) {
    throw new Error("Unsupported image dimensions");
  }
  // Multiples of 16; exact ratios; within all three models' documented bounds.
  const sizes = {
    sq: { width: 1024, height: 1024 },
    "45": { width: 896, height: 1120 },
    "34": { width: 864, height: 1152 },
    "169": { width: 1280, height: 720 },
    "916": { width: 720, height: 1280 }
  };
  const size = sizes[ratioKey];
  if (qualityKey === "1k") return { ...size };
  // The FLUX model caps each side at 2048.
  return { ...IMAGE_SIZE_2K[ratioKey] };
}

async function runwareRequest(task, timeoutMs) {
  const response = await fetch("https://api.runware.ai/v1", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RUNWARE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([task]),
    timeout: Math.max(1, Math.min(30000, timeoutMs)),
    size: 2 * 1024 * 1024
  });
  if (!response.ok) {
    // Do not expose upstream response bodies, URLs, or credentials.
    throw new Error(`Image service request failed (HTTP ${response.status})`);
  }
  return response.json();
}

async function runwareGenerate(engine, prompt, qualityKey, ratioKey) {
  if (!RUNWARE_API_KEY) throw new Error("Image service is not configured");
  const config = RUNWARE_MODELS[engine];
  if (!config) throw new Error("Invalid image model");
  const size = runwareSizeFor(engine, qualityKey, ratioKey);
  const taskUUID = randomUUID();
  const started = Date.now();
  const deadline = started + RUNWARE_TIMEOUT_MS;
  const task = {
    taskType: "imageInference",
    taskUUID,
    model: config.model,
    positivePrompt: prompt,
    ...size,
    numberResults: 1,
    outputType: "URL",
    outputFormat: "JPG",
    includeCost: true,
    deliveryMethod: "async"
  };
  if (config.steps) task.steps = config.steps;
  const audit = {
    provider: "runware", model: config.model, taskUUID,
    quality: qualityKey, requestedWidth: size.width, requestedHeight: size.height
  };
  try {
    // Submit once only: never create another billable job after an ambiguous failure.
    let data = await runwareRequest(task, deadline - Date.now());
    while (true) {
      if (data?.errors?.length || data?.error) {
        throw new Error("Image service could not complete this request");
      }
      const items = Array.isArray(data?.data) ? data.data : [];
      const item = items.find((entry) => entry.taskUUID === taskUUID);
      if (item?.status === "error" || item?.status === "failed") {
        throw new Error("Image service could not complete this request");
      }
      if (item?.imageURL) {
        const url = new URL(item.imageURL);
        if (url.protocol !== "https:" || url.username || url.password) {
          throw new Error("Invalid generated image URL");
        }
        const metrics = {
          ...audit,
          costUSD: typeof item.cost === "number" && Number.isFinite(item.cost)
            ? item.cost : null,
          generationMs: Date.now() - started,
          generatedAt: new Date().toISOString()
        };
        console.log("image_generation_audit", JSON.stringify({
          ...metrics, status: "generated"
        }));
        return { url: url.href, type: "image", ratio: getRatio(ratioKey).label, metrics };
      }
      if (!item || item.status === "success") {
        throw new Error("Image service returned no usable result");
      }
      if (Date.now() + 3000 >= deadline) {
        throw new Error("Image generation timed out");
      }
      await sleep(3000);
      data = await runwareRequest({
        taskType: "getResponse", taskUUID
      }, deadline - Date.now());
    }
  } catch (error) {
    console.error("image_generation_audit", JSON.stringify({
      ...audit, status: "failed", generationMs: Date.now() - started
    }));
    // Generic outward error; internal audit retains correlation IDs, not secrets.
    throw new Error("This image test could not complete. Please try again later.");
  }
}

async function runEngine(
  engine,
  prompt,
  qualityKey,
  ratioKey,
  extra = {}
) {
  if (Object.prototype.hasOwnProperty.call(RUNWARE_MODELS, engine)) {
    return runwareGenerate(engine, prompt, qualityKey, ratioKey);
  }
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

    case "fal_seedream4":
      return falSeedream4Generate(
        prompt,
        qualityKey,
        ratioKey
      );

    case "fal_seedream45":
      return falSeedream45Generate(
        prompt,
        qualityKey,
        ratioKey
      );

    case "fal_flux_dev":
      return falFluxDevGenerate(
        prompt,
        qualityKey,
        ratioKey
      );

    case "fal_gpt_image2":
      return falGPTImage2Generate(
        prompt,
        qualityKey,
        ratioKey
      );

    case "fal_nano_banana_pro":
      return falNanoBananaProGenerate(
        prompt,
        qualityKey,
        ratioKey
      );

    case "fal_ideogram_v3":
      return falIdeogramV3Generate(
        prompt,
        qualityKey,
        ratioKey
      );

    case "kontext_pro_edit":
      return kontextProEditPipeline(
        extra.imageUrl,
        prompt
      );

    case "replicate_sdxl": {
      const url =
        await replicateSDXLGenerate(
          prompt
        );

      return {
        url,
        type:
          "image",
        ratio:
          getRatio(
            ratioKey
          ).label
      };
    }

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
        { text: "🖼 IMAGE STUDIO", callback_data: "mode:image" },
        { text: "🎬 VIDEO STUDIO", callback_data: "mode:video" }
      ],
      [
        { text: "💳 Credits", callback_data: "home:credits" },
        { text: "📚 Model Catalog", callback_data: "home:models" }
      ]
    ]
  };
}

function imageKeyboard(userId) {
  return {
    inline_keyboard: [
      [
        { text: "🎬 Cinematic ✅", callback_data: "m:cinematic" },
        { text: "📸 Realism ✅", callback_data: "m:realism" }
      ],
      [
        { text: "🟪 Ultra 8K Realism ✅", callback_data: "m:ultra8k" }
      ],
      [
        { text: "✏️ EDIT • Kontext Pro ✅", callback_data: "m:edit" }
      ],
      [
        { text: "🌱 Seedream 4.0 🧪", callback_data: "m:seedream4" },
        { text: "🌿 Seedream 4.5 🧪", callback_data: "m:seedream45" }
      ],
      [
        { text: "⚡ FLUX.1 [dev] 🧪", callback_data: "m:fluxdev" },
        { text: "🧠 GPT Image 2 🧪", callback_data: "m:gptimage2" }
      ],
      ...(isAdmin(userId) ? [
        [{ text: "🧪 FLUX.2 [klein] 9B", callback_data: "m:flux2klein9b" }],
        [{ text: "🧪 Seedream 5.0 Lite", callback_data: "m:seedream50lite" }],
        [{ text: "🧪 Qwen-Image-3.0-Pro", callback_data: "m:qwenimage30pro" }],
        [{ text: "🧪 Seedream 5.0 Pro", callback_data: "m:seedream50pro" }],
        [{ text: "🧪 Nano Banana Pro", callback_data: "m:nanobananapro" }],
        [{ text: "🧪 Ideogram V3", callback_data: "m:ideogramv3" }]
      ] : []),
      [
        { text: "🍌 Nano Banana 2 • SOON", callback_data: "soon:nano2" }
      ],
      [
        { text: "⬅️ Back", callback_data: "x:home" },
        { text: "❌ Cancel", callback_data: "x:cancel" }
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
          (model.adminOnly ? "Admin test" : `${model.qualities[q].cost} credits`),
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
    ].map((row) => row.filter((button) => {
      if (!button.callback_data.startsWith("r:")) return true;
      const ratio = button.callback_data.split(":")[3];
      return !MODELS[modelKey]?.ratios || MODELS[modelKey].ratios.includes(ratio);
    })).filter((row) => row.length)
  };
}

function videoKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "⚡ Wan 2.2 • COMING SOON", callback_data: "v:soon:wan22" }],
      [{ text: "🎞️ LTX-2 • COMING SOON", callback_data: "v:soon:ltx2" }],
      [{ text: "🎥 Kling 3.0 • COMING SOON", callback_data: "v:soon:kling3" }],
      [{ text: "🌊 Wan 2.7 • COMING SOON", callback_data: "v:soon:wan27" }],
      [{ text: "🚀 Seedance 2.0 Fast • COMING SOON", callback_data: "v:soon:seedance20fast" }],
      [{ text: "🎬 Seedance 2.0 • COMING SOON", callback_data: "v:soon:seedance20" }],
      [{ text: "🔥 Seedance 2.5 • COMING SOON", callback_data: "v:soon:seedance25" }],
      [{ text: "✨ Gemini Omni 1.1 Flash • COMING SOON", callback_data: "v:soon:geminiomni" }],
      [{ text: "🎥 Veo 3.1 • COMING SOON", callback_data: "v:soon:veo31" }],
      [{ text: "⚡ Kling 3.0 Turbo Pro • COMING SOON", callback_data: "v:soon:kling3turbo" }],
      [{ text: "⚙️ Video Settings • COMING SOON", callback_data: "v:settings" }],
      [{ text: "⬅️ Back", callback_data: "x:home" }]
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
  const plan = await getPlan(userId);
  const credits = await getCredits(userId);

  return sendMessage(
    chatId,
    `🚀 PIXLEMORPHIC AI

AI Image & Video Studio

💳 Plan: ${plan.toUpperCase()}
⚡ Credits: ${credits}

Choose a studio:`,
    { reply_markup: homeKeyboard() }
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
    "🖼 PIXELMETA IMAGE STUDIO\n\n✅ Core models live\n🧪 New models available for admin testing\n\nChoose a model:",
    {
      reply_markup:
        imageKeyboard(userId)
    }
  );
}

async function showVideoMenu(
  chatId,
  userId
) {
  await clearFlow(userId);

  return sendMessage(
    chatId,
    `🎬 PIXELMETA VIDEO STUDIO

Video model integration is staged for the next test cycle.

🎛 Planned controls
• Quality: 480p / 580p / 720p / 1080p / 4K
• Duration: 5s / 8s / 10s / 15s
• FPS: 24 / 30
• Audio: On / Off
• Ratio: 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9

No video credits are consumed while models are marked COMING SOON.`,
    { reply_markup: videoKeyboard() }
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
    await getPlan(
      userId
    );

  const lines = [
    "📚 PIXELMETA MODEL CATALOG",
    "",
    "✅ LIVE",
    "🎬 Cinematic • 2K / 4K",
    "📸 Realism • 2K / 4K",
    "🟪 Ultra 8K Realism • 8K",
    "✏️ EDIT • FLUX.1 Kontext Pro",
    "",
    "🧪 MODEL TESTING",
    "🌱 Seedream 4.0 • 2K / 4K",
    "🌿 Seedream 4.5 • 2K / 4K",
    "⚡ FLUX.1 [dev] • 2K",
    "🧠 GPT Image 2 • 2K / 4K",
    "",
    ...(isAdmin(userId) ? [
      "🧪 PRIVATE ADMIN TESTS",
      "FLUX.2 [klein] 9B • 1K / 2K",
      "Seedream 5.0 Lite • 2K",
      "Qwen-Image-3.0-Pro • 1K / 2K",
      "Seedream 5.0 Pro • 1K / 2K",
      "Admin tests use no bot credits.",
      ""
    ] : []),
    "⏳ UPCOMING",
    "🍌 Nano Banana 2",
    "🍌 Nano Banana Pro",
    "",
    "🎬 VIDEO — COMING SOON",
    "Wan 2.2 • LTX-2 • Kling 3.0 • Wan 2.7",
    "Seedance 2.0 Fast • Seedance 2.0 • Seedance 2.5",
    "Gemini Omni 1.1 Flash • Veo 3.1 • Kling 3.0 Turbo Pro",
    "",
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

  if (MODELS[modelKey]?.adminOnly &&
      (!RATIOS[ratioKey] ||
       (MODELS[modelKey].ratios && !MODELS[modelKey].ratios.includes(ratioKey)))) {
    return sendMessage(chatId, "Please select a supported aspect ratio from the model menu.");
  }

  const credits =
    await getCredits(userId);

  if (credits < cost) {
    await sendMessage(
      chatId,
      `❌ Not enough credits.\n\nRequired: ${cost}\nAvailable: ${credits}`
    );

    return;
  }

  if (
    !(await acquireBusy(
      userId,
      MODELS[modelKey]?.adminOnly ? 600 : BUSY_LOCK_SECONDS
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

  let charged =
    false;

  let generationMetrics = null;
  let slotHeartbeat = null;

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

    if (MODELS[modelKey]?.adminOnly && redis) {
      // Keep the existing global slot alive during long async image tests.
      slotHeartbeat = setInterval(() => {
        redis.expire("global:generation", 300).catch((error) => {
          console.error("Generation slot refresh failed:", error.message);
        });
      }, 30000);
      slotHeartbeat.unref();
    }

    const ratio =
      getRatio(
        ratioKey
      );

    await sendMessage(
      chatId,
      `🎨 GENERATING...\n\n` +
      `${modelLabel(modelKey)}\n` +
      `Quality: ${qualityLabel(
        modelKey,
        qualityKey
      )}\n` +
      `Ratio: ${modelKey === "edit" ? "SOURCE" : ratio.label}\n\n` +
      "Please wait..."
    );

    const result =
      await generateWithModel(
        modelKey,
        qualityKey,
        prompt,
        ratioKey,
        extra
      );

    generationMetrics = result?.metrics || null;

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

    charged =
      !isAdmin(
        userId
      );

    let caption =
      `✨ PIXELMETA AI\n\n` +
      `${modelLabel(modelKey)}\n` +
      `Quality: ${qualityLabel(
        modelKey,
        qualityKey
      )}\n` +
      `Ratio: ${modelKey === "edit" ? "SOURCE" : ratio.label}\n` +
      `⚡ Used: ${isAdmin(userId) ? 0 : cost} credits`;

    if (
      result.approximate &&
      ratioKey === "45"
    ) {
      caption +=
        "\n\nℹ️ 4:5 uses the closest native base ratio on this engine.";
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
    if (generationMetrics) {
      console.log("image_delivery_audit", JSON.stringify({
        ...generationMetrics, status: "delivered"
      }));
    }
  } catch (error) {
    if (generationMetrics) {
      console.error("image_delivery_audit", JSON.stringify({
        ...generationMetrics, status: "delivery_failed"
      }));
    }
    console.error(
      "Generation error:",
      error
    );

    if (
      charged
    ) {
      try {
        await addCredits(
          userId,
          cost
        );

        charged =
          false;
      } catch (refundError) {
        console.error(
          "Automatic credit refund failed:",
          refundError
        );
      }
    }

    try {
      await sendMessage(
        chatId,
        "❌ Generation failed.\n\n" +
        "The image could not be completed or delivered. Please try again later." +
        (charged
          ? "\n\nYour credit refund could not be confirmed. Please contact support."
          : "\n\nYour credits were not charged, or were automatically returned.")
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
    if (slotHeartbeat) clearInterval(slotHeartbeat);
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
    qualityKey =
      "8k";
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

async function cmdEdit(
  chatId,
  userId,
  text
) {
  if (
    !(await canAccess(
      userId,
      "edit"
    ))
  ) {
    return sendMessage(
      chatId,
      "🔒 Pixlemeta EDIT is currently in admin testing."
    );
  }

  const instruction =
    text
      .replace(
        /^\/edit/i,
        ""
      )
      .trim();

  const imageUrl =
    await rGet(
      `edit:${userId}:image`
    );

  if (!imageUrl) {
    await setFlow(
      userId,
      {
        step:
          "await_edit_image"
      }
    );

    return sendMessage(
      chatId,
      "✏️ PIXLEMETA EDIT\n\nSend the image you want to edit."
    );
  }

  if (!instruction) {
    await setFlow(
      userId,
      {
        step:
          "await_edit_prompt",
        imageUrl
      }
    );

    return sendMessage(
      chatId,
      "✍️ Image ready. Send your edit instruction."
    );
  }

  await clearFlow(
    userId
  );

  return performGeneration(
    chatId,
    userId,
    "edit",
    "pro",
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
        `⚙️ CHOOSE QUALITY\n\n` +
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
    data.startsWith("soon:") ||
    data.startsWith("v:soon:") ||
    data === "v:settings"
  ) {
    return sendMessage(
      chatId,
      "🚧 COMING SOON\n\nThis model is visible in the Studio UI but is not connected yet.\n\nNo credits were charged."
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
        "🔒 This model is currently in admin testing and is not available on your plan yet."
      );
    }

    if (
      modelKey === "edit"
    ) {
      await setFlow(
        userId,
        {
          step:
            "await_edit_image"
        }
      );

      return sendMessage(
        chatId,
        "✏️ PIXLEMETA EDIT — FLUX.1 KONTEXT PRO\n\nSend one image. After upload, send the edit instruction.\n\nNo generation starts until the instruction is received."
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
      `⚙️ CHOOSE QUALITY\n\n` +
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
        `❌ Not enough credits.\n\nRequired: ${cost}\nAvailable: ${credits}`
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
      `📐 CHOOSE ASPECT RATIO\n\n` +
      `${modelLabel(
        modelKey
      )}\n` +
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
      !RATIOS[ratioKey] ||
      (MODELS[modelKey]?.ratios && !MODELS[modelKey].ratios.includes(ratioKey))
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
      (
        modelKey === "realism" ||
        modelKey === "ultra8k"
      )
    ) {
      note =
        "\n\nℹ️ This engine uses the closest native base ratio for 4:5.";
    }

    return sendMessage(
      chatId,
      `✍️ SEND YOUR PROMPT\n\n` +
      `${modelLabel(
        modelKey
      )}\n` +
      `Quality: ${qualityLabel(
        modelKey,
        qualityKey
      )}\n` +
      `Ratio: ${ratio.label}` +
      note +
      "\n\nExample:\nA realistic portrait in natural daylight, authentic skin texture"
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

  const currentFlow =
    await getFlow(
      userId
    );

  if (message.photo?.length) {
    if (
      currentFlow?.step !==
      "await_edit_image"
    ) {
      return sendMessage(
        chatId,
        "📷 Image received.\n\nTo edit it, open IMAGE STUDIO → EDIT, then send the image again."
      );
    }

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
        `edit:${userId}:image`,
        url,
        1800
      );

      await setFlow(
        userId,
        {
          step:
            "await_edit_prompt",
          imageUrl:
            url
        }
      );

      return sendMessage(
        chatId,
        "✅ Image ready for EDIT.\n\nNow send your edit instruction.\n\nExample: Change the background to a premium studio while keeping the person unchanged."
      );
    } catch (error) {
      console.error(
        "EDIT photo handling error:",
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
    command === "/edit"
  ) {
    return cmdEdit(
      chatId,
      userId,
      text
    );
  }

  if (
    command === "/shark"
  ) {
    return sendMessage(
      chatId,
      "ℹ️ SHARK V1 has been retired. Use /edit or IMAGE STUDIO → EDIT."
    );
  }

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

  const flow =
    await getFlow(
      userId
    );

  if (
    flow?.step ===
    "await_edit_prompt"
  ) {
    const instruction =
      clampPrompt(text);

    const imageUrl =
      flow.imageUrl ||
      await rGet(
        `edit:${userId}:image`
      );

    if (!imageUrl) {
      await setFlow(
        userId,
        {
          step:
            "await_edit_image"
        }
      );

      return sendMessage(
        chatId,
        "📷 Source image expired. Please send the image again."
      );
    }

    await clearFlow(
      userId
    );

    return performGeneration(
      chatId,
      userId,
      "edit",
      "pro",
      "sq",
      instruction,
      {
        imageUrl
      }
    );
  }

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
    "Use /gen to start.\n\nOr choose an option below:",
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
    action === "settrial" &&    target
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
      release: "image-admin-tests-v2",
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
