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
// <project-dir> may be either the eval-run dir (where `.wix/image-urls.md`
// typically lives) or the scaffold subdir (where `src/pages/*.astro` lives).
// The two may differ: Image Phase 1 writes to `<eval-dir>/.wix/image-urls.md`
// while `src/pages` is always inside the scaffold subdir. The script resolves
// each piece independently — looking in `<project-dir>` first, then in any
// single scaffold subdir one level down — so either input is accepted.
//
// Behavior:
//   - If .wix/image-urls.md doesn't exist anywhere reachable, exit 0 with
//     status="skipped" (Image Phase 1 timed out / failed; slot placeholders
//     look complete on their own via the designer's aspect-ratio + bg-color).
//   - If src/pages doesn't exist anywhere reachable but image-urls.md does,
//     exit 2 with status="error" — this almost always means the wrong dir
//     was passed (eval-dir vs scaffold-dir). Surface the error verbatim to
//     the orchestrator; don't retry blindly with the same arg.
//   - For each `data-decorative-slot="<key>"` in src/pages/*.astro:
//       * If <key> has no URL in image-urls.md → leave the div alone.
//       * If the div is self-closing or already has a child element other
//         than whitespace/comments → skip with a warning (don't clobber).
//       * Otherwise inject <img …> as the first child.
//   - Output a JSON summary of patches/skips/warnings + the resolution map
//     to stdout. Exit 0 on success even when some slots couldn't be patched.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const projectDir = process.argv[2] ?? process.cwd();

// Resolve where `.wix/image-urls.md` and `src/pages` actually live. These can
// be the same dir (Phase 1 wrote into the scaffold subdir directly) OR
// different — Image Phase 1's INSTRUCTIONS tell it to write `<site-root>/.wix/
// image-urls.md` where site-root is the eval run dir, but `src/pages/*.astro`
// always lives in the scaffold subdir (a child of the eval dir). On the
// previous Brewing Pots run the orchestrator passed the eval dir and the
// script returned `status: "ok", filesScanned: 0` — indistinguishable from
// "nothing to patch" — which caused a 38 s blind retry and a manual `cp`
// recovery cycle. So: look in `<projectDir>` first, then auto-detect a single
// scaffold subdir that contains the missing piece.
function findDir(label, relPath) {
  const direct = join(projectDir, relPath);
  if (existsSync(direct)) return { path: direct, source: "projectDir" };
  // Look one level down — exactly one scaffold subdir is the normal case.
  const hits = [];
  for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const candidate = join(projectDir, entry.name, relPath);
    if (existsSync(candidate)) hits.push(candidate);
  }
  if (hits.length === 1) return { path: hits[0], source: "scaffold-subdir" };
  if (hits.length > 1) return { path: null, source: "ambiguous", hits };
  return { path: null, source: "missing" };
}

const imageUrlsResolved = findDir("image-urls.md", ".wix/image-urls.md");
const pagesResolved = findDir("pages", "src/pages");

if (!imageUrlsResolved.path) {
  console.log(JSON.stringify({
    status: "skipped",
    reason: "no .wix/image-urls.md (Image Phase 1 didn't write — failed or timed out)",
    searchedAt: [join(projectDir, ".wix/image-urls.md")],
  }));
  process.exit(0);
}
if (!pagesResolved.path) {
  console.error(JSON.stringify({
    status: "error",
    reason: `src/pages not found at <projectDir>/src/pages or in any scaffold subdir of <projectDir>. Pass the dir that contains src/pages (typically the scaffold subdir, e.g. <eval-dir>/<brand-slug>/), not the eval root.`,
    projectDir,
    pagesSearchedAt: pagesResolved.source === "ambiguous" ? pagesResolved.hits : [join(projectDir, "src/pages")],
  }, null, 2));
  process.exit(2);
}

const imageUrlsPath = imageUrlsResolved.path;
const pagesDir = pagesResolved.path;
// If the two resolved sources disagree (image-urls.md in eval dir, src/pages
// in scaffold subdir), surface that in the summary so the orchestrator can
// see what happened — but proceed: the patch is still well-defined.
const resolution = {
  imageUrlsFrom: imageUrlsResolved.source,
  pagesFrom: pagesResolved.source,
};

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
  resolution,
};
console.log(JSON.stringify(summary, null, 2));
