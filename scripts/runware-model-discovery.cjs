"use strict";
// Metadata-only Runware catalog discovery. Never performs imageInference or uploads.
// Run locally: RUNWARE_API_KEY=... node scripts/runware-model-discovery.cjs
// Or run within an already-authorized environment. Do not expose this as a public bot command.
const { randomUUID } = require("crypto");
const key = process.env.RUNWARE_API_KEY;
if (!key) { console.error("RUNWARE_API_KEY is required; no API call made."); process.exit(1); }
const searches = [
  { search: "pony", category: "checkpoint", limit: 20, offset: 0 },
  { search: "cyberrealistic", category: "checkpoint", limit: 20, offset: 0 },
  { search: "realistic", category: "checkpoint", architecture: "sdxl", limit: 20, offset: 0 }
];
async function main() {
  for (const q of searches) {
    const response = await fetch("https://api.runware.ai/v1", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify([{ taskType: "modelSearch", taskUUID: randomUUID(), ...q }]),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) { console.error(q.search + ": HTTP " + response.status); continue; }
    const data = await response.json();
    if (data.errors?.length) { console.error(q.search + ": model search rejected"); continue; }
    // Print only catalog fields; no keys, private prompts or user data.
    const entries = data.data || [];
    console.log(JSON.stringify({ query: q, models: entries.map(m => ({
      air: m.air || m.model || null, name: m.name || null,
      architecture: m.architecture || null, category: m.category || null,
      license: m.license || null, price: m.price || null
    })) }, null, 2));
  }
}
main().catch(e => { console.error("Catalog lookup failed: " + (e.name || "unknown")); process.exitCode = 1; });
