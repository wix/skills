#!/usr/bin/env node
// Inject Image-Phase-1 decorative URLs into the designer-emitted page shells.
//
// The Phase 2 designer writes `<div data-decorative-slot="<key>">…</div>`
// placeholders in src/pages/*.astro. Image Phase 1 writes resolved URLs to
// .wix/image-urls.md. This script reads both, then injects an <img> element
// as the first child of each matching slot div — pure string substitution,
// no LLM, no file rewrites.
//
// Usage:
//   node patch-decorative-slots.mjs <project-dir>
//
// Behavior:
//   - If .wix/image-urls.md doesn't exist, exit 0 silently (Image Phase 1
//     timed out / failed; the slot placeholders look complete on their own).
//   - For each `data-decorative-slot="<key>"` in src/pages/*.astro:
//       * If <key> has no URL in image-urls.md → leave the div alone.
//       * If the div is self-closing or already has a child element other
//         than whitespace/comments → skip with a warning (don't clobber).
//       * Otherwise inject <img …> as the first child.
//   - Output a JSON summary of patches/skips/warnings to stdout.
//   - Exit 0 even when some slots couldn't be patched — placeholders fall
//     back to the designer's aspect-ratio + background-color rendering.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const projectDir = process.argv[2] ?? process.cwd();

const imageUrlsPath = join(projectDir, ".wix/image-urls.md");
if (!existsSync(imageUrlsPath)) {
  console.log(JSON.stringify({ status: "skipped", reason: "no .wix/image-urls.md (Image Phase 1 didn't write — failed or timed out)" }));
  process.exit(0);
}

// Parse `## <key>\n- url: <url>` blocks from .wix/image-urls.md.
const imageUrlsRaw = readFileSync(imageUrlsPath, "utf8");
const urlMap = {};
// Match `## key\n…- url: <url>` per section. The inner `(?:(?!^##\s)[\s\S])*?`
// forbids the lazy span from crossing into the next `## ` line — without
// that guard, an empty `- url:` for one slot silently steals the next
// section's URL on partial-failure runs.
const sectionRegex = /^##\s+(\S+)\s*\n(?:(?!^##\s)[\s\S])*?-\s*url:\s*(https?:\/\/\S+)/gm;
let m;
while ((m = sectionRegex.exec(imageUrlsRaw)) !== null) {
  urlMap[m[1]] = m[2];
}

if (Object.keys(urlMap).length === 0) {
  console.log(JSON.stringify({ status: "skipped", reason: ".wix/image-urls.md exists but has no parseable `## key` + `- url:` blocks" }));
  process.exit(0);
}

// Find candidate page files: src/pages/*.astro, recursively (designer may emit
// /about.astro at top level OR /pages/about.astro).
const pagesDir = join(projectDir, "src/pages");
const candidates = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (stat.isFile() && entry.endsWith(".astro")) candidates.push(full);
  }
};
walk(pagesDir);

const patched = [];
const skipped = [];
const warnings = [];

const SLOT_DIV_REGEX = /(<div[^>]*\bdata-decorative-slot="([^"]+)"[^>]*>)([\s\S]*?)(<\/div>)/g;

for (const file of candidates) {
  const original = readFileSync(file, "utf8");
  let modified = original;
  let fileChanged = false;

  modified = modified.replace(SLOT_DIV_REGEX, (match, openTag, slotKey, inner, closeTag) => {
    const url = urlMap[slotKey];
    if (!url) {
      skipped.push({ file, slot: slotKey, reason: "no URL for this slot in image-urls.md" });
      return match;
    }

    // Strip HTML comments before any content checks — the designer's placeholder
    // is a comment like `<!-- orchestrator injects <img> here -->`, which would
    // otherwise false-positive both the idempotency and clobber-guard checks.
    const stripped = inner.replace(/<!--[\s\S]*?-->/g, "").trim();

    // Skip if div already contains an <img> element (idempotency).
    if (/<img\b/i.test(stripped)) {
      skipped.push({ file, slot: slotKey, reason: "div already contains an <img> tag (idempotent skip)" });
      return match;
    }

    // Skip if div has substantive child content beyond whitespace/comments.
    if (stripped.length > 0) {
      warnings.push({ file, slot: slotKey, reason: "div has existing non-image child content; not patching to avoid clobber" });
      return match;
    }

    fileChanged = true;
    const img = `<img src="${url}" alt="" loading="lazy" decoding="async" class="decorative-slot-img" />`;
    patched.push({ file, slot: slotKey });
    // Preserve any whitespace inside the div (e.g., the newline + indent).
    return `${openTag}\n      ${img}${inner}${closeTag}`;
  });

  if (fileChanged) {
    writeFileSync(file, modified);
  }
}

const summary = {
  status: warnings.length > 0 ? "partial" : "ok",
  imageUrls: Object.keys(urlMap),
  filesScanned: candidates.length,
  patched,
  skipped,
  warnings,
};
console.log(JSON.stringify(summary, null, 2));
