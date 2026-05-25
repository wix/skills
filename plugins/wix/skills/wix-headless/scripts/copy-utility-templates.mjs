#!/usr/bin/env node
// Copy templated utility files into the project for the named phase.
// Invoked by the wix-headless skill orchestrator before Phase 3 Components or
// Phase 4 Pages dispatches, so that mechanical SDK-wrapper utilities
// (back-in-stock.ts, discounts.ts, categories.ts) are on disk by the time
// agents start.
//
// These files are pure templates — same shape regardless of brand. Letting an
// LLM regenerate them costs tokens and risks drift. Pre-copying is structurally
// better.
//
// Usage (both modes work):
//   node <SKILL_ROOT>/scripts/copy-utility-templates.mjs <project-dir> <phase>
//   curl -s https://dev.wix.com/skills/wix-headless/scripts/copy-utility-templates.mjs \
//     | node --input-type=module - <project-dir> <phase>
//
//   <phase> ∈ { "components", "pages" }
//
// Note: `node <(curl ...)` does NOT work for .mjs files — Node sees /dev/fd/N
// with no extension and rejects ESM syntax. Use the stdin form above.
//
// Template files auto-detect whether they can be read on disk (tgz install)
// and fall back to HTTP fetch when streamed via stdin.
//
// Reads `.wix/site.json` to discover which packs are loaded, then copies the
// matching templates for the given phase. Never overwrites an existing file
// (so user customisations and earlier orchestrator state are preserved).

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_URL = "https://dev.wix.com/skills/wix-headless";

// Mode detection — see check-manifest.mjs for the same pattern.
let SKILL_ROOT_DISK = null;
try {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(scriptDir, "..");
  if (existsSync(join(candidate, "templates"))) {
    SKILL_ROOT_DISK = candidate;
  }
} catch {
  // fileURLToPath may fail on non-file URLs; fall through to URL mode.
}

// Copy a template file (path relative to <SKILL_ROOT>/templates/) into the
// project at destPath. Returns { ok: true } on success, or { ok: false,
// reason: "..." } on failure (source missing, HTTP error, IO error).
async function copyTemplate(sourceRel, destPath) {
  if (SKILL_ROOT_DISK) {
    const src = join(SKILL_ROOT_DISK, "templates", sourceRel);
    if (!existsSync(src)) return { ok: false, reason: `missing on disk: ${src}` };
    try {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(src, destPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
  const url = `${SKILL_URL}/templates/${sourceRel}`;
  try {
    const r = await fetch(url);
    if (r.status === 404) return { ok: false, reason: `missing at ${url}` };
    if (!r.ok) return { ok: false, reason: `fetch ${url}: HTTP ${r.status}` };
    const text = await r.text();
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, text);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

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
  const destPath = join(projectDir, dest);

  if (existsSync(destPath)) {
    skipped.push(dest);
    continue;
  }

  const result = await copyTemplate(source, destPath);
  if (result.ok) {
    copied.push(dest);
  } else {
    errors.push(`failed to copy ${source} → ${dest} (pack "${pack}"): ${result.reason}`);
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
