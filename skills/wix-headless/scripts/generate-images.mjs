#!/usr/bin/env node
// Parallel image generator + Wix Media importer.
//
// WHY THIS EXISTS. Image generation is N independent (generate → import) chains
// with no cross-image dependency, so it is embarrassingly parallel. When the
// agent drives it by hand the chains serialize into minutes of avoidable wall.
// The agent ALSO cannot use the
// single-array batch form on the default model (`google:4@2` 504s when one
// request carries N≥3 tasks). This script resolves both: it fires N *separate
// single-task* requests CONCURRENTLY in-process (Promise.all), so there is no
// per-turn serialization to lose and no N≥3-in-one-request 504 to hit. It is
// the deterministic analog of the "one concurrent batch" rule the prose docs
// ask the agent to follow by hand.
//
// SCOPE. Generation + Wix Media import ONLY — the parallelizable, recipe-free
// half. It returns a key→{url,fileId} map. Attachment stays where the recipe
// knowledge lives: Phase 1 decorative URLs flow into write-decorative-json.mjs;
// Phase 2 entity URLs flow into the per-entity PATCH/PUT/publish plan from
// plan-entity-image-waves.mjs. This script never touches frontend source or
// Wix entities.
//
// Phase-agnostic: `key` is a slot name for Phase 1 (`hero`, `about`) or an
// entityId for Phase 2. The caller interprets the returned map.
//
// AUTH (references/shared/AUTHENTICATION.md). Site-scoped REST token, minted
// once per run and reused. Pass it in via the WIX_TOKEN env var (preferred —
// honors mint-once) or the stdin `token` field. As a last resort the script
// mints one itself with `npx @wix/cli@latest token --site <siteId>` in
// <projectDir>; that costs a CLI spin-up, so prefer passing the cached token.
//
// USAGE
//   echo '{
//     "siteId": "ed57...",
//     "model": "google:4@2",
//     "projectDir": "/abs/path/frenchiesgoodies",   // only needed if minting
//     "images": [
//       {"key":"hero","positivePrompt":"...","width":1376,"height":768},
//       {"key":"about","positivePrompt":"...","width":1200,"height":896}
//     ]
//   }' | WIX_TOKEN="$TOKEN" node generate-images.mjs
//
// OUTPUT (stdout, JSON)
//   {
//     "status": "complete" | "partial" | "failed",
//     "model": "google:4@2",
//     "count": { "requested": 2, "ok": 2, "failed": 0 },
//     "map":   { "hero": {"url":"https://static.wixstatic.com/...","fileId":"..~mv2.png"} },
//     "slots": { "hero": "https://static.wixstatic.com/..." },   // key→url, ready for write-decorative-json.mjs
//     "results": [ {"key":"hero","taskUUID":"..","status":"ok","genReqId":"..","importReqId":".."} ],
//     "errors":  [ {"key":"about","stage":"generate","code":"504","message":".."} ]
//   }
// Exit 0 on complete/partial, 1 on failed (zero images succeeded) or bad input.
// x-wix-request-id is captured per call into results[] for trace analysis — it
// is never printed to stderr or narrated (CLAUDE.md run policy).

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const RUNWARE_URL = "https://www.wixapis.com/runwareschemaless/v1/request";
const MEDIA_IMPORT_URL = "https://www.wixapis.com/site-media/v1/files/import";
const GEN_TIMEOUT_MS = 120_000;   // google:4@2 is slow; generous per-task cap
const IMPORT_TIMEOUT_MS = 60_000;
const ALLOWED_DIMS = [[1024, 1024], [1376, 768], [1200, 896]];

function fail(reason) {
  console.log(JSON.stringify({ status: "failed", reason }, null, 2));
  process.exit(1);
}

// ---- input ----------------------------------------------------------------
let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch (e) {
  fail(`stdin is not valid JSON (${e.message})`);
}
const siteId = input.siteId;
const model = input.model || "google:4@2";
const images = Array.isArray(input.images) ? input.images : [];
if (!siteId) fail("siteId is required");
if (images.length === 0) fail("no images in input — nothing to generate");

