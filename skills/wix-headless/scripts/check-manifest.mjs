#!/usr/bin/env node
// Post-phase manifest check + template-copy recovery.
//
// Verifies that every file declared in each loaded pack's `creates:` array
// for the named phase exists on disk. If a file is missing, attempts to
// recover by copying the canonical template from <SKILL_ROOT>/templates/<pack>/.
// Outputs a JSON summary of present / recovered / errored files.
//
// Usage:
//   node check-manifest.mjs <project-dir> <phase> <packs-csv>
//
//   <phase> ∈ { "components", "pages" }
//   <packs-csv> = comma-separated pack names (loaded verticals), e.g. "stores,ecom,cms"
//
// Behavior:
//   - For each pack, parses .../skills/wix-headless/references/verticals/<pack>.md
//     to extract the `creates:` array.
//   - For each `creates:` entry where phase matches:
//       * If file exists → "present"
//       * If missing AND a template exists at <SKILL_ROOT>/templates/<pack>/<tail>
//         (where <tail> is the path under src/pages/ for page files, or the
//         basename for everything else) → copy it; record as "recovered".
//       * Otherwise → record as "missing" with a remediation hint.
//   - Exit 0 on happy path or recoverable misses.
//   - Exit 1 if any file is unrecoverably missing — orchestrator surfaces to
//     the user before continuing.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Script lives at <SKILL_ROOT>/scripts/check-manifest.mjs.
const SKILL_ROOT = resolve(__dirname, "..");
const TEMPLATES_DIR = join(SKILL_ROOT, "templates");
const VERTICALS_DIR = join(SKILL_ROOT, "references/verticals");

const [, , projectDir, phase, packsCsv] = process.argv;

if (!projectDir || !phase || !packsCsv) {
  console.error("usage: check-manifest.mjs <project-dir> <phase> <packs-csv>");
  process.exit(2);
}

if (phase !== "components" && phase !== "pages") {
  console.error(`check-manifest: invalid phase "${phase}" — must be "components" or "pages"`);
  process.exit(2);
}

const packs = packsCsv.split(",").map((p) => p.trim()).filter(Boolean);

// Map a `creates:` file path to its candidate template path.
// Heuristic: `src/pages/<X>` preserves <X> under templates/<pack>/; everything
// else uses basename only.
function templateCandidate(packName, srcPath) {
  const pagesMatch = srcPath.match(/^src\/pages\/(.+)$/);
  const tail = pagesMatch ? pagesMatch[1] : basename(srcPath);
  return join(TEMPLATES_DIR, packName, tail);
}

// Parse `creates:` block from a vertical pack's markdown frontmatter.
// Format (one per line):
//   - { file: src/utils/back-in-stock.ts,          phase: components }
function parseCreates(filePath) {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const entries = [];
  let inCreates = false;
  for (const line of lines) {
    if (/^creates:\s*$/.test(line)) {
      inCreates = true;
      continue;
    }
    if (inCreates) {
      // Block ends at a non-indented, non-blank line that doesn't start with `-`.
      if (/^[^\s-]/.test(line)) {
        inCreates = false;
        continue;
      }
      const m = line.match(/^\s*-\s*\{\s*file:\s*([^,]+?),\s*phase:\s*([\w-]+)\s*\}/);
      if (m) entries.push({ file: m[1].trim(), phase: m[2].trim() });
    }
  }
  return entries;
}

const present = [];
const recovered = [];
const missing = [];

for (const pack of packs) {
  const verticalPath = join(VERTICALS_DIR, `${pack}.md`);
  if (!existsSync(verticalPath)) {
    missing.push({
      pack,
      path: null,
      code: "PACK_NOT_FOUND",
      remediation: `vertical pack file not found at ${verticalPath} — pack "${pack}" may not be a valid loaded vertical`,
    });
    continue;
  }

  const entries = parseCreates(verticalPath).filter((e) => e.phase === phase);

  for (const { file } of entries) {
    const destPath = join(projectDir, file);
    if (existsSync(destPath)) {
      present.push({ pack, path: file });
      continue;
    }

    // Attempt template-copy recovery.
    const templatePath = templateCandidate(pack, file);
    if (existsSync(templatePath)) {
      try {
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(templatePath, destPath);
        recovered.push({
          pack,
          path: file,
          source: "template-copy",
          template: templatePath.replace(SKILL_ROOT + "/", ""),
        });
      } catch (e) {
        missing.push({
          pack,
          path: file,
          code: "TEMPLATE_COPY_FAILED",
          template: templatePath,
          remediation: `failed to copy ${templatePath} → ${destPath}: ${e.message}`,
        });
      }
      continue;
    }

    missing.push({
      pack,
      path: file,
      code: "PHASE_FILE_MISSING",
      remediation: `the ${pack} agent did not write this file and the pack ships no template at templates/${pack}/. Re-dispatch the ${phase} scope, or report the gap to the pack maintainer.`,
    });
  }
}

const summary = {
  phase,
  packs,
  counts: {
    present: present.length,
    recovered: recovered.length,
    missing: missing.length,
  },
  present,
  recovered,
  missing,
};
console.log(JSON.stringify(summary, null, 2));

process.exit(missing.length > 0 ? 1 : 0);
