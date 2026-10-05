// The Wix CLI the seeds call for a site token and for `wix env pull`.
//
// Order: the project's own copy (node_modules/.bin/wix, installed with the template's lock), then
// a `wix` on PATH, then `npx -y @wix/cli@latest` — which installs the CLI before running it, 20 to
// 60 s and a wall of npm output on a fresh machine. The first two take under two seconds.
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export function resolveWixCli(cwd = process.cwd()) {
  const bin = process.platform === "win32" ? "wix.cmd" : "wix";
  const local = join(cwd, "node_modules", ".bin", bin);
  // The project's copy counts only once its install has finished: the seed runs beside a detached
  // npm install, and mid-install the .bin shim can exist before the package it points at does
  // (seen live: "Cannot find module node_modules/.bin/wix"). npm writes node_modules/.package-lock.json
  // last, the same marker the kit's install step syncs on.
  const installed = existsSync(join(cwd, "node_modules", ".package-lock.json")) && existsSync(join(cwd, "node_modules", "@wix", "cli", "package.json"));
  if (installed && existsSync(local)) return { file: local, prefix: [] };
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, bin))) return { file: join(dir, bin), prefix: [] };
  }
  return { file: "npx", prefix: ["-y", "@wix/cli@latest"] };
}

/**
 * A site token for the API calls. Throws when the CLI is not logged in. The CLI may print a
 * notice (an update box, a project warning) around the token, so the token is extracted from
 * the output rather than taken whole.
 */
export function wixToken(siteId, cwd = process.cwd()) {
  const cli = resolveWixCli(cwd);
  const out = execFileSync(cli.file, [...cli.prefix, "token", "--site", siteId], { encoding: "utf8", cwd });
  // An older CLI starts its "update available" box on the token's own line, so a line split is
  // not enough: the token is the first long run of token characters.
  const token = out.match(/[A-Za-z0-9._-]{40,}/)?.[0];
  if (!token) throw new Error("The Wix CLI returned no token — run `wix login` (or `npx @wix/cli@latest login`) first.");
  return token;
}

/** Runs a Wix CLI command synchronously; same return shape as spawnSync. */
export function runWix(args, { cwd = process.cwd(), ...opts } = {}) {
  const cli = resolveWixCli(cwd);
  return spawnSync(cli.file, [...cli.prefix, ...args], { cwd, ...opts });
}