// ---- token (mint-once: prefer env/field, mint only as fallback) -----------
let token = process.env.WIX_TOKEN || input.token;
if (!token) {
  try {
    token = execFileSync("npx", ["@wix/cli@latest", "token", "--site", siteId], {
      cwd: input.projectDir || process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (e) {
    fail(`no token: pass WIX_TOKEN env or stdin "token", or run where the CLI can mint (${e.message})`);
  }
}
if (!token) fail("token minting returned empty");

const baseHeaders = {
  Authorization: `Bearer ${token}`,
  "wix-site-id": siteId,
  "Content-Type": "application/json",
};

// ---- one fetch with timeout + reqid capture -------------------------------
async function call(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const reqId = res.headers.get("x-wix-request-id") || null;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    return { ok: res.ok, status: res.status, reqId, json, raw: text };
  } finally {
    clearTimeout(t);
  }
}

function normalizeDims(w, h) {
  if (ALLOWED_DIMS.some(([aw, ah]) => aw === w && ah === h)) return [w, h];
  return [1024, 1024]; // safe default — Runware rejects free-form sizes (400)
}

// Generate one image (single-task body — the form the default model accepts),
// then import it to Wix Media. Returns a per-image record; never throws.
async function genAndImport(img) {
  const key = img.key;
  const taskUUID = img.taskUUID || randomUUID();
  const [width, height] = normalizeDims(img.width ?? 1024, img.height ?? 1024);
  const outputFormat = (img.outputFormat || "PNG").toUpperCase();
  const rec = { key, taskUUID, status: "failed", genReqId: null, importReqId: null };

  if (!img.positivePrompt) {
    return { ...rec, error: { key, stage: "input", code: "NO_PROMPT", message: "positivePrompt missing" } };
  }

  // --- generate (retry once on transient 5xx/504/timeout) ---
  const task = {
    taskType: "imageInference",
    taskUUID,
    outputType: "URL",
    outputFormat,
    positivePrompt: img.positivePrompt,
    width,
    height,
    model,
    numberResults: 1,
    // NB: never send `steps`/`CFGScale` — google:4@2 rejects them (400).
  };
  let gen, imageURL;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      gen = await call(RUNWARE_URL, [task], GEN_TIMEOUT_MS);
    } catch (e) {
      gen = { ok: false, status: e.name === "AbortError" ? 504 : 0, reqId: null, json: null, raw: String(e) };
    }
    rec.genReqId = gen.reqId;
    const data = Array.isArray(gen.json?.data) ? gen.json.data : null;
    imageURL = data?.[0]?.imageURL;
    if (gen.ok && imageURL) break;
    // transient → retry once; hard 4xx (except 504-shaped) → give up
    const transient = gen.status >= 500 || gen.status === 504 || gen.status === 0;
    if (!transient || attempt === 1) {
      return {
        ...rec,
        error: {
          key, stage: "generate", code: String(gen.status),
          message: gen.json?.errors?.[0]?.message || gen.json?.errorMessage || gen.raw?.slice(0, 200) || "no imageURL in response",
          reqId: gen.reqId,
        },
      };
    }
  }

  // --- import to Wix Media ---
  let imp;
  try {
    imp = await call(MEDIA_IMPORT_URL, {
      url: imageURL,
      mimeType: outputFormat === "JPG" ? "image/jpeg" : "image/png",
      displayName: img.displayName || `${key}.${outputFormat.toLowerCase()}`,
    }, IMPORT_TIMEOUT_MS);
  } catch (e) {
    imp = { ok: false, status: 0, reqId: null, json: null, raw: String(e) };
  }
  rec.importReqId = imp.reqId;
  const file = imp.json?.file;
  if (!imp.ok || !file?.url) {
    return {
      ...rec,
      error: {
        key, stage: "import", code: String(imp.status),
        message: imp.json?.message || imp.raw?.slice(0, 200) || "no file.url in import response",
        reqId: imp.reqId,
      },
      // generation succeeded — surface the raw URL so the caller can decide
      genURL: imageURL,
    };
  }

  return { ...rec, status: "ok", url: file.url, fileId: file.fileUrl }; // Wix returns the file ID in .fileUrl (not .url)
}

// ---- run all in parallel --------------------------------------------------
const settled = await Promise.allSettled(images.map(genAndImport));
const results = settled.map((s, i) =>
  s.status === "fulfilled" ? s.value
    : { key: images[i].key, status: "failed", error: { key: images[i].key, stage: "internal", message: String(s.reason) } });

const map = {};
const slots = {};
const errors = [];
let okCount = 0;
for (const r of results) {
  if (r.status === "ok") {
    okCount++;
    map[r.key] = { url: r.url, fileId: r.fileId };
    slots[r.key] = r.url;
  } else if (r.error) {
    errors.push(r.error);
  }
}

const status = okCount === images.length ? "complete" : okCount === 0 ? "failed" : "partial";
console.log(JSON.stringify({
  status,
  model,
  count: { requested: images.length, ok: okCount, failed: images.length - okCount },
  map,
  slots,
  results: results.map(({ url, fileId, genURL, ...keep }) => keep), // keep slim; urls live in map
  errors,
}, null, 2));

process.exit(status === "failed" ? 1 : 0);
