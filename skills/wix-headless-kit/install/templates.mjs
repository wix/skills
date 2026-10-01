// Where the shipped code is. The verticals live in the skill's repository under `templates/`
// (each with its code layers, its tools and a composed project with a lockfile), not in the skill
// folder: the skill stays small and the code is fetched once, when first needed.
//
//   node <SKILL_ROOT>/install/templates.mjs [--refresh]      # prints {templates, source, verticals}
//
// Resolution, in order:
//   1. a checkout of the repository itself (the skill folder sits in it): `<repo>/templates/`.
//   2. the cache `<SKILL_ROOT>/templates/`, filled by an earlier call (`--refresh` refetches).
//   3. a fetch: a sparse, shallow clone of `templates/` from the repository the skill was installed
//      from (skills-lock.json's `source`, default wix/skills), at the branch or tag the install
//      named (its `ref`, falling back to the default branch when that ref no longer exists) or the
//      repository's default branch. The lock records no commit, so there is nothing more exact to
//      pin to; `WIX_HEADLESS_FAST_TEMPLATES_REF=<branch|tag|sha>` overrides the ref.
// The cache stays with the project: its `.gitignore` leaves out only the composed `project/`
// folders (the scaffolds with their lockfiles, read once, at create or attach) and the repository
// tooling, so the code layers, playbooks, seeds and readers are committed at the commit the project
// was built from, recorded in `.source`. A caller that needs a `project/` folder passes it as
// `need`; when a committed copy lacks it, that part is fetched at the same commit.
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// PREVIEW: the shipped code lives in the headless-templates repository (the fork's default branch
// carries the kit-preview layout): verticals/<v>/{app,app-astro,seed,INSTRUCTIONS.md}, rest/<v>/,
// astro/kit-<v>/ (the composed project), verticals/shared, verticals/blank. The loader assembles
// the cache in the layout every other script reads: <cache>/<v>/{app,app-astro,seed,rest,project},
// <cache>/shared, <cache>/blank. WIX_HEADLESS_KIT_TEMPLATES_DIR names a ready-made cache (CI).
export const DEFAULT_REPO = "https://github.com/ayal/headless-templates-preview.git";
const LAYOUT = { sources: "verticals", rest: "rest", projects: "astro", projectPrefix: "kit-" };
const SPARSE_PATHS = [LAYOUT.sources, LAYOUT.rest, LAYOUT.projects];

const git = (args, opts = {}) => spawnSync("git", args, { encoding: "utf8", timeout: 180_000, ...opts });

// The repository and ref the skill was installed from: the nearest skills-lock.json above the
// skill folder, its entry for this skill. "wix/skills" → the default branch of that repository;
// "https://github.com/owner/repo/tree/<ref>" → that ref.
export function installSource() {
  const skill = SKILL_ROOT.split("/").pop();
  let dir = SKILL_ROOT;
  for (let i = 0; i < 6; i++) {
    const p = join(dir, "skills-lock.json");
    if (existsSync(p)) {
      try {
        const entry = JSON.parse(readFileSync(p, "utf8")).skills?.[skill];
        if (typeof entry?.source === "string" && entry.source) {
          const parsed = parseSource(entry.source);
          // `ref` is the branch or tag the install named (skills-lock.json v1 keeps it beside `source`)
          return { ...parsed, ref: parsed.ref ?? (typeof entry.ref === "string" && entry.ref ? entry.ref : null) };
        }
      } catch { /* fall through to the default */ }
      break;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { repo: DEFAULT_REPO, ref: null };
}
// PREVIEW: the templates repository is fixed; the skill's own install source no longer names it.
const templatesRepo = () => ({ repo: DEFAULT_REPO, ref: process.env.WIX_HEADLESS_FAST_TEMPLATES_REF || null });

function parseSource(src) {
  const m = src.match(/^(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/\s#@]+?)(?:\.git)?(?:\/tree\/([^\s]+))?$/);
  if (!m) return { repo: DEFAULT_REPO, ref: null };
  return { repo: `https://github.com/${m[1]}/${m[2]}.git`, ref: m[3] ?? null };
}

export function listVerticals(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "shared" && d.name !== "blank" && existsSync(join(dir, d.name, "app")))
    .map((d) => d.name)
    .sort();
}

export function templatesDir({ refresh = false, need = null } = {}) {
  const override = process.env.WIX_HEADLESS_KIT_TEMPLATES_DIR;
  if (override && existsSync(join(override, "shared", "app"))) return override;
  const cache = join(SKILL_ROOT, "templates");
  if (!refresh && existsSync(join(cache, "shared", "app"))) {
    if (need && !existsSync(join(cache, need))) fetchIgnoredPart(cache, need);
    return cache;
  }
  fetchTemplates(cache);
  return cache;
}

// What a project's repository does not carry: the composed scaffolds (heavy, read once) and the
// repository's own tooling. Everything else in the cache is committed with the project.
const IGNORED = ["*/project/", "blank/", "compose.mjs"];

// A committed copy lacks the ignored parts. Fetch them at the commit the copy came from, so the
// scaffold a create copies matches the code committed beside it; the committed files are untouched.
function fetchIgnoredPart(cache, need) {
  const src = templatesSource(cache);
  const { repo } = templatesRepo();
  const r = cloneSparse(src.repo ?? repo, src.commit ?? process.env.WIX_HEADLESS_FAST_TEMPLATES_REF ?? null);
  const tmp = r.tmp;
  const assembled = r.status === 0 ? assemble(tmp) : null;
  if (!assembled || !existsSync(join(assembled, need))) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`could not fetch ${need} from ${src.repo ?? repo}${src.commit ? ` @ ${src.commit.slice(0, 7)}` : ""}: ${(r.stderr || r.stdout || "not in the clone").trim().slice(-300)}`);
  }
  for (const part of ["blank", ...readdirSync(assembled, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(assembled, d.name, "project"))).map((d) => `${d.name}/project`)]) {
    const from = join(assembled, part);
    if (existsSync(from) && !existsSync(join(cache, part))) cpSync(from, join(cache, part), { recursive: true });
  }
  rmSync(tmp, { recursive: true, force: true });
}

