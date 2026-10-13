// Keep a project's package-lock.json valid for `npm ci` after package.json gained dependencies.
// `npm ci` refuses a lock whose root entry disagrees with package.json. When the dependency deploy
// added is already in the lock's tree (pulled in by something else), declaring it in the root entry
// too is all `npm ci` needs; a dependency the tree lacks is left for `npm install` to resolve.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const parse = (v) => {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// The ranges deploy writes: exact, ^x.y.z, ~x.y.z, >=x.y.z. Anything else is "not known to fit".
export function satisfies(version, range) {
  const v = parse(version);
  const m = String(range).trim().match(/^(\^|~|>=)?\s*v?(\d+\.\d+\.\d+)/);
  if (!v || !m) return false;
  const r = parse(m[2]);
  const op = m[1] ?? "";
  if (op === "") return cmp(v, r) === 0;
  if (cmp(v, r) < 0) return false;
  if (op === ">=") return true;
  if (op === "~") return v[0] === r[0] && v[1] === r[1];
  // caret: same major; for 0.x, same minor
  return r[0] > 0 ? v[0] === r[0] : v[0] === 0 && v[1] === r[1];
}

// Returns null when there is no lock; else {promoted, missing}. Writes the lock only when it changed.
export function syncLockRoot(projectDir) {
  const lockPath = join(projectDir, "package-lock.json");
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(lockPath) || !existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.packages ??= {};
  const root = (lock.packages[""] ??= {});
  const promoted = [], missing = [];
  let changed = false;
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (root[field]?.[name] === range) continue;
      const inTree = lock.packages[`node_modules/${name}`];
      if (inTree && satisfies(inTree.version, range)) {
        (root[field] ??= {})[name] = range;
        promoted.push(name);
        changed = true;
      } else {
        missing.push(name);
      }
    }
  }
  if (changed) writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  return { promoted, missing };
}
