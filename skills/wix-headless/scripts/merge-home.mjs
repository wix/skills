#!/usr/bin/env node
// Merge per-pack home-page (`src/pages/index.astro`) contributions into the
// designer-emitted shell.
//
// Today two Phase 4 page agents patch the home page at distinct `home:*`
// markers (the markers don't conflict like nav:links does), but the broader
// pattern is the same as scripts/merge-navigation.mjs:
//
//   - stores-pages-home-and-nav  → <!-- home:stores -->        (featured products grid)
//   - gift-cards-pages           → <!-- home:gift-cards -->    (probe-gated teaser)
//
// Even without a same-marker race, agents writing the same file concurrently
// is brittle: missing markers are masked (the gift-cards agent silently
// no-ops if the designer forgot to emit `home:gift-cards`, observed on a
// 2026-05 run), and ordering is undefined. Pulling the splicing into a
// deterministic post-Phase-4 step makes both problems observable.
//
// Usage:
//   echo "$CONTRIBUTIONS" | node merge-home.mjs <project-dir>
//
// stdin shape (mirrors merge-navigation.mjs):
//   {
//     "contributions": [
//       {
//         "source": "stores",                  // pack name; used in error reports
//         "imports": [                          // raw TS import lines
//           "import ProductCard from '../components/ProductCard.astro';",
//           "import { productsV3 } from '@wix/stores';"
//         ],
//         "frontmatter": [                      // raw TS lines (after imports)
//           "const { items: featured } = await productsV3.queryProducts(...);"
//         ],
//         "byMarker": {                         // raw HTML/Astro to splice
//           "home:stores": "<section class=\"featured-section\">...</section>"
//         }
//       },
//       ...
//     ]
//   }
//
// Behavior matches merge-navigation.mjs exactly:
//   - Imports + frontmatter additions are deduped against existing content.
//   - Multiple contributions at the same marker are joined in input order.
//   - Unknown markers are reported in `skipped[]` with `MARKER_NOT_FOUND`;
//     output status becomes "partial" but exit is 0. This makes the
//     designer-forgot-to-emit-a-marker case observable and recoverable —
//     e.g. an `<!-- home:gift-cards -->` omission for a disabled pack is
//     a known non-fatal outcome.
//   - Atomic write (write-then-rename).
//   - NOT idempotent: orchestrator must invoke once per build.
//
// Exit codes:
//   0 — merged (any `skipped` markers are non-fatal and reported in JSON)
//   2 — argument validation, malformed input, or missing index.astro

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("usage: cat contributions.json | merge-home.mjs <project-dir>");
  process.exit(2);
}