export function templatesSource(dir) {
  const p = join(dir, ".source");
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* below */ } }
  return { checkout: dir };
}

function fetchTemplates(cache) {
  const { repo } = templatesRepo();
  const lockRef = null;
  const envRef = process.env.WIX_HEADLESS_FAST_TEMPLATES_REF || null;
  let ref = envRef || lockRef || null;
  let r = cloneSparse(repo, ref);
  // The branch the skill was installed from can be gone by the time the code is first needed
  // (merged and deleted). The lock's ref then falls back to the default branch; an explicit env
  // ref does not.
  let fellBack = false;
  if (r.status !== 0 && ref && !envRef && /not found|couldn't find remote ref|unknown revision/i.test(r.stderr || "")) {
    rmSync(r.tmp, { recursive: true, force: true });
    fellBack = true; ref = null;
    r = cloneSparse(repo, null);
  }
  const tmp = r.tmp;
  if (r.error?.code === "ENOENT") {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error("git is not installed or not on PATH; the shipped code is fetched with a git clone of the skill's repository");
  }
  const assembled = r.status === 0 ? assemble(tmp) : null;
  if (!assembled || !existsSync(join(assembled, "shared", "app"))) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`could not fetch the templates from ${repo}${ref ? ` @ ${ref}` : ""}: ${(r.stderr || r.stdout || `no ${LAYOUT.sources}/shared/app in the clone`).trim().slice(-400)}`);
  }
  const commit = git(["-C", tmp, "rev-parse", "HEAD"]).stdout.trim();
  rmSync(cache, { recursive: true, force: true });
  mkdirSync(dirname(cache), { recursive: true });
  try { renameSync(assembled, cache); }
  catch { cpSync(assembled, cache, { recursive: true }); }
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(join(cache, ".gitignore"), IGNORED.join("\n") + "\n");
  writeFileSync(join(cache, ".source"), JSON.stringify({ repo, ref: ref ?? (fellBack ? `default branch (${lockRef} not found)` : "default branch"), commit, fetchedAt: new Date().toISOString() }, null, 2) + "\n");
}

// The clone holds the repository's layout; every script reads the legacy one. Build it in the
// temp dir: <v>/{app,app-astro,seed,INSTRUCTIONS.md} from verticals/<v>, <v>/rest from rest/<v>,
// <v>/project from astro/kit-<v>, shared and blank from verticals/.
function assemble(tmp) {
  const srcRoot = join(tmp, LAYOUT.sources);
  if (!existsSync(srcRoot)) return null;
  const out = join(tmp, "_assembled");
  mkdirSync(out, { recursive: true });
  for (const d of readdirSync(srcRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    cpSync(join(srcRoot, d.name), join(out, d.name), { recursive: true });
    const rest = join(tmp, LAYOUT.rest, d.name);
    if (existsSync(rest)) cpSync(rest, join(out, d.name, "rest"), { recursive: true });
    const project = join(tmp, LAYOUT.projects, `${LAYOUT.projectPrefix}${d.name}`);
    if (existsSync(project)) cpSync(project, join(out, d.name, "project"), { recursive: true });
  }
  return out;
}

// A sparse, shallow clone of the templates repository at a ref (branch, tag, or commit id) into a temp dir.
function cloneSparse(repo, ref) {
  const tmp = mkdtempSync(join(tmpdir(), "wix-headless-kit-templates-"));
  let r;
  if (ref && /^[0-9a-f]{40}$/i.test(ref)) {
    // a commit: shallow-fetch just it (GitHub serves any reachable commit by id)
    for (const args of [["init", "-q", tmp], ["-C", tmp, "remote", "add", "origin", repo], ["-C", tmp, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", ref], ["-C", tmp, "sparse-checkout", "set", ...SPARSE_PATHS], ["-C", tmp, "checkout", "-q", "FETCH_HEAD"]]) {
      r = git(args);
      if (r.status !== 0) break;
    }
  } else {
    r = git(["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", ...(ref ? ["-b", ref] : []), repo, tmp]);
    if (r.status === 0) r = git(["-C", tmp, "sparse-checkout", "set", ...SPARSE_PATHS]);
  }
  return { ...r, tmp };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const dir = templatesDir({ refresh: process.argv.includes("--refresh") });
    console.log(JSON.stringify({ templates: dir, source: templatesSource(dir), verticals: listVerticals(dir) }));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
