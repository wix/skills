#!/usr/bin/env node
// Merge per-pack seed-subagent returns into .wix/site.json's `seeded` block.
//
// Inputs:
//   <project-dir>/.wix/seed-returns/<pack>.json — one file per dispatched
//   subagent. Each file is the subagent's return verbatim:
//     {
//       "phase": "seed-<pack>",
//       "status": "ok" | "skipped" | "error",
//       "seeded": { <pack-specific keys> },
//       "recipeCalls": [{ "url": "...", "status": 200 }, ...]
//     }
//
// Output:
//   <project-dir>/.wix/site.json — the existing `seeded` map gets
//   `seeded[<pack>]` populated with `{status, ...known keys, notes?,
//   recipeCalls}`. Orchestrator is the sole writer of site.json; this
//   script preserves that invariant.
//
// Behavior:
//   - Strict on `phase` + `status` fields. Anything else missing or wrong
//     fails the script for that pack and forces exit 2.
//   - Permissive on `seeded` keys: known keys from seed-recipes.md's
//     "Returns" column pass through verbatim; unknown keys are funneled
//     into `seeded[<pack>].notes` so Phase 4 can still surface them.
//   - Exit 0 if every pack reports ok or skipped. Exit 2 if any pack
//     reports error.
//
// Usage:
//   node merge-seed-results.mjs <project-dir>

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [, , projectDir] = process.argv;

if (!projectDir) {
  console.error("usage: merge-seed-results.mjs <project-dir>");
  process.exit(2);
}

const sitePath = join(projectDir, ".wix", "site.json");
const returnsDir = join(projectDir, ".wix", "seed-returns");

if (!existsSync(sitePath)) {
  console.error(`merge-seed-results: ${sitePath} does not exist — run init-site-json.mjs first`);
  process.exit(2);
}

if (!existsSync(returnsDir)) {
  console.error(`merge-seed-results: ${returnsDir} does not exist — no subagent returns to merge`);
  process.exit(2);
}

const VALID_STATUS = new Set(["ok", "skipped", "error"]);

const KNOWN_SEEDED_KEYS = {
  stores: new Set(["productIds", "categoryIds"]),
  cms: new Set(["collectionIds", "itemIds"]),
  blog: new Set(["postIds", "categoryIds"]),
  forms: new Set(["formIds"]),
  bookings: new Set(["services", "staff"]),
  "gift-cards": new Set([]),
  ecom: new Set([]),
  // Image phases — bolted into seed-returns/ for uniform run-record handling.
  // Phase identifiers come from references/images/INSTRUCTIONS.md + RETURN_CONTRACT.md.
  "image-phase-1": new Set(["decorativeCount", "purposes", "model", "totalCredits"]),
  "image-phase-2": new Set(["entityCount", "model", "totalCredits"]),
};

const returnFiles = readdirSync(returnsDir).filter((f) => f.endsWith(".json"));

if (returnFiles.length === 0) {
  console.error(`merge-seed-results: no *.json files in ${returnsDir}`);
  process.exit(2);
}

const site = JSON.parse(readFileSync(sitePath, "utf8"));
if (!site.seeded || typeof site.seeded !== "object") {
  site.seeded = {};
}

const errors = [];
const summary = [];

for (const file of returnFiles) {
  const pack = file.replace(/\.json$/, "");
  const path = join(returnsDir, file);

  let payload;
  try {
    payload = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    errors.push(`${pack}: invalid JSON — ${err.message}`);
    continue;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push(`${pack}: return payload must be a JSON object`);
    continue;
  }

  // Image phases use their own identifier shape (image-phase-N-decorative /
  // image-phase-N-entity) per references/images/INSTRUCTIONS.md. Seed packs use
  // the seed-<pack> shape. Accept both based on the filename prefix.
  const isImagePhase = /^image-phase-\d+$/.test(pack);
  const expectedPhases = isImagePhase
    ? [`${pack}-decorative`, `${pack}-entity`, pack]
    : [`seed-${pack}`];

  if (!expectedPhases.includes(payload.phase)) {
    const label = expectedPhases.length === 1
      ? `"${expectedPhases[0]}"`
      : `one of ${JSON.stringify(expectedPhases)}`;
    errors.push(`${pack}: expected phase ${label}, got ${JSON.stringify(payload.phase)}`);
    continue;
  }

  if (!VALID_STATUS.has(payload.status)) {
    errors.push(`${pack}: status must be one of ${[...VALID_STATUS].join(", ")}; got ${JSON.stringify(payload.status)}`);
    continue;
  }

  const entry = { status: payload.status };

  if (Array.isArray(payload.recipeCalls)) {
    entry.recipeCalls = payload.recipeCalls;
  }

  if (payload.status === "error") {
    if (payload.error !== undefined) entry.error = payload.error;
    errors.push(`${pack}: subagent returned status=error`);
  }

  if (payload.seeded && typeof payload.seeded === "object" && !Array.isArray(payload.seeded)) {
    const known = KNOWN_SEEDED_KEYS[pack] ?? new Set();
    const notes = {};
    for (const [key, value] of Object.entries(payload.seeded)) {
      if (known.has(key)) {
        entry[key] = value;
      } else {
        notes[key] = value;
      }
    }
    if (Object.keys(notes).length > 0) {
      entry.notes = notes;
    }
  }

  site.seeded[pack] = entry;
  summary.push({ pack, status: payload.status });
}

writeFileSync(sitePath, JSON.stringify(site, null, 2) + "\n");

console.log(JSON.stringify({ status: errors.length === 0 ? "ok" : "error", merged: summary, errors }, null, 2));

if (errors.length > 0) {
  process.exit(2);
}
