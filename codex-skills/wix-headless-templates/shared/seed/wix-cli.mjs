// The Wix CLI the seeds call for a site token and for `wix env pull`.
//
// Order: the project's own copy (node_modules/@wix/cli, installed with the template's lock), then
// a `wix` on PATH, then `npx -y @wix/cli@<pinned>` — which installs the CLI before running it, 20 to
// 60 s and a wall of npm output on a fresh machine. The first two take under two seconds.
//
// On Windows `wix` and `npx` are .cmd shims, which Node starts only through a shell (ENOENT
// without one, EINVAL for an explicit .cmd since Node 20.12). There the CLI's own JS entry, and
// npm's npx entry beside node.exe, run through node directly.
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

// The CLI version the fallback installs; equal to `@wix/cli` in wix-headless-kit/install/pins.json.
const WIX_CLI_VERSION = "1.1.258";
const isWin = process.platform === "win32";

// The JS file a @wix/cli install runs (package.json `bin`), or null.
function cliEntry(pkgDir) {
  try {
    const { bin } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const rel = typeof bin === "string" ? bin : bin?.wix;
    return rel && existsSync(join(pkgDir, rel)) ? join(pkgDir, rel) : null;
  } catch {
    return null;
  }
}

function viaNpx() {
  const pkg = `@wix/cli@${WIX_CLI_VERSION}`;
  if (!isWin) return { file: "npx", prefix: ["-y", pkg] };
  const js = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (existsSync(js)) return { file: process.execPath, prefix: [js, "-y", pkg] };
  return { file: "npx.cmd", prefix: ["-y", pkg], shell: true };
}

export function resolveWixCli(cwd = process.cwd()) {
  // The project's copy counts only once its install has finished: the seed runs beside a detached
  // npm install, and mid-install the .bin shim can exist before the package it points at does
  // (seen live: "Cannot find module node_modules/.bin/wix"). npm writes node_modules/.package-lock.json
  // last, the same marker the kit's install step syncs on.
  const pkgDir = join(cwd, "node_modules", "@wix", "cli");
  const installed = existsSync(join(cwd, "node_modules", ".package-lock.json")) && existsSync(join(pkgDir, "package.json"));
  if (installed) {
    const local = join(cwd, "node_modules", ".bin", "wix");
    if (!isWin && existsSync(local)) return { file: local, prefix: [] };
    const entry = isWin && cliEntry(pkgDir);
    if (entry) return { file: process.execPath, prefix: [entry] };
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    if (!isWin && existsSync(join(dir, "wix"))) return { file: join(dir, "wix"), prefix: [] };
    // A global npm install on Windows: wix.cmd in the prefix, the package beside it.
    const entry = isWin && existsSync(join(dir, "wix.cmd")) && cliEntry(join(dir, "node_modules", "@wix", "cli"));
    if (entry) return { file: process.execPath, prefix: [entry] };
  }
  return viaNpx();
}

/**
 * A site token for the API calls. Throws when the CLI is not logged in. The CLI may print a
 * notice (an update box, a project warning) around the token, so the token is extracted from
 * the output rather than taken whole.
 */
export function wixToken(siteId, cwd = process.cwd()) {
  const cli = resolveWixCli(cwd);
  const out = execFileSync(cli.file, [...cli.prefix, "token", "--site", siteId], { encoding: "utf8", cwd, shell: cli.shell, windowsHide: true });
  // An older CLI starts its "update available" box on the token's own line, so a line split is
  // not enough: the token is the first long run of token characters.
  const token = out.match(/[A-Za-z0-9._-]{40,}/)?.[0];
  if (!token) throw new Error(`The Wix CLI returned no token — run \`wix login\` (or \`npx @wix/cli@${WIX_CLI_VERSION} login\`) first.`);
  return token;
}

/** Runs a Wix CLI command synchronously; same return shape as spawnSync. */
export function runWix(args, { cwd = process.cwd(), ...opts } = {}) {
  const cli = resolveWixCli(cwd);
  return spawnSync(cli.file, [...cli.prefix, ...args], { cwd, shell: cli.shell, windowsHide: true, ...opts });
}
