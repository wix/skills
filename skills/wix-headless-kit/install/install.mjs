// The project's one dependency install, decided from what is already on disk. Run from the
// PROJECT ROOT:
//
//   node <SKILL_ROOT>/install/install.mjs            runs it, prints {decision, lock, status}
//   node <SKILL_ROOT>/install/install.mjs --decide   prints the decision without installing
//
// What the lock asks for is compared with node_modules (each entry's package.json version):
//   none     every entry is there at its version — nothing runs. A machine image that pre-warms the
//            solutions' packages, or a second deploy that added nothing, ends here in under a second.
//   install  node_modules exists and holds most of the lock — `npm install --ignore-scripts` keeps what
//            is there and writes only the difference (seconds for a few packages).
//   ci       no node_modules, or a tree that lacks most of the lock (the blank starter under a
//            solution's lock: measured 67 s for ci against 84 s for install there) —
//            `npm ci --ignore-scripts || npm install --ignore-scripts` (ci needs a lock that agrees
//            with package.json; without one, install).
// Every path ends with `.install-exit` holding the exit code (0 for none), the marker setup.mjs,
// attach.mjs and SKILL.md step 3 sync on. Never two installs concurrently in one project: a second
// npm in the same node_modules redoes the first one's work.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { npmSync } from "./proc.mjs";

/** {total, missing, sample}: the lock's node_modules entries the tree lacks or holds at another version. */
export function lockGaps(projectDir) {
  const lockPath = join(projectDir, "package-lock.json");
  if (!existsSync(lockPath)) return null;
  let lock;
  try { lock = JSON.parse(readFileSync(lockPath, "utf8")); } catch { return null; }
  // Optional entries (a platform's native binaries, an optional peer) are absent on every other platform and
  // npm leaves them out without complaint, so they never count as gaps.
  const entries = Object.entries(lock.packages ?? {}).filter(([path, e]) => path.startsWith("node_modules/") && !e.link && !e.optional && !e.devOptional);
  let missing = 0;
  const sample = [];
  // A package.json dependency the lock's root entry does not declare (deploy's fill-only patch
  // added it after the lock was written) is a gap too: the lock no longer describes the project.
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    const root = lock.packages?.[""] ?? {};
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (!(root[field]?.[name] ?? root.dependencies?.[name] ?? root.devDependencies?.[name])) {
          missing++;
          if (sample.length < 5) sample.push(`${name} (in package.json, not in the lock)`);
        }
      }
    }
  } catch { /* no package.json: the lock entries decide */ }
  for (const [path, e] of entries) {
    let version = null;
    try { version = JSON.parse(readFileSync(join(projectDir, path, "package.json"), "utf8")).version; } catch { /* absent */ }
    if (version !== e.version) {
      missing++;
      if (sample.length < 5) sample.push(`${path.replace(/^node_modules\//, "")}@${e.version}${version ? ` (have ${version})` : ""}`);
    }
  }
  return { total: entries.length, missing, sample };
}

export function installDecision(projectDir = process.cwd()) {
  const hasModules = existsSync(join(projectDir, "node_modules"));
  const lock = lockGaps(projectDir);
  if (!hasModules) return { decision: existsSync(join(projectDir, "package-lock.json")) ? "ci" : "install", lock };
  if (!lock || lock.total === 0) return { decision: "install", lock };
  if (lock.missing === 0) return { decision: "none", lock };
  return { decision: lock.missing > lock.total / 2 ? "ci" : "install", lock };
}

/** Runs the decided install; stdio defaults to inherited. Returns {decision, lock, status}. */
export function runInstall(projectDir = process.cwd(), { stdio = "inherit" } = {}) {
  const { decision, lock } = installDecision(projectDir);
  const flags = ["--ignore-scripts"];
  let status = 0;
  if (decision === "ci") {
    let r = npmSync("npm", ["ci", ...flags], { cwd: projectDir, stdio });
    if (r.status !== 0) r = npmSync("npm", ["install", ...flags], { cwd: projectDir, stdio });
    if (r.error) console.error(`npm could not start: ${r.error.message}`);
    status = r.status ?? 1;
  } else if (decision === "install") {
    const r = npmSync("npm", ["install", ...flags], { cwd: projectDir, stdio });
    if (r.error) console.error(`npm could not start: ${r.error.message}`);
    status = r.status ?? 1;
  }
  writeFileSync(join(projectDir, ".install-exit"), `${status}\n`);
  return { decision, lock, status };
}

if (process.argv[1] && /install\.mjs$/.test(process.argv[1])) {
  if (process.argv.includes("--decide")) {
    console.log(JSON.stringify(installDecision(), null, 2));
  } else {
    const r = runInstall(process.cwd());
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status);
  }
}
