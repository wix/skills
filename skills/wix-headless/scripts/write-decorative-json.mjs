#!/usr/bin/env node
// Write the decorative slot→URL map to src/decorative-images.json for a
// framework-SPA (`own`) frontend. This is the `own`-branch analog of
// patch-decorative-slots.mjs (which injects <img> into .astro source) — but
// instead of patching framework source, the generated SPA *imports* this JSON
// and its hero/about components read it, with a themed-block fallback when a
// slot is empty/absent. This avoids fragile JSX/Vue/Svelte string-patching and
// mirrors how the SPA already imports .wix/design-tokens.css.
//
// It is called twice in the `own` flow (BUILD-own-build.md):
//   1. At bootstrap, with EMPTY stdin → writes `{}` (placeholder), so the app
//      builds + renders themed blocks even if Image Phase 1 never runs.
//   2. At the seed gate (ai-generated only), with Image Phase 1's data.slots
//      piped in → OVERWRITES the file with the real URLs. This MUST happen
//      before `npm run build` (Vite resolves the JSON import at build time).
//
// Writes to src/decorative-images.json (inside the Vite root, so it is always
// importable — unlike .wix/, which may sit outside the bundler root).
//
// Usage:
//   echo '{"hero":"https://...","about":"https://..."}' \
//     | node write-decorative-json.mjs <project-dir>
//   : | node write-decorative-json.mjs <project-dir>     # placeholder {}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const projectDir = process.argv[2] ?? process.cwd();

let slots = {};
if (!process.stdin.isTTY) {
  const raw = readFileSync(0, "utf8").trim();
  if (raw) {
    try {
      slots = JSON.parse(raw);
    } catch (e) {
      console.error(JSON.stringify({ status: "error", reason: `stdin is not valid JSON (${e.message})` }));
      process.exit(2);
    }
    if (!slots || typeof slots !== "object" || Array.isArray(slots)) {
      console.error(JSON.stringify({ status: "error", reason: "expected a JSON object mapping slot keys to URLs" }));
      process.exit(2);
    }
  }
}

// Drop empty/falsy URLs so the component's themed-block fallback kicks in.
const clean = {};
for (const [k, v] of Object.entries(slots)) {
  if (typeof v === "string" && v.trim()) clean[k] = v.trim();
}

const srcDir = join(projectDir, "src");
mkdirSync(srcDir, { recursive: true });
const dest = join(srcDir, "decorative-images.json");
writeFileSync(dest, JSON.stringify(clean, null, 2) + "\n");

console.log(JSON.stringify({
  status: Object.keys(clean).length ? "ok" : "placeholder",
  file: dest,
  slots: Object.keys(clean),
}, null, 2));
