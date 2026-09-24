"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const begin = source.indexOf("// Additional Kling modes stay ADMIN ONLY");
const end = source.indexOf("function pickKlingVideo(result)", begin);
assert.ok(begin >= 0 && end > begin, "Kling extra stage must exist");
const snippet = source.slice(begin, end);
function sandbox(extra) {
  const env = { KLING_EXTRA_ENABLED: "false" };
  const context = {
    process: { env }, KLING_T2V_ENABLED: true, KLING_TEST_MAX_USD: 0.5,
    isAdmin: () => true, sendMessage: async (_chat, message) => message,
    ...(extra || {})
  };
  vm.createContext(context);
  vm.runInContext(snippet, context, { filename: "kling-mode-snippet.js" });
  return context;
}
test("four verified non-T2V Kling modes use explicit FAL endpoints", () => {
  const ctx = sandbox();
  const modes = vm.runInContext("KLING_EXTRA_MODES", ctx);
  assert.equal(Object.keys(modes).length, 4);
  assert.equal(modes.i2v.model, "fal-ai/kling-video/v3/standard/image-to-video");
  assert.equal(modes.refimage.model, "fal-ai/kling-video/o3/standard/reference-to-video");
  assert.equal(modes.refvideo.model, "fal-ai/kling-video/o3/standard/video-to-video/reference");
  assert.equal(modes.edit.model, "fal-ai/kling-video/o3/standard/video-to-video/edit");
  assert.equal(modes.refimage.kind, "photo");
  assert.equal(modes.refvideo.kind, "video");
  assert.equal(modes.edit.rate, .126);
});
test("additional modes cannot charge with extra-mode kill switch OFF", async () => {
  const ctx = sandbox();
  const msg = await vm.runInContext(
    "submitKlingExtraMode(123,456,{mode:'i2v',fileId:'mock',duration:3},'safe prompt')", ctx
  );
  assert.match(msg, /disabled/);
});
test("old $0.50 shared budget guard still exists", () => {
  assert.match(source, /reserveKlingTestBudget\(estimateUSD\)/);
  assert.match(source, /kling:admin:total_test_reserved_usd_micro/);
  assert.match(source, /KLING_EXTRA_ENABLED &&?/);
  assert.match(source, /videojob:kling:/);
});
