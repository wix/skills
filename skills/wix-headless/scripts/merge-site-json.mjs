#!/usr/bin/env node
// Deterministically merge a JSON blob into `.wix/site.json` at a dotted path.
//
// `.wix/site.json` is the single source of truth that every downstream phase
// reads. Today the orchestrator merges into it inline — composing the full
// updated object in scratch and writing the whole file. That's error-prone:
// it requires the orchestrator to hold the full prior state, JSON-encode it
// without drift, and serialize a full re-write per merge. This script lets
// the orchestrator pipe just the new sub-tree and a path target, and the
// merge runs as a small deterministic node program.
//
// Usage:
//   echo '<json>' | node merge-site-json.mjs <project-dir> --path <dotted.path> [--mode replace|merge]
//
// Modes:
//   --mode merge   (default for objects) — deep-merge stdin into the existing
//                  value at <path>. Arrays are REPLACED, not concatenated —
//                  this matches how `seeded.<vertical>.products` should behave
//                  (a re-run replaces the full product list, not appends to it).
//   --mode replace — set the value at <path> to stdin verbatim, discarding
//                  whatever was there before.
//
// Path semantics:
//   - Path is a dot-separated list of object keys: `seeded.stores`,
//     `designTokens`, `brand.description`.
//   - Path must reach an object (for --mode merge) or any JSON value (for
//     --mode replace). Missing intermediate keys are created as empty objects.
//   - Arrays in the path (e.g. `seeded.stores.products.0.name`) are NOT
//     supported by design — every current write site is whole-object-shaped.
//     Numeric path segments are treated as object keys.
//
// Examples (matches today's orchestrator merge points):
//   # After Phase 1 stores seeder returns:
//   echo "$STORES_SEED_DATA" | node merge-site-json.mjs "$(pwd)" --path seeded.stores
//
//   # After Phase 2 designer returns:
//   echo "$DESIGNER_TOKENS" | node merge-site-json.mjs "$(pwd)" --path designTokens
//
// Behavior:
//   - Refuses to run if .wix/site.json doesn't exist (exit 2) — caller must
//     have run init-site-json.mjs first.
//   - Refuses to descend through a non-object intermediate key in --mode merge
//     (exit 2) — protects against accidentally clobbering structured state.
//   - Writes site.json atomically (write-then-rename). Pretty-printed,
//     trailing newline, 2-space indent — matches init-site-json.mjs output.
//   - Outputs a JSON summary to stdout: {status, path, mode, prevType,
//     newKeys?}.
//
// Exit codes:
//   0 — merged successfully
//   2 — argument or input validation failed; site.json untouched

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const projectDir = positional[0];

const pathIdx = args.indexOf("--path");
const dottedPath = pathIdx >= 0 ? args[pathIdx + 1] : undefined;

const modeIdx = args.indexOf("--mode");
const mode = modeIdx >= 0 ? args[modeIdx + 1] : "merge";

if (!projectDir || !dottedPath) {
  console.error("usage: cat data.json | merge-site-json.mjs <project-dir> --path <dotted.path> [--mode merge|replace]");
  process.exit(2);
}

if (mode !== "merge" && mode !== "replace") {
  console.error(`merge-site-json: --mode must be "merge" or "replace" (got ${JSON.stringify(mode)})`);
  process.exit(2);
}

const sitePath = join(projectDir, ".wix", "site.json");
if (!existsSync(sitePath)) {
  console.error(`merge-site-json: ${sitePath} does not exist — run init-site-json.mjs first.`);
  process.exit(2);
}

let stdin;
try {
  stdin = JSON.parse(readFileSync(0, "utf8"));
} catch (e) {
  console.error(`merge-site-json: stdin is not valid JSON (${e.message})`);
  process.exit(2);
}

let site;
try {
  site = JSON.parse(readFileSync(sitePath, "utf8"));
} catch (e) {
  console.error(`merge-site-json: ${sitePath} is not valid JSON (${e.message}). Refusing to overwrite a corrupt file.`);
  process.exit(2);
}

const segments = dottedPath.split(".").filter(Boolean);
if (segments.length === 0) {
  console.error("merge-site-json: --path resolved to no segments");
  process.exit(2);
}

// Walk down to the parent of the final segment, creating empty objects for
// missing intermediates. Refuse to descend through a non-object in --mode
// merge — that would silently clobber state.
let cursor = site;
for (let i = 0; i < segments.length - 1; i++) {
  const seg = segments[i];
  if (cursor[seg] === undefined || cursor[seg] === null) {
    cursor[seg] = {};
  } else if (typeof cursor[seg] !== "object" || Array.isArray(cursor[seg])) {
    console.error(`merge-site-json: cannot descend through non-object at "${segments.slice(0, i + 1).join(".")}" (it is ${Array.isArray(cursor[seg]) ? "an array" : typeof cursor[seg]}). Refusing to overwrite.`);
    process.exit(2);
  }
  cursor = cursor[seg];
}

const finalKey = segments[segments.length - 1];
const prev = cursor[finalKey];
const prevType = prev === undefined ? "undefined" : prev === null ? "null" : Array.isArray(prev) ? "array" : typeof prev;

function deepMerge(target, source) {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    // Non-mergeable on the source side — caller should've used --mode replace.
    throw new Error(`stdin must be a plain object for --mode merge (got ${Array.isArray(source) ? "array" : typeof source})`);
  }
  if (typeof target !== "object" || target === null || Array.isArray(target)) {
    // Existing value isn't a plain object — replace rather than merge.
    return JSON.parse(JSON.stringify(source));
  }
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (
      typeof v === "object" && v !== null && !Array.isArray(v) &&
      typeof out[k] === "object" && out[k] !== null && !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k], v);
    } else {
      // Replace primitives, arrays, and type-mismatches outright.
      out[k] = Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : v;
    }
  }
  return out;
}

let newValue;
let newKeys;
try {
  if (mode === "replace") {
    newValue = stdin;
    newKeys = stdin && typeof stdin === "object" && !Array.isArray(stdin) ? Object.keys(stdin) : undefined;
  } else {
    newValue = deepMerge(prev ?? {}, stdin);
    newKeys = Object.keys(stdin);
  }
} catch (e) {
  console.error(`merge-site-json: ${e.message}`);
  process.exit(2);
}

cursor[finalKey] = newValue;

const tmpPath = sitePath + ".tmp";
writeFileSync(tmpPath, JSON.stringify(site, null, 2) + "\n");
renameSync(tmpPath, sitePath);

console.log(JSON.stringify({
  status: "ok",
  path: sitePath,
  mergedPath: dottedPath,
  mode,
  prevType,
  ...(newKeys ? { newKeys } : {}),
}, null, 2));
