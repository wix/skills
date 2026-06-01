#!/usr/bin/env node
// Post-phase manifest check + template-copy recovery.
//
// Verifies that every file declared in each loaded pack's `creates:` array
// for the named phase exists on disk. If a file is missing, attempts to
// recover by copying the canonical template from <SKILL_ROOT>/references/astro/templates/<pack>/.
// Outputs a JSON summary of present / recovered / errored files.
//
// Usage (both modes work):
//   node <SKILL_ROOT>/scripts/check-manifest.mjs <project-dir> <phase> <packs-csv>
//   curl -s https://dev.wix.com/skills/wix-headless/scripts/check-manifest.mjs \
//     | node --input-type=module - <project-dir> <phase> <packs-csv>
//
//   <phase> ∈ { "components", "pages" }  (astro scaffold mode)
//   <packs-csv> = comma-separated pack names (loaded verticals), e.g. "stores,ecom,cms"
//
// Integration mode (frontend = "custom") — verify the CONNECTION, not pack files:
//   node <SKILL_ROOT>/scripts/check-manifest.mjs <project-dir> integration <connection-plan.json>
//   where <connection-plan.json> is the connection-plan subagent's returned JSON
//   ({ data: { bindingMap, augmentation } } or that object directly). Checks that
//   each claimed region's file now contains a Wix SDK `<script>` (createClient /
//   @wix/sdk / OAuthStrategy), that each augmentation's inject file has its
//   component + SDK call, and — the always-connect invariant — that at least one
//   Wix SDK script exists somewhere. Exit 1 if any claimed connection is missing
//   or zero connections were made.
//
// Note: `node <(curl ...)` does NOT work for .mjs files — Node sees /dev/fd/N
// with no extension and rejects ESM syntax. Use the stdin form above.
//
// Skill-local file reads (vertical pack markdowns, template files) auto-detect
// whether they can resolve on disk (tgz install) and fall back to HTTP fetch
// otherwise (stream via stdin).
//
// Behavior:
//   - For each pack, parses `references/verticals/<pack>.md` to extract the
//     `creates:` array.
//   - For each `creates:` entry where phase matches:
//       * If file exists in the project → "present"
//       * If missing AND a template exists at `references/astro/templates/<pack>/<tail>`
//         (where <tail> is the path under src/pages/ for page files, or the
//         basename for everything else) → copy/fetch it; record as "recovered".
//       * Otherwise → record as "missing" with a remediation hint.
//   - Exit 0 on happy path or recoverable misses.
//   - Exit 1 if any file is unrecoverably missing.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_URL = "https://dev.wix.com/skills/wix-headless";

// Mode detection: prefer on-disk skill root if reachable, else use HTTP.
// When invoked as `node <(curl ...)`, import.meta.url is `file:///dev/fd/N`
// and the candidate root won't contain `references/verticals` — so we fall
// through to URL mode automatically.
let SKILL_ROOT_DISK = null;
try {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(scriptDir, "..");
  if (existsSync(join(candidate, "references/verticals"))) {
    SKILL_ROOT_DISK = candidate;
  }
} catch {
  // fileURLToPath may fail on non-file URLs; fall through to URL mode.
}

// Read a skill-local file (relative path like "references/verticals/stores.md").
// Returns null when the file doesn't exist.
async function readSkillText(relPath) {
  if (SKILL_ROOT_DISK) {
    const p = join(SKILL_ROOT_DISK, relPath);
    if (!existsSync(p)) return null;
    return readFileSync(p, "utf8");
  }
  const url = `${SKILL_URL}/${relPath}`;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
  return await r.text();
}

// Copy a skill-local file at relPath into destPath (in the user's project).
// Returns true on success, false if the source doesn't exist.
async function copySkillFile(relPath, destPath) {
  if (SKILL_ROOT_DISK) {
    const src = join(SKILL_ROOT_DISK, relPath);
    if (!existsSync(src)) return false;
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(src, destPath);
    return true;
  }
  const text = await readSkillText(relPath);
  if (text === null) return false;
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, text);
  return true;
}

