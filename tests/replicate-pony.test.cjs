"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../index.js"), "utf8");
const start = source.indexOf("const REPLICATE_PONY =");
const end = source.indexOf("/* =========================\n   REPLICATE SDXL", start);
assert.ok(start > 0 && end > start, "Pony implementation present");
function harness(responses, token = "fake-test-token") {
  const calls = [];
  const context = {
    REPLICATE_API_TOKEN: token,
    getRatio: () => ({ label: "1:1" }),
    sleep: async () => {},
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      const next = responses.shift();
      if (!next) throw Error("Unexpected extra request");
      return { ok: next.ok ?? true, status: next.http ?? 200, json: async () => next.body };
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return { calls, run: (engine, prompt, quality = "1k", ratio = "sq") =>
    vm.runInContext("replicatePonyGenerate", context)(engine, prompt, quality, ratio) };
}
test("Replicate Pony uses verified version, 1K, one create, and polls", async () => {
  const h = harness([
    { body: { status: "starting", urls: { get: "https://api.replicate.com/v1/predictions/abc123" } } },
    { body: { status: "succeeded", output: ["https://replicate.delivery/output.png"] } }
  ]);
  const out = await h.run("replicate_pony_realism_v23", "adult landscape");
  assert.equal(out.url, "https://replicate.delivery/output.png");
  assert.equal(h.calls.length, 2);
  const body = JSON.parse(h.calls[0].opts.body);
  assert.equal(body.version, "fc052d05249cf7a1657f004eddc1e5f50618aa11cb2df19b960c377ee8a7ceb3");
  assert.equal(body.input.width, 1024);
  assert.equal(body.input.height, 1024);
  assert.equal(body.input.batch_size, 1);
  assert.equal(h.calls[1].url, "https://api.replicate.com/v1/predictions/abc123");
});
test("Cyber Pony uses its own published model version", async () => {
  const h = harness([{ body: { status: "succeeded", urls: { get: "https://api.replicate.com/v1/predictions/abc123" }, output: ["https://replicate.delivery/1.png"] } }]);
  await h.run("replicate_cyber_pony_v8", "adult portrait");
  assert.equal(JSON.parse(h.calls[0].opts.body).version,
    "76125795acdc8610c8b2d0352e691735054f0fbf31e1a1ae46fbc51b4dcc9ab5");
});
test("No API token means no paid request", async () => {
  const h = harness([], "");
  await assert.rejects(h.run("replicate_pony_realism_v23", "portrait"), /not configured/);
  assert.equal(h.calls.length, 0);
});
test("Failed creation does not create a second prediction", async () => {
  const h = harness([{ ok: false, http: 403, body: { detail: "Forbidden" } }]);
  await assert.rejects(h.run("replicate_pony_realism_v23", "portrait"), /creation failed/);
  assert.equal(h.calls.length, 1);
});
test("Models and UI remain private experimental routes", () => {
  assert.match(source, /ponyrealism23:[\s\S]*?adminOnly: true/);
  assert.match(source, /cyberpony8:[\s\S]*?adminOnly: true/);
  assert.match(source, /callback_data: "m:ponyrealism23"/);
  assert.match(source, /callback_data: "m:cyberpony8"/);
  assert.match(source, /ADULT IMAGE • EXPERIMENTAL/);
});