const homePath = join(projectDir, "src/pages/index.astro");
if (!existsSync(homePath)) {
  console.error(`merge-home: ${homePath} does not exist — designer (Phase 2) must run first.`);
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch (e) {
  console.error(`merge-home: stdin is not valid JSON (${e.message})`);
  process.exit(2);
}

const contributions = Array.isArray(payload.contributions) ? payload.contributions : null;
if (!contributions) {
  console.error("merge-home: stdin must contain `contributions: [...]`");
  process.exit(2);
}

const source = readFileSync(homePath, "utf8");

const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const m = source.match(frontmatterRegex);
if (!m) {
  console.error("merge-home: index.astro has no --- frontmatter block; cannot merge imports/frontmatter contributions.");
  process.exit(2);
}

let frontmatter = m[1];
let body = m[2];

// --- Imports + frontmatter additions -----------------------------------
const existingLines = new Set(frontmatter.split("\n").map((l) => l.trim()));

const addedImports = [];
const addedFrontmatter = [];

for (const contrib of contributions) {
  const imports = Array.isArray(contrib.imports) ? contrib.imports : [];
  const fm = Array.isArray(contrib.frontmatter) ? contrib.frontmatter : [];

  for (const line of imports) {
    if (typeof line !== "string") continue;
    const trimmed = line.trim();
    if (trimmed === "" || existingLines.has(trimmed)) continue;
    addedImports.push({ source: contrib.source, line: line });
    existingLines.add(trimmed);
  }

  for (const line of fm) {
    if (typeof line !== "string") continue;
    const trimmed = line.trim();
    if (trimmed === "" || existingLines.has(trimmed)) continue;
    addedFrontmatter.push({ source: contrib.source, line: line });
    existingLines.add(trimmed);
  }
}

const fmLines = frontmatter.split("\n");
let lastImportIdx = -1;
for (let i = 0; i < fmLines.length; i++) {
  if (/^\s*import\b/.test(fmLines[i])) lastImportIdx = i;
}

if (addedImports.length > 0) {
  const importLines = addedImports.map((c) => c.line);
  if (lastImportIdx >= 0) {
    fmLines.splice(lastImportIdx + 1, 0, ...importLines);
    lastImportIdx += importLines.length;
  } else {
    fmLines.unshift(...importLines);
    lastImportIdx = importLines.length - 1;
  }
}

if (addedFrontmatter.length > 0) {
  const fmAdditions = addedFrontmatter.map((c) => c.line);
  const insertIdx = lastImportIdx + 1;
  const needsSeparator = lastImportIdx >= 0 && fmLines[insertIdx]?.trim() !== "";
  if (needsSeparator) fmAdditions.unshift("");
  fmLines.splice(insertIdx, 0, ...fmAdditions);
}

frontmatter = fmLines.join("\n");

// --- byMarker splicing -------------------------------------------------
// Group contributions per marker so we splice once per marker with all
// snippets joined in input order. See merge-navigation.mjs for why this is
// done in two passes.

const patched = [];
const skipped = [];

/** @type {Map<string, Array<{source: string, snippet: string}>>} */
const groupedByMarker = new Map();

for (const contrib of contributions) {
  const byMarker = contrib.byMarker && typeof contrib.byMarker === "object" ? contrib.byMarker : {};
  for (const [markerName, snippet] of Object.entries(byMarker)) {
    if (typeof snippet !== "string" || snippet.trim() === "") continue;
    if (!groupedByMarker.has(markerName)) groupedByMarker.set(markerName, []);
    groupedByMarker.get(markerName).push({ source: contrib.source, snippet });
  }
}

for (const [markerName, entries] of groupedByMarker) {
  const markerComment = `<!-- ${markerName} -->`;
  if (!body.includes(markerComment)) {
    for (const { source } of entries) {
      skipped.push({ source, marker: markerName, reason: "MARKER_NOT_FOUND" });
    }
    continue;
  }

  const markerLineRegex = new RegExp(`(^|\\n)([ \\t]*)${markerComment.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(\\r?\\n)`);
  const lineMatch = body.match(markerLineRegex);
  const indent = lineMatch ? (lineMatch[2] ?? "") : "";

  const indentedSnippets = entries.map(({ snippet }) =>
    snippet
      .split("\n")
      .map((line, i) => (i === 0 || line === "" ? line : `${indent}${line}`))
      .join("\n")
  );
  const combined = indentedSnippets.join("\n" + indent);

  if (lineMatch) {
    body = body.replace(markerLineRegex, `$1$2${markerComment}$3${indent}${combined}\n`);
  } else {
    body = body.replace(markerComment, `${markerComment}\n${combined}`);
  }

  for (const { source } of entries) {
    patched.push({ source, marker: markerName });
  }
}

// --- Write atomically --------------------------------------------------
const out = `---\n${frontmatter}\n---\n${body}`;
const tmpPath = homePath + ".tmp";
writeFileSync(tmpPath, out);
renameSync(tmpPath, homePath);

console.log(JSON.stringify({
  status: skipped.length > 0 ? "partial" : "ok",
  path: homePath,
  patched,
  skipped,
  addedImports: addedImports.map((c) => ({ source: c.source, line: c.line.trim() })),
  addedFrontmatter: addedFrontmatter.map((c) => ({ source: c.source, line: c.line.trim() })),
}, null, 2));
