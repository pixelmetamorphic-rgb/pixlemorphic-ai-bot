// Offline regression tests; no credentials, network, Redis, or listening server.
// Run: node --test tests/runware.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const admin = "1078816855";
const keys = ["flux2klein9b", "seedream50lite", "qwenimage30pro", "seedream50pro"];

function boot(fetchHandler, env = {}) {
  const requests = [], logs = [], values = new Map();
  let clock = 0;
  const app = { use() {}, disable() {}, get() {}, post() {}, listen() {} };
  const express = () => app;
  express.json = () => () => {};
  const context = vm.createContext({
    require(name) {
      if (name === "dotenv") return { config() {} };
      if (name === "express") return express;
      if (name === "crypto") return require("node:crypto");
      if (name === "ioredis") return class {};
      if (name === "form-data") return class { append() {} getHeaders() { return {}; } };
      if (name === "node-fetch") return async (url, options) => {
        requests.push({ url, options });
        return fetchHandler(url, options, requests.length);
      };
      throw new Error("Unexpected dependency " + name);
    },
    URL, Buffer, AbortController,
    Date: class extends Date { static now() { return clock; } },
    process: { env: { RUNWARE_API_KEY: "fake-test-key", TG_TOKEN: "fake-token", ...env }, on() {} },
    console: Object.fromEntries(["log", "warn", "error"].map(k => [k, (...args) => logs.push(args)])),
    setTimeout(fn, ms) { clock += ms; fn(); return 1; },
    clearTimeout() {},
    setInterval() { return { unref() {} }; }, clearInterval() {}
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  context.testValues = values;
  run(`redis = {
    get: async k => testValues.get(k) ?? null,
    set: async (k,v) => { testValues.set(k,v); return "OK"; },
    del: async k => testValues.delete(k),
    incr: async k => { const n=Number(testValues.get(k)||0)+1; testValues.set(k,n); return n; },
    decr: async k => { const n=Number(testValues.get(k)||0)-1; testValues.set(k,n); return n; },
    expire: async () => 1,
    eval: async (_s,_n,k,cost) => {
      const n=Number(testValues.get(k)||0);
      if(n<cost) return 0; testValues.set(k,n-cost); return 1;
    }
  };`);
  return { run, context, requests, logs, values };
}
const ok = data => ({ ok: true, status: 200, json: async () => data });
test("every selectable model exists after legacy cleanup", () => {
  const h = boot(success);
  const buttons = h.run(`imageKeyboard("${admin}").inline_keyboard.flat()`);
  for (const b of buttons) {
    if (b.callback_data.startsWith("m:")) {
      assert.ok(h.run(`MODELS["${b.callback_data.slice(2)}"]`), b.text);
    }
  }
});

test("8K master validates real PNG dimensions and submits exactly one upscale", async () => {
  for (const scenario of ["ok", "small-source", "small-output", "wrong-ratio", "failed-upscale", "invalid-png"]) {
    const calls = [];
    const h = boot(async url => {
      const base = url.endsWith("/base");
      const size = base ? (scenario === "small-source" ? 2048 : 4096) :
        (scenario === "small-output" ? 4096 : 8192);
      const header = Buffer.alloc(24);
      Buffer.from("89504e470d0a1a0a", "hex").copy(header);
      header.writeUInt32BE(13, 8); header.write("IHDR", 12);
      header.writeUInt32BE(size, 16);
      header.writeUInt32BE(scenario === "wrong-ratio" ? size / 2 : size, 20);
      if (scenario === "invalid-png") header[0] = 0;
      return { ok: true, status: 206,
        headers: { get: k => k === "content-range" ? "bytes 0-23/70000000" : null },
        body: (async function* () { yield header.subarray(0, 10); yield header.subarray(10); })()
      };
    });
    h.context.stageCall = async (model, input) => {
      calls.push({model, input});
      if (calls.length === 2 && scenario === "failed-upscale") throw new Error("upscale failed");
      return calls.length === 1 ? {images:[{url:"https://images.example/base"}]} :
        {image:{url:"https://images.example/final"}};
    };
    h.run("falQueueRun = stageCall");
    if (scenario === "ok") {
      const result = await h.run('generateWithModel("nano8kmaster","8k","a realistic watch","sq")');
      assert.equal(result.width, 8192); assert.equal(result.height, 8192);
      assert.equal(result.fileSize, 70000000);
      assert.equal(calls[0].input.resolution, "4K");
      assert.equal(calls[1].model, "topaz/upscale/image/precision");
      assert.equal(calls[1].input.upscale_factor, 2);
      assert.equal(calls[1].input.face_enhancement, false);
      assert.equal(calls[1].input.output_format, "png");
    } else {
      await assert.rejects(h.run('falNano8KMaster("a watch","sq")'));
    }
    assert.equal(calls.length, ["small-source","wrong-ratio","invalid-png"].includes(scenario) ? 1 : 2);
  }
});

test("8K original is delivered as document or download without another generation", async () => {
  for (const mode of ["document", "oversize", "telegram-failure"]) {
    const h = boot(success, { RAILWAY_PUBLIC_DOMAIN: "bot.example.com" });
    h.context.mode = mode;
    h.run(`globalThis.docs = []; globalThis.messages = [];
      sendDocument = async (...args) => { docs.push(args); if (mode === "telegram-failure") throw Error("delivery"); };
      sendMessage = async (...args) => messages.push(args);`);
    h.context.bytes = mode === "oversize" ? 70000000 : 100;
    await h.run('deliver8KMaster(123,{url:"https://v3b.fal.media/master.png",fileSize:bytes},"8K")');
    assert.equal(h.context.docs.length, mode === "oversize" ? 0 : 1);
    assert.equal(h.context.messages.length, mode === "document" ? 0 : 1);
    if (h.context.messages.length) {
      assert.match(h.context.messages[0][1], /https:\/\/bot.example.com\/download\//);
      assert.doesNotMatch(h.context.messages[0][1], /fal\.media/);
    }
    assert.equal(h.requests.length, 0);
  }
});
test("private download streams bytes without exposing upstream and rejects missing tokens", async () => {
  for (const mode of ["ok", "expired", "upstream-error"]) {
    let piped = false;
    const h = boot(async (_url, options) => {
      assert.equal(options.redirect, "error");
      if (mode === "upstream-error") throw Error("https://secret.fal.media/file.png");
      return { ok: true, headers: { get: k => k === "content-type" ? "image/png" : "123" },
        body: { on() {}, destroy() {}, pipe() { piped = true; } } };
    }, { RAILWAY_PUBLIC_DOMAIN: "bot.example.com" });
    const url = await h.run('createPrivateDownload("https://v3b.fal.media/source.png")');
    const token = url.split("/").pop();
    if (mode === "expired") h.values.delete("download:" + token);
    let status = 200, body = "";
    const headers = {};
    h.context.req = { params: { token } };
    h.context.res = { headersSent: false, on() {}, destroy() {},
      setHeader(k,v) { headers[k] = v; },
      status(s) { status = s; return this; }, send(s) { body = s; } };
    await h.run("handlePrivateDownload(req,res)");
    assert.equal(piped, mode === "ok");
    assert.equal(status, mode === "ok" ? 200 : mode === "expired" ? 404 : 502);
    assert.doesNotMatch(JSON.stringify(headers) + body, /fal.media|source.png/);
    if (mode === "ok") assert.match(headers["Content-Disposition"], /PIXLEMORPHIC/);
    if (mode === "expired") assert.equal(h.requests.length, 0);
  }
});

test("download creation fails closed without configuration and rejects foreign URLs", async () => {
  const h = boot(success);
  await assert.rejects(h.run('createPrivateDownload("https://v3b.fal.media/a.png")'));
  await assert.rejects(h.run('createPrivateDownload("https://evil.example/a.png")'));
  assert.equal(h.values.size, 0);
});
function success(_url, options) {
  const [task] = JSON.parse(options.body);
  return ok({ data: [{ taskUUID: task.taskUUID, imageURL: "https://images.example/result.jpg", cost: 0.035 }] });
}

test("new models are hidden and denied for every non-admin plan, including stored admin", async () => {
  const h = boot(success);
  for (const plan of ["trial", "promo", "paid", "admin"]) {
    h.values.set("u:123:plan", plan);
    for (const key of [...keys, "zimageturbo", "nanobananapro", "nanobananaproedit", "ideogramv3", "nano8kmaster"]) {
      assert.equal(await h.run(`canAccess(123, "${key}")`), false);
      assert.equal(await h.run(`canAccess("${admin}", "${key}")`), true);
      assert.ok(!h.run("JSON.stringify(imageKeyboard(123))").includes(key));
      assert.ok(h.run(`JSON.stringify(imageKeyboard("${admin}"))`).includes(key));
    }
  }
  h.run("sendMessage = async (_chat,text) => text");
  const publicCatalog = await h.run("cmdModels(123,123)");
  const privateCatalog = await h.run(`cmdModels("${admin}","${admin}")`);
  for (const key of [...keys, "zimageturbo", "nanobananapro", "nanobananaproedit", "ideogramv3", "nano8kmaster"]) {
    const label = h.run(`MODELS["${key}"].label`);
    assert.ok(!publicCatalog.includes(label));
    assert.ok(privateCatalog.includes(label));
  }
  assert.ok(!/runware|fal|replicate|openrouter/i.test(publicCatalog + privateCatalog));
});

test("all model/quality/ratio choices generate valid bounds and one matching task with cost enabled", async () => {
  const h = boot(success);
  for (const key of keys) {
    const model = h.run(`MODELS["${key}"]`);
    for (const quality of Object.keys(model.qualities)) {
      for (const ratio of model.ratios || ["sq", "45", "34", "169", "916"]) {
        const result = await h.run(`generateWithModel("${key}","${quality}","a landscape","${ratio}")`);
        assert.equal(result.metrics.costUSD, 0.035);
        const request = h.requests.at(-1);
        const [task] = JSON.parse(request.options.body);
        assert.equal(request.url, "https://api.runware.ai/v1");
        assert.equal(task.includeCost, true);
        assert.equal(task.numberResults, 1);
        assert.equal(task.outputFormat, "JPG");
        assert.equal(task.deliveryMethod, "async");
        assert.match(task.taskUUID, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
        assert.ok(task.width % 16 === 0 && task.height % 16 === 0);
        if (key === "flux2klein9b") assert.ok(Math.max(task.width,task.height) <= 2048);
        if (key === "seedream50pro") assert.ok(task.width * task.height >= 921600 && task.width * task.height <= 4624220);
        if (key === "qwenimage30pro") assert.ok(task.width * task.height <= 4194304);
      }
    }
  }
  assert.ok(!h.run('JSON.stringify(ratioKeyboard("seedream50lite","2k"))').includes(":45"));
  await assert.rejects(h.run('generateWithModel("seedream50lite","2k","a landscape","45")'));
});

test("async polling uses original UUID and never resubmits inference", async () => {
  const tasks = [];
  const h = boot((_url, options) => {
    const [task] = JSON.parse(options.body); tasks.push(task);
    return tasks.length < 3
      ? ok({ data: [{ taskUUID: task.taskUUID, status: "processing" }] })
      : success(_url,options);
  });
  const result = await h.run('generateWithModel("seedream50lite","2k","a landscape","sq")');
  assert.equal(tasks.filter(t => t.taskType === "imageInference").length, 1);
  assert.ok(tasks.every(t => t.taskUUID === tasks[0].taskUUID));
  assert.equal(result.metrics.generationMs, 6000);
});

test("provider failure, mismatched result, invalid URL, bad JSON and timeout fail without resubmission", async () => {
  const failures = [
    () => ok({ errors: [{ message: "Runware secret body" }] }),
    () => ok({ data: [{ taskUUID: "wrong", imageURL: "https://images.example/x" }] }),
    (_u,o) => ok({ data: [{ taskUUID: JSON.parse(o.body)[0].taskUUID, imageURL: "file:///etc/passwd" }] }),
    () => ({ ok: true, json: async () => { throw new Error("bad JSON"); } }),
    () => ({ ok: false, status: 401 }),
    () => { throw new Error("network timeout"); },
    (_u,o) => ok({ data: [{ taskUUID: JSON.parse(o.body)[0].taskUUID, status: "processing" }] })
  ];
  for (const handler of failures) {
    const h = boot(handler);
    await assert.rejects(h.run('generateWithModel("flux2klein9b","1k","a landscape","sq")'), /could not complete/);
    assert.equal(h.requests.filter(r => JSON.parse(r.options.body)[0].taskType === "imageInference").length, 1);
    assert.ok(!JSON.stringify(h.logs).includes("fake-test-key"));
  }
  const h = boot(success, { RUNWARE_API_KEY: "" });
  await assert.rejects(h.run('generateWithModel("flux2klein9b","1k","a landscape","sq")'));
  assert.equal(h.requests.length, 0);
});

test("generation blocks unauthorized users before provider requests and never charges admin tests", async () => {
  const h = boot(success);
  h.context.messages = []; h.context.delivered = [];
  h.run("sendMessage = async (_chat,text) => messages.push(text); sendPhoto = async (...args) => delivered.push(args)");
  await h.run('performGeneration(123,123,"flux2klein9b","1k","sq","a landscape")');
  assert.equal(h.requests.length, 0);
  h.values.set(`u:${admin}:credits`, 100);
  await h.run(`performGeneration("${admin}","${admin}","flux2klein9b","1k","sq","a landscape")`);
  assert.equal(h.values.get(`u:${admin}:credits`), 100);
  assert.equal(h.context.delivered.length, 1);
  assert.match(h.context.delivered[0][2], /Used: 0 credits/);
  assert.ok(h.logs.some(l => l[0] === "image_delivery_audit" && l[1].includes('"delivered"')));
  h.run('sendPhoto = async () => { throw new Error("Runware upstream secret"); }');
  await h.run(`performGeneration("${admin}","${admin}","flux2klein9b","1k","sq","a landscape")`);
  assert.ok(!/runware|upstream secret/i.test(h.context.messages.join(" ")));
  assert.equal(h.values.get(`u:${admin}:credits`), 100);
  assert.ok(h.logs.some(l => l[0] === "image_delivery_audit" && l[1].includes('"delivery_failed"')));
});

test("existing customer credit behavior survives: success deducts, provider failure does not, delivery failure refunds", async () => {
  const h = boot(success);
  h.values.set("u:123:plan", "trial"); h.values.set("u:123:credits", 100);
  h.run('sendMessage = async () => {}; sendPhoto = async () => {}; generateWithModel = async () => ({url:"https://images.example/x"})');
  await h.run('performGeneration(123,123,"gptimage2","2k","sq","a landscape")');
  assert.equal(h.values.get("u:123:credits"), 75);
  h.run('sendPhoto = async () => { throw new Error("delivery failed"); }');
  await h.run('performGeneration(123,123,"gptimage2","2k","sq","a landscape")');
  assert.equal(h.values.get("u:123:credits"), 75);
  h.run('generateWithModel = async () => { throw new Error("generation failed"); }');
  await h.run('performGeneration(123,123,"gptimage2","2k","sq","a landscape")');
  assert.equal(h.values.get("u:123:credits"), 75);
});

test("existing Telegram fallback downloads image then uploads it, and large images become documents", async () => {
  for (const large of [false, true]) {
    const h = boot((url,options) => {
      if (url === "https://images.example/x") {
        return { ok: true, body: Buffer.from("fake-image"), headers: { get: name => name === "content-length" ? String(large ? 12000000 : 100) : "image/jpeg" } };
      }
      if (url.endsWith("/sendPhoto") && typeof options.body === "string") return ok({ ok: false });
      if (url.endsWith("/sendDocument")) return ok({ ok: true, result: { document: true } });
      return { ok: true, text: async () => JSON.stringify({ok:true,result:{photo:true}}) };
    });
    const result = await h.run('sendPhoto(123,"https://images.example/x","test")');
    assert.equal(large ? result.document : result.photo, true);
  }
});

test("Kie Nano 2 all resolutions create one job, upload edits without Telegram token, poll and return image", async () => {
  for (const quality of ["1k", "2k", "4k"]) for (const edit of [false, true]) {
    let polls = 0;
    const h = boot(async (url, options) => {
      if (url.startsWith("https://api.telegram.org/file/")) return {
        ok: true, headers: { get: () => "image/jpeg" }, buffer: async () => Buffer.from("test-image")
      };
      if (url.includes("file-base64-upload")) {
        assert.ok(!options.body.includes("fake-token"));
        return ok({ code: 200, data: { downloadUrl: "https://tempfile.redpandaai.co/input.jpg" } });
      }
      if (url.endsWith("createTask")) {
        const body = JSON.parse(options.body);
        assert.equal(body.model, "nano-banana-2");
        assert.equal(body.input.resolution, quality.toUpperCase());
        assert.equal(body.input.aspect_ratio, "4:5");
        assert.equal(body.input.image_input.length, edit ? 1 : 0);
        assert.ok(!options.body.includes("fake-token"));
        return ok({ code: 200, data: { taskId: "job-123" } });
      }
      assert.ok(url.endsWith("recordInfo?taskId=job-123"));
      return ok({ code: 200, data: { taskId: "job-123", state: ++polls === 1 ? "waiting" : "success",
        resultJson: JSON.stringify({ resultUrls: ["https://images.example/result.png"] }) } });
    }, { KIE_API_KEY: "test-key" });
    const result = await h.run(`generateWithModel("nanobanana2${edit ? "edit" : ""}","${quality}","blue blanket","45",${edit ? '{imageUrl:"https://api.telegram.org/file/botfake-token/photos/test.jpg"}' : '{}'})`);
    assert.equal(result.url, "https://images.example/result.png");
    assert.equal(h.requests.filter(r => r.url.endsWith("createTask")).length, 1);
    assert.equal(await h.run('canAccess("123", "nanobanana2")'), false);
    assert.equal(await h.run('canAccess("123", "nanobanana2edit")'), false);
  }
});

test("Kie errors never resubmit paid jobs or expose provider details", async () => {
  for (const scenario of ["reject", "fail", "bad-url", "mismatch", "timeout"]) {
    const h = boot(async url => {
      if (url.endsWith("createTask")) return ok({ code: scenario === "reject" ? 402 : 200, data: {taskId:"job"} });
      return ok({code:200, data:{taskId:scenario === "mismatch" ? "other" : "job",
        state: scenario === "timeout" ? "waiting" : scenario === "fail" ? "fail" : "success",
        resultJson: JSON.stringify({resultUrls:["http://unsafe.example/image"]})}});
    }, {KIE_API_KEY:"test-key"});
    await assert.rejects(h.run('kieNano2Generate("cat","4k","sq")'), /could not complete/);
    assert.equal(h.requests.filter(r=>r.url.endsWith("createTask")).length,1);
  }
  const h=boot(()=>{throw new Error("Network must not run");});
  await assert.rejects(h.run('kieNano2Generate("cat","1k","sq")'), /not configured/);
  assert.equal(h.requests.length,0);
});

test("Nano 2 edit menu retains selected resolution and ratio through photo and prompt", async () => {
  const h=boot(async url=>ok({ok:true,result:url.endsWith("getFile") ? {file_path:"photos/input.jpg"} : {message_id:1}}));
  const calls=[];
  h.context.captureGeneration=(...args)=>calls.push(args);
  h.run('performGeneration = captureGeneration');
  for(const data of ['m:nanobanana2edit','q:nanobanana2edit:4k','r:nanobanana2edit:4k:169']) {
    await h.run(`onCallback({id:"cb",from:{id:"${admin}"},message:{chat:{id:1}},data:${JSON.stringify(data)}})`);
  }
  assert.equal((await h.run(`getFlow("${admin}")`)).step,"await_edit_image");
  await h.run(`onMessage({chat:{id:1},from:{id:"${admin}"},photo:[{file_id:"photo"}]})`);
  const flow=await h.run(`getFlow("${admin}")`);
  assert.equal(flow.qualityKey,"4k"); assert.equal(flow.ratioKey,"169");
  await h.run(`onMessage({chat:{id:1},from:{id:"${admin}"},text:"make blanket blue"})`);
  assert.equal(calls.length,1);
  assert.equal(calls[0][2],"nanobanana2edit");
  assert.equal(calls[0][3],"4k"); assert.equal(calls[0][4],"169");
  assert.ok(calls[0][6].imageUrl.endsWith("photos/input.jpg"));
});
