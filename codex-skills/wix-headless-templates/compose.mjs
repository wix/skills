// Compose a vertical's project: the blank scaffold (`blank/project`, what `wix create` copies plus
// what the CLI's extender adds), the vertical deployed into it by the skill's own deploy script,
// and a package-lock.json, so `wix create --template-path skills/wix-headless-templates/<vertical>/project`
// yields the whole first vertical and `npm ci` installs it without resolving.
//
//   node skills/wix-headless-templates/compose.mjs [<vertical> …] [--relock] [--lock-from <package-lock.json>]
//
//   no vertical      every vertical (a folder with an app/)
//   default          the project's existing lock is kept; a project without one gets a fresh
//                    resolution (`npm install --package-lock-only`)
//   --relock         resolve a fresh lock even when one exists
//   --lock-from      use this lock (one vertical only)
// Tarball URLs are written in registry.npmjs.org form whatever registry resolved them; npm
// substitutes the configured registry at install time. The root entry of the lock is brought in
// line with package.json (install/lock.mjs), and the result is checked: every dependency in
// package.json is in the lock's root entry with the same range, or the script exits 1.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listVerticals } from "../wix-headless-kit/install/templates.mjs";
import { syncLockRoot } from "../wix-headless-kit/install/lock.mjs";

const TEMPLATES = dirname(fileURLToPath(import.meta.url));
const DEPLOY = resolve(TEMPLATES, "..", "wix-headless-kit", "install", "deploy.mjs");
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };
const relock = argv.includes("--relock");
const lockFrom = flag("lock-from");
const skip = new Set(["--relock", "--lock-from", lockFrom].filter(Boolean));
const requested = argv.filter((a) => !skip.has(a));
const all = listVerticals(TEMPLATES);
const verticals = requested.length ? requested : all;
for (const v of verticals) if (!all.includes(v)) { console.error(`unknown vertical "${v}" — ${all.join(", ")}`); process.exit(1); }
if (lockFrom && verticals.length !== 1) { console.error("--lock-from takes exactly one vertical"); process.exit(1); }

const canonical = (lock) => {
  for (const [key, p] of Object.entries(lock.packages ?? {})) {
    if (!key || !p.resolved || !/^https?:\/\//.test(p.resolved)) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    p.resolved = `https://registry.npmjs.org/${name}/-/${basename(new URL(p.resolved).pathname)}`;
  }
  return lock;
};

let failed = false;
for (const v of verticals) {
  const project = join(TEMPLATES, v, "project");
  const lockPath = join(project, "package-lock.json");
  const kept = !relock && !lockFrom && existsSync(lockPath) ? readFileSync(lockPath, "utf8") : null;
  rmSync(project, { recursive: true, force: true });
  cpSync(join(TEMPLATES, "blank", "project"), project, { recursive: true });
  const d = spawnSync("node", [DEPLOY, v, "--stack", "astro"], { cwd: project, encoding: "utf8" });
  let deployed = {};
  try { deployed = JSON.parse(d.stdout); } catch { /* below */ }
  if (d.status !== 0 || deployed.error) { console.log(JSON.stringify({ vertical: v, error: deployed.error ?? (d.stderr || d.stdout).slice(-400) })); failed = true; continue; }
  let lock = "kept";
  if (kept) writeFileSync(lockPath, kept);
  else if (lockFrom) { cpSync(resolve(lockFrom), lockPath); lock = `from ${lockFrom}`; }
  else {
    const tmp = mkdtempSync(join(tmpdir(), "compose-"));
    cpSync(join(project, "package.json"), join(tmp, "package.json"));
    const r = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tmp, encoding: "utf8", timeout: 600_000 });
    if (r.status !== 0) { console.log(JSON.stringify({ vertical: v, error: `lock resolution failed: ${(r.stderr || r.stdout).slice(-400)}` })); failed = true; rmSync(tmp, { recursive: true, force: true }); continue; }
    writeFileSync(lockPath, JSON.stringify(canonical(JSON.parse(readFileSync(join(tmp, "package-lock.json"), "utf8"))), null, 2) + "\n");
    rmSync(tmp, { recursive: true, force: true });
    lock = "resolved";
  }
  const sync = syncLockRoot(project);
  // the project is a template: nothing site-specific, nothing generated
  for (const f of ["wix.config.json", ".env.local", ".env", "AGENTS.md", "CLAUDE.md", ".gemini", "node_modules", ".wix", ".astro", "dist"]) rmSync(join(project, f), { recursive: true, force: true });
  const lockRoot = JSON.parse(readFileSync(lockPath, "utf8")).packages?.[""] ?? {};
  const pkg = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
  const diff = [];
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [n, r] of Object.entries(pkg[field] ?? {})) if (lockRoot[field]?.[n] !== r) diff.push(`${n}: package.json ${r}, lock ${lockRoot[field]?.[n] ?? "absent"}`);
    for (const n of Object.keys(lockRoot[field] ?? {})) if (!(n in (pkg[field] ?? {}))) diff.push(`${n}: only in the lock`);
  }
  if (diff.length) failed = true;
  console.log(JSON.stringify({ vertical: v, lock, promoted: sync?.promoted ?? [], packages: Object.keys(JSON.parse(readFileSync(lockPath, "utf8")).packages ?? {}).length, depsAdded: deployed.depsAdded, astroConfig: deployed.astroConfig, ...(diff.length ? { error: `lock root out of line: ${diff.join("; ")}` } : {}) }));
}
process.exit(failed ? 1 : 0);
