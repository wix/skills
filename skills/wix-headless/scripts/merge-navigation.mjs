#!/usr/bin/env node
// Merge per-pack Navigation.astro contributions into the designer-emitted shell.
//
// Today three Phase 4 page agents patch `src/components/Navigation.astro`
// concurrently, two of them at the *same* marker:
//   - stores-pages-home-and-nav  → <!-- nav:links -->   (Shop submenu)
//   - ecom-pages                 → <!-- nav:actions --> (CartBadge mount)
//   - gift-cards-pages           → <!-- nav:links -->   (probe-gated link)
//
// Three background subagents reading-then-writing the same file with two of
// them targeting the same marker is a real race. In the run that motivated
// this script (Moran's Bakery, 2026-05) it happened to work because each
// agent's regex-based marker insert was idempotent, but the contract is
// brittle.
//
// New contract: each agent returns its contribution as `data.navContributions`
// (per RETURN_CONTRACT.md). The orchestrator collects all returns, packages
// them, and invokes this script ONCE to splice them into Navigation.astro
// deterministically.
//
// Usage:
//   echo "$CONTRIBUTIONS" | node merge-navigation.mjs <project-dir>
//
// stdin shape:
//   {
//     "contributions": [
//       {
//         "source": "stores",                       // pack name; used in error reports
//         "imports": [                              // raw TS import lines
//           "import { listStoreCategories } from '../utils/categories';"
//         ],
//         "frontmatter": [                          // raw TS lines (after imports)
//           "const navCategories = (await listStoreCategories().catch(() => []));"
//         ],
//         "byMarker": {                             // raw HTML/Astro to splice
//           "nav:links": "<li class=\"site-nav-item has-submenu\">...</li>"
//         }
//       },
//       ...
//     ]
//   }
//
// Behavior:
//   - Contributions are processed in stdin order. Splicer inserts each
//     contribution's `byMarker[marker]` snippet immediately AFTER the marker
//     comment line, preserving the marker for any later runs.
//   - Imports and frontmatter lines are appended to the frontmatter (between
//     the `---` boundaries), de-duplicated against existing content by exact
//     line match. New imports go after the last `import …` line found;
//     frontmatter lines go after imports.
//   - Skips an unknown marker silently — the script records it in `skipped`
//     so the orchestrator can choose whether to fail. Reasoning: a pack may
//     emit a marker the designer didn't scaffold (e.g. when a pack is
//     disabled and the designer was told to skip it). Surfacing it for
//     observability beats hard-failing.
//   - Idempotency: this script is NOT idempotent by design. The orchestrator
//     must collect all contributions before invoking it, then invoke it
//     exactly once per build. Running twice re-inserts.
//   - Writes atomically (write-then-rename).
//   - Outputs a JSON summary on stdout: { status, patched, skipped, addedImports, addedFrontmatter }.
//
// Exit codes:
//   0 — merged (with any non-fatal `skipped` markers reported in output)
//   2 — argument validation, malformed input, or missing Navigation.astro

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("usage: cat contributions.json | merge-navigation.mjs <project-dir>");
  process.exit(2);
}

const navPath = join(projectDir, "src/components/Navigation.astro");
if (!existsSync(navPath)) {
  console.error(`merge-navigation: ${navPath} does not exist — designer (Phase 2) must run first.`);
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch (e) {
  console.error(`merge-navigation: stdin is not valid JSON (${e.message})`);
  process.exit(2);
}

const contributions = Array.isArray(payload.contributions) ? payload.contributions : null;
if (!contributions) {
  console.error("merge-navigation: stdin must contain `contributions: [...]`");
  process.exit(2);
}

const source = readFileSync(navPath, "utf8");

// Split frontmatter / body. Astro frontmatter is the first `---`-delimited
// block at the top of the file (TypeScript). Files without frontmatter are
// not valid Astro pages, but we handle the case gracefully.
const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const m = source.match(frontmatterRegex);
if (!m) {
  console.error("merge-navigation: Navigation.astro has no --- frontmatter block; cannot merge imports/frontmatter contributions.");
  process.exit(2);
}

let frontmatter = m[1];
let body = m[2];

// --- Imports + frontmatter additions -----------------------------------
// Build a Set of existing lines for dedupe.
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

// Append imports after the last `import …` line; append frontmatter lines
// after imports. If no `import` lines exist, prepend everything.
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
  // Insert after imports (or after any added imports). Use a blank line as a
  // visual separator if not already present.
  const insertIdx = lastImportIdx + 1;
  const needsSeparator = lastImportIdx >= 0 && fmLines[insertIdx]?.trim() !== "";
  if (needsSeparator) fmAdditions.unshift("");
  fmLines.splice(insertIdx, 0, ...fmAdditions);
}

frontmatter = fmLines.join("\n");

// --- byMarker splicing -------------------------------------------------
// Group contributions per marker so we splice each marker ONCE with all
// snippets joined in input order. This preserves the natural "first
// contribution renders first" mental model — the alternative (splice each
// contribution separately after the marker line) reverses the order because
// each new insert pushes the previous one further down.

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

  // Use the marker's own line indentation to indent every line of every
  // snippet — keeps the output legible inside indented `<ul>` blocks.
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
    // Marker exists in body but not on its own line — fall back to a simple
    // replace at the first occurrence (no indent inference possible).
    body = body.replace(markerComment, `${markerComment}\n${combined}`);
  }

  for (const { source } of entries) {
    patched.push({ source, marker: markerName });
  }
}

// --- Write atomically --------------------------------------------------
const out = `---\n${frontmatter}\n---\n${body}`;
const tmpPath = navPath + ".tmp";
writeFileSync(tmpPath, out);
renameSync(tmpPath, navPath);

console.log(JSON.stringify({
  status: skipped.length > 0 ? "partial" : "ok",
  path: navPath,
  patched,
  skipped,
  addedImports: addedImports.map((c) => ({ source: c.source, line: c.line.trim() })),
  addedFrontmatter: addedFrontmatter.map((c) => ({ source: c.source, line: c.line.trim() })),
}, null, 2));
