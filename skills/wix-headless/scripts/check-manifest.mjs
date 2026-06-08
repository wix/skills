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
//   <phase> ∈ { "components", "pages", "integration" }  (astro scaffold mode; integration = custom frontend)
//   <packs-csv> = comma-separated pack names (loaded verticals), e.g. "stores,ecom,cms"
//
// Integration mode (frontend = "custom") — verify the CONNECTION, not pack files:
//   node <SKILL_ROOT>/scripts/check-manifest.mjs <project-dir> integration <connection-plan.json> \
//        [--build-output <dir>]
//   where <connection-plan.json> is the connection-plan subagent's returned JSON
//   ({ data: { bindingMap, augmentation, persistenceSwap } } or that object directly).
//   Verifies the connection per the three connection kinds:
//     - bindingMap     (none/static)  → each region's `file` now carries a Wix SDK script
//                                        (createClient / @wix/sdk / OAuthStrategy)
//     - augmentation   (none/static)  → each inject `file` has its component + SDK call
//                                        (+ a <form> + createSubmission for form capabilities)
//     - persistenceSwap (own/SPA)     → each `sourceFile` carries a bundled @wix/sdk import
//                                        AND a @wix/data CRUD call (items.query/insert/update/remove)
//   …and the always-connect invariant: at least one connection of ANY kind exists.
//   --build-output <dir>: for own-build SPAs, assert the build output dir exists and is
//     non-empty. Run this form POST-BUILD (the dir doesn't exist until `npm run build`);
//     run the plain form post-wiring/pre-build to verify the source connection. Catches the
//     "published the un-built dev entry → 404" failure (SPA plan Break 4).
//   Exit 1 if any claimed connection is missing, zero connections were made, or
//   --build-output was given and the dir is missing/empty.
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

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
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
async function checkIntegration(projectDir, planPath, buildOutputDir) {
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
  const persistenceSwap = Array.isArray(data.persistenceSwap) ? data.persistenceSwap : [];

  // A Wix SDK reference is present if the file imports @wix/sdk / calls createClient / OAuthStrategy.
  // Matches BOTH the CDN form (`from "https://esm.sh/@wix/sdk"`) and the bundled form (`from "@wix/sdk"`).
  const SDK_MARKER = /@wix\/sdk|createClient\s*\(|OAuthStrategy\s*\(/;
  // A @wix/data CRUD call is present (persistence swap wired the data layer to the collection).
  const DATA_MARKER = /@wix\/data|items\s*\.\s*(query|insert|update|remove)\s*\(|\.items\s*\.\s*(query|insert|update|remove)\s*\(/;
  const fileHasSdk = (file) => {
    const p = join(projectDir, file);
    if (!existsSync(p)) return { exists: false, sdk: false, data: false, text: "" };
    const text = readFileSync(p, "utf8");
    return { exists: true, sdk: SDK_MARKER.test(text), data: DATA_MARKER.test(text), text };
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

  // (c) Each persistence swap's source file must carry the bundled SDK import AND a @wix/data CRUD call.
  // (own-build SPAs: the data layer was rewritten in source — not a <script> injection.)
  for (const s of persistenceSwap) {
    const file = s.sourceFile;
    if (!file) { missing.push({ kind: "persistenceSwap", file: null, code: "NO_SOURCE_FILE", remediation: `persistenceSwap entry has no sourceFile (the data-layer file to rewrite / fresh data module to write).` }); continue; }
    const { exists, sdk, data: hasData } = fileHasSdk(file);
    if (exists && sdk && hasData) { anySdk = true; wired.push({ kind: "persistenceSwap", file, collection: s.inferredShape?.collection ?? null }); }
    else missing.push({ kind: "persistenceSwap", file,
      code: !exists ? "FILE_MISSING" : !sdk ? "SDK_NOT_IMPORTED" : "DATA_NOT_WIRED",
      remediation: !exists ? `${file} not found — the data layer was not rewritten / the fresh data module was not written.`
        : !sdk ? `no @wix/sdk import in ${file} — the persistence swap must import createClient/OAuthStrategy (bundled, not CDN).`
        : `no @wix/data CRUD call (items.query/insert/update/remove) in ${file} — the data layer still uses its old storage, not the Wix collection.` });
  }

  // (d) Always-connect invariant: at least one connection of ANY kind must exist.
  const alwaysConnect = anySdk;
  if (!alwaysConnect) {
    missing.push({ kind: "invariant", code: "NO_CONNECTION", remediation: "ALWAYS-CONNECT VIOLATION: no Wix SDK connection found anywhere in the site. Integration mode must wire, augment, or persistence-swap at least one capability — a hosting-only release is not acceptable." });
  }

  // (e) Build-output assertion (own-build SPAs, post-build): the deployable dir must exist + be non-empty,
  // so release publishes the built app — not the un-built dev entry that 404s in production.
  let buildOutput = null;
  if (buildOutputDir) {
    const outPath = join(projectDir, buildOutputDir);
    const ok = existsSync(outPath) && readdirSync(outPath).length > 0;
    buildOutput = { dir: buildOutputDir, exists: ok };
    if (!ok) missing.push({ kind: "buildOutput", file: buildOutputDir, code: "BUILD_OUTPUT_MISSING",
      remediation: `build output dir "${buildOutputDir}" is missing or empty — run the project's own build (npm run build) before release and point wix.config.json.site.outputDirectory at it. Never publish the un-built source entry.` });
  }

  const summary = {
    phase: "integration",
    counts: { wired: wired.length, missing: missing.length, bindingRegions: bindingMap.length, augmentations: augmentation.length, persistenceSwaps: persistenceSwap.length },
    alwaysConnect,
    ...(buildOutput ? { buildOutput } : {}),
    wired,
    missing,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(missing.length > 0 ? 1 : 0);
}

// Parse args: positionals + optional --build-output <dir> (integration only).
const argv = process.argv.slice(2);
const positionals = [];
let buildOutputDir = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--build-output") buildOutputDir = argv[++i];
  else if (a.startsWith("--build-output=")) buildOutputDir = a.slice("--build-output=".length);
  else positionals.push(a);
}
const [projectDir, phase, thirdArg] = positionals;

if (!projectDir || !phase || !thirdArg) {
  console.error("usage: check-manifest.mjs <project-dir> <phase> <packs-csv | connection-plan.json> [--build-output <dir>]");
  process.exit(2);
}

// --- Integration mode: verify the connection was actually wired into the site ---
if (phase === "integration") {
  await checkIntegration(projectDir, thirdArg, buildOutputDir);
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
