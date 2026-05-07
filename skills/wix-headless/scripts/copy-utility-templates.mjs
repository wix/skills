#!/usr/bin/env node
// Copy templated utility files into the project for the named phase.
// Invoked by the wix-headless skill orchestrator before Phase 3 Components or
// Phase 4 Pages dispatches, so that mechanical SDK-wrapper utilities
// (back-in-stock.ts, discounts.ts, categories.ts) are on disk by the time
// agents start.
//
// These files are pure templates — same shape regardless of brand. Letting an
// LLM regenerate them costs tokens and risks drift. Pre-copying is structurally better.
//
// Usage:
//   node copy-utility-templates.mjs <project-dir> <phase>
//
//   <phase> ∈ { "components", "pages" }
//
// Reads `.wix/site.json` to discover which packs are loaded, then copies the
// matching templates for the given phase. Uses `cp -n` semantics — never
// overwrites an existing file (so user customisations and earlier orchestrator
// state are preserved).

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Script lives at <SKILL_ROOT>/scripts/copy-utility-templates.mjs.
const SKILL_TEMPLATES_DIR = resolve(__dirname, "../templates");

// Hardcoded mapping: { pack, phase, source (relative to templates dir), dest (relative to project) }.
// To add a new templated utility: ship the file under templates/<pack>/, then add
// an entry here. Keep this list small — only files that are pure SDK wrappers
// with no brand-specific content belong here.
const TEMPLATES = [
  { pack: "stores", phase: "components", source: "stores/back-in-stock.ts", dest: "src/utils/back-in-stock.ts" },
  { pack: "ecom", phase: "components", source: "ecom/discounts.ts", dest: "src/utils/discounts.ts" },
  { pack: "stores", phase: "pages", source: "stores/categories.ts", dest: "src/utils/categories.ts" },
];

const projectDir = process.argv[2];
const phase = process.argv[3];

if (!projectDir || !phase) {
  console.error("usage: copy-utility-templates.mjs <project-dir> <phase>");
  console.error("  <phase> ∈ { components, pages }");
  process.exit(2);
}

if (phase !== "components" && phase !== "pages") {
  console.error(`copy-utility-templates: invalid phase "${phase}" — must be "components" or "pages"`);
  process.exit(2);
}

const sitePath = join(projectDir, ".wix/site.json");
let loadedPacks;
try {
  const site = JSON.parse(readFileSync(sitePath, "utf8"));
  loadedPacks = new Set(site.verticals ?? []);
  if (loadedPacks.size === 0) {
    console.error(`copy-utility-templates: site.json.verticals is empty — has Setup completed?`);
    process.exit(1);
  }
} catch (e) {
  console.error(`copy-utility-templates: cannot read ${sitePath} (${e.message}). Has Setup completed?`);
  process.exit(1);
}

const candidates = TEMPLATES.filter((t) => t.phase === phase && loadedPacks.has(t.pack));

if (candidates.length === 0) {
  console.log(`copy-utility-templates: no templates for phase "${phase}" with loaded packs ${[...loadedPacks].join(", ")} — nothing to do`);
  process.exit(0);
}

const copied = [];
const skipped = [];
const errors = [];

for (const { pack, source, dest } of candidates) {
  const sourcePath = join(SKILL_TEMPLATES_DIR, source);
  const destPath = join(projectDir, dest);

  if (!existsSync(sourcePath)) {
    errors.push(`missing template at ${sourcePath} (declared by pack "${pack}")`);
    continue;
  }

  if (existsSync(destPath)) {
    skipped.push(dest);
    continue;
  }

  try {
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(sourcePath, destPath);
    copied.push(dest);
  } catch (e) {
    errors.push(`failed to copy ${source} → ${dest}: ${e.message}`);
  }
}

const summary = {
  phase,
  packs: [...loadedPacks],
  copied,
  skipped,
  errors,
};

console.log(JSON.stringify(summary, null, 2));

if (errors.length > 0) {
  process.exit(1);
}
