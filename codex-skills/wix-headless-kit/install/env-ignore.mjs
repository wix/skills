// .env.local holds the app's WIX_CLIENT_SECRET (written by `wix env pull`, `init` and attach.mjs), so
// every project setup.mjs and attach.mjs leave behind ignores it in git. A line `.env` alone does not
// cover `.env.local`; `.env.local`, `.env*`, `.env.*` or `*.local` do.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COVERS_ENV_LOCAL = /^\s*(\.env\.local|\.env\*|\.env\.\*|\*\.local)\s*$/m;

/** Appends `.env.local` and `.env` to dir/.gitignore unless it already ignores `.env.local`. */
export function ignoreEnvLocal(dir) {
  const gi = join(dir, ".gitignore");
  const cur = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (COVERS_ENV_LOCAL.test(cur)) return false;
  writeFileSync(gi, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + "\n# local env (pulled from Wix)\n.env.local\n.env\n");
  return true;
}
