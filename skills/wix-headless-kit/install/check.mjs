// Is there a newer version? Read-only: compares this installed skill and its templates with the
// repository they came from and prints one JSON. It changes nothing and runs no update; the
// commands that would are in the output.
//
//   node <SKILL_ROOT>/install/check.mjs
//
// Two layers, two answers:
//   skill      the installed skill folder (SKILL.md, guides/, install/, cold-start/) against the
//              repository head: `current`, `behind` (with the files that differ), or `unknown`.
//   templates  `templates/.source` commit against the head: `current` or `behind`, with the
//              verticals touched and the commit messages in between.
// Updating the skill changes how the agent works, not the project. Refreshing the templates changes
// what future deploys copy and what the agent reads, not `src/`. Nothing here touches `src/`.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { SKILL_ROOT, installSource, templatesDir, templatesSource } from "./templates.mjs";

const git = (args, opts = {}) => spawnSync("git", args, { encoding: "utf8", timeout: 120_000, ...opts });
const skillName = SKILL_ROOT.split("/").pop();
const { repo } = installSource();

const out = { skill: {}, templates: {}, update: {} };

// ---- the repository: one clone of its history without file contents (small), read for both layers
const tmp = mkdtempSync(join(tmpdir(), "wix-headless-kit-check-"));
const clone = git(["clone", "--quiet", "--filter=blob:none", "--no-checkout", "--single-branch", repo, tmp]);
if (clone.status !== 0) {
  rmSync(tmp, { recursive: true, force: true });
  console.log(JSON.stringify({ error: `could not reach ${repo}: ${(clone.stderr || "").trim().slice(-200)}` }));
  process.exit(1);
}
const head = git(["-C", tmp, "rev-parse", "HEAD"]).stdout.trim();

// ---- skill folder: every installed file's blob hash against the head's tree -------------------
{
  const tree = git(["-C", tmp, "ls-tree", "-r", head, "--", `skills/${skillName}`]).stdout;
  const remote = new Map(tree.split("\n").filter(Boolean).map((l) => { const [meta, path] = l.split("\t"); return [path.slice(`skills/${skillName}/`.length), meta.split(" ")[2]]; }));
  const local = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.name === "templates" && dir === SKILL_ROOT) continue; // the templates are the other layer
      if (e.isDirectory()) walk(p); else local.push(relative(SKILL_ROOT, p));
    }
  };
  walk(SKILL_ROOT);
  const differs = [], missingHere = [];
  for (const f of local) if (remote.get(f) !== git(["hash-object", join(SKILL_ROOT, f)]).stdout.trim()) differs.push(f);
  for (const f of remote.keys()) if (!local.includes(f)) missingHere.push(f);
  out.skill = differs.length || missingHere.length
    ? { status: "behind", differs, ...(missingHere.length ? { missingHere } : {}), note: "a file that differs may also be one edited here; the update reinstalls the skill folder" }
    : { status: "current" };
}

// ---- templates: the recorded commit against the head ------------------------------------------
let dir = null;
try { dir = templatesDir(); } catch (e) { out.templates = { status: "unknown", detail: e.message }; }
if (dir) {
  const src = templatesSource(dir);
  if (src.checkout) out.templates = { status: "checkout", dir };
  else if (!src.commit) out.templates = { status: "unknown", detail: "no commit recorded in templates/.source" };
  else if (src.commit === head) out.templates = { status: "current", commit: src.commit };
  else {
    out.templates = { status: "behind", commit: src.commit, head };
    const files = git(["-C", tmp, "diff", "--name-only", `${src.commit}..${head}`, "--", "templates"]).stdout.split("\n").filter(Boolean);
    const log = git(["-C", tmp, "log", "--format=%s", `${src.commit}..${head}`, "--", "templates"]).stdout.split("\n").filter(Boolean);
    if (files.length || log.length) {
      out.templates.commitsBehind = log.length;
      out.templates.verticals = [...new Set(files.map((f) => f.split("/")[1]).filter((v) => v && !v.endsWith(".mjs")))].sort();
      out.templates.commits = log.slice(0, 20);
    } else {
      out.templates.detail = git(["-C", tmp, "cat-file", "-e", src.commit]).status === 0 ? "no template changes between the two commits" : "the recorded commit is not in the repository's history (a branch that was deleted?)";
    }
  }
}
rmSync(tmp, { recursive: true, force: true });

// ---- what would act on each ------------------------------------------------------------------
const rel = relative(process.cwd(), SKILL_ROOT) || ".";
out.update = {
  skill: `update ${skillName} the way it was installed (the plugin's update, or the skills CLI's)`,
  templates: `node ${rel}/install/templates.mjs --refresh   (then commit the changed files under ${rel}/templates)`,
  note: "neither touches src/; a shipped fix reaches the project by comparing its copy with the template",
};
console.log(JSON.stringify(out, null, 2));