// Integration-mode check: verify the connection plan was wired into the site.
async function checkIntegration(projectDir, planPath) {
  if (!existsSync(planPath)) {
    console.error(`check-manifest: connection plan not found at ${planPath}`);
    process.exit(2);
  }
  let plan;
  try {
    plan = JSON.parse(readFileSync(planPath, "utf8"));
  } catch (e) {
    console.error(`check-manifest: could not parse connection plan JSON: ${e.message}`);
    process.exit(2);
  }
  const data = plan.data ?? plan;
  const bindingMap = Array.isArray(data.bindingMap) ? data.bindingMap : [];
  const augmentation = Array.isArray(data.augmentation) ? data.augmentation : [];

  // A Wix SDK script is present if the file imports @wix/sdk / calls createClient / OAuthStrategy.
  const SDK_MARKER = /@wix\/sdk|createClient\s*\(|OAuthStrategy\s*\(/;
  const fileHasSdk = (file) => {
    const p = join(projectDir, file);
    if (!existsSync(p)) return { exists: false, sdk: false, text: "" };
    const text = readFileSync(p, "utf8");
    return { exists: true, sdk: SDK_MARKER.test(text), text };
  };

  const wired = [];
  const missing = [];
  let anySdk = false;

  // (a) Each claimed binding-map region's file must now carry a Wix SDK script.
  for (const r of bindingMap) {
    if (!r.file) continue;
    const { exists, sdk } = fileHasSdk(r.file);
    if (exists && sdk) { anySdk = true; wired.push({ kind: "binding", file: r.file, anchor: r.anchor ?? null, entity: r.entity ?? null }); }
    else missing.push({ kind: "binding", file: r.file, anchor: r.anchor ?? null, code: exists ? "REGION_NOT_WIRED" : "FILE_MISSING",
      remediation: exists ? `no Wix SDK <script> found in ${r.file} for region ${r.anchor} — the wiring subagent did not connect it.` : `${r.file} not found in project.` });
  }

  // (b) Each augmentation's inject file must carry the SDK call (and a <form> for form capabilities).
  for (const a of augmentation) {
    const file = a.injectAt?.file;
    if (!file) { missing.push({ kind: "augmentation", file: null, code: "NO_INJECT_FILE", remediation: `augmentation "${a.capability}" has no injectAt.file.` }); continue; }
    const { exists, sdk, text } = fileHasSdk(file);
    const isForm = /form/i.test(a.app ?? "") || /rsvp|lead|contact|form/i.test(a.capability ?? "") || (a.component ?? "").includes("form");
    const formOk = !isForm || (/<form/i.test(text) && /createSubmission\s*\(/.test(text));
    if (exists && sdk && formOk) { anySdk = true; wired.push({ kind: "augmentation", file, capability: a.capability ?? null, component: a.component ?? null }); }
    else missing.push({ kind: "augmentation", file, capability: a.capability ?? null,
      code: !exists ? "FILE_MISSING" : !sdk ? "AUGMENT_NOT_WIRED" : "FORM_NOT_INJECTED",
      remediation: !exists ? `${file} not found.` : !sdk ? `no Wix SDK <script> in ${file} for the "${a.capability}" augmentation.` : `expected an injected <form> + createSubmission() in ${file} for "${a.capability}".` });
  }

  // (c) Always-connect invariant: at least one connection must exist.
  const alwaysConnect = anySdk;
  if (!alwaysConnect) {
    missing.push({ kind: "invariant", code: "NO_CONNECTION", remediation: "ALWAYS-CONNECT VIOLATION: no Wix SDK connection found anywhere in the site. Integration mode must wire or augment at least one capability — a hosting-only release is not acceptable." });
  }

  const summary = {
    phase: "integration",
    counts: { wired: wired.length, missing: missing.length, bindingRegions: bindingMap.length, augmentations: augmentation.length },
    alwaysConnect,
    wired,
    missing,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(missing.length > 0 ? 1 : 0);
}

const [, , projectDir, phase, thirdArg] = process.argv;

if (!projectDir || !phase || !thirdArg) {
  console.error("usage: check-manifest.mjs <project-dir> <phase> <packs-csv | connection-plan.json>");
  process.exit(2);
}

// --- Integration mode: verify the connection was actually wired into the HTML ---
if (phase === "integration") {
  await checkIntegration(projectDir, thirdArg);
  // checkIntegration exits the process.
}

if (phase !== "components" && phase !== "pages") {
  console.error(`check-manifest: invalid phase "${phase}" — must be "components", "pages", or "integration"`);
  process.exit(2);
}

const packsCsv = thirdArg;

const packs = packsCsv.split(",").map((p) => p.trim()).filter(Boolean);

// Map a `creates:` file path to its template path (relative to skill root).
// Heuristic: `src/pages/<X>` preserves <X> under references/astro/templates/<pack>/;
// everything else uses basename only.
function templateRelPath(packName, srcPath) {
  const pagesMatch = srcPath.match(/^src\/pages\/(.+)$/);
  const tail = pagesMatch ? pagesMatch[1] : basename(srcPath);
  return `references/astro/templates/${packName}/${tail}`;
}

// Parse `creates:` block from a vertical pack's markdown frontmatter.
// Format (one per line):
//   - { file: src/utils/back-in-stock.ts,          phase: components }
function parseCreates(text) {
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
  const verticalRel = `references/verticals/${pack}.md`;
  const text = await readSkillText(verticalRel);
  if (text === null) {
    missing.push({
      pack,
      path: null,
      code: "PACK_NOT_FOUND",
      remediation: `vertical pack file not found at ${verticalRel} — pack "${pack}" may not be a valid loaded vertical`,
    });
    continue;
  }

  const entries = parseCreates(text).filter((e) => e.phase === phase);

  for (const { file } of entries) {
    const destPath = join(projectDir, file);
    if (existsSync(destPath)) {
      present.push({ pack, path: file });
      continue;
    }

    const templateRel = templateRelPath(pack, file);
    const ok = await copySkillFile(templateRel, destPath);
    if (ok) {
      recovered.push({
        pack,
        path: file,
        source: "template-copy",
        template: templateRel,
      });
      continue;
    }

    missing.push({
      pack,
      path: file,
      code: "PHASE_FILE_MISSING",
      remediation: `the ${pack} agent did not write this file and the pack ships no template at ${templateRel}. Re-dispatch the ${phase} scope, or report the gap to the pack maintainer.`,
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
