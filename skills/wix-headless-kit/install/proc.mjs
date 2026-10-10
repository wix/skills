// npm and npx, started the same way on every OS, and the two detached jobs (the dependency install
// and the seed) without a POSIX shell.
//
// On Windows npm and npx are .cmd shims: Node starts a .cmd only through a shell (ENOENT without
// one, EINVAL for an explicit .cmd since Node 20.12). npm ships their JS entry points beside
// node.exe, and those start directly with node. A Node without npm beside it (a version manager's
// shim) gets the .cmd through cmd.exe, as one quoted command line.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const isWin = process.platform === "win32";
const BACKGROUND = join(dirname(fileURLToPath(import.meta.url)), "background.mjs");

const cmdQuote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

/** How to start `npm` or `npx` with `args` here: `{ file, args, shell }` for spawn/spawnSync. */
export function npmCommand(name, args) {
  if (!isWin) return { file: name, args, shell: false };
  const js = join(dirname(process.execPath), "node_modules", "npm", "bin", `${name}-cli.js`);
  if (existsSync(js)) return { file: process.execPath, args: [js, ...args], shell: false };
  return { file: [`${name}.cmd`, ...args.map(cmdQuote)].join(" "), args: [], shell: true };
}

/** spawnSync for npm / npx; same return shape. */
export function npmSync(name, args, opts = {}) {
  const c = npmCommand(name, args);
  return spawnSync(c.file, c.args, { ...opts, shell: c.shell, windowsHide: true });
}

/** Why a spawnSync result failed: its output, else the spawn error, else the exit status. */
export const failure = (r, fallback = "") =>
  String(r.stderr || r.stdout || r.error?.message || fallback || `exit ${r.status ?? r.signal}`);

/**
 * Starts install/background.mjs detached: `install` (npm ci, else npm install, output to `log`) or
 * `seed` (node <seed> <plan>: result JSON, log and exit-code marker as files in `cwd`).
 */
export function startBackground(job, args, { cwd, log }) {
  const fd = log ? openSync(log, "a") : "ignore";
  const child = spawn(process.execPath, [BACKGROUND, job, ...args], {
    cwd, detached: true, windowsHide: true, stdio: ["ignore", fd, fd],
  });
  child.unref();
}
