// The site context of a project folder — the one place that says which site a call targets.
//
//   node <SKILL_ROOT>/install/context.mjs [--refresh] [--no-pull]     (prints one JSON object)
//
// Two identities live in a Wix project and are the same site almost always:
//   deploy  — `wix.config.json` (`siteId`, `appId`): where `wix release` uploads. The CLI's business.
//   content — `.env.local` (`WIX_CLIENT_ID`, what `wix env pull` writes): the app the SDK client
//             runs as, on every stack (the Astro integration reads WIX_CLIENT_ID from the env and
//             never the config; the other stacks get it copied into src/wix/config.ts by deploy.mjs).
// They differ on a MIGRATION PREVIEW: a project whose config points at a fresh site created only to
// host the deployment, while `.env.local` carries the credentials of the site being migrated (the
// parent) and says so. Then every admin, discovery and seed call targets the parent, the SDK client
// is the parent's, and only the release goes to the child. Completing the migration is a CLI step
// that does not exist yet; this module only reads the state.
//
// `env pull` runs here when `.env.local` is missing (or --refresh): it is the source of the content
// identity, and the Astro build refuses to run without it. Non-interactive (CI=1); a failure is
// reported in `pullError` and the config's ids stand in, so a caller can still work offline.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The variables `wix env pull` writes for a migration preview. The names are the platform's and are
// spelled once, here.
export const ENV = {
  clientId: "WIX_CLIENT_ID",
  parentSiteId: "WIX_MIGRATION_PARENT_SITE_ID",
  migration: "WIX_MIGRATION",
};

/** KEY=value lines of a dotenv file, quotes stripped; null when the file is absent. */
export function readEnvFile(file) {
  if (!existsSync(file)) return null;
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    out[key] = value;
  }
  return out;
}

export function readWixConfig(cwd) {
  const file = join(cwd, "wix.config.json");
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

const truthy = (v) => typeof v === "string" && /^(1|true|yes|on)$/i.test(v.trim());

const ENV_PULL = ["-y", "@wix/cli@latest", "env", "pull"];
const runPull = (dir) => spawnSync("npx", ENV_PULL, { cwd: dir, env: { ...process.env, CI: "1" }, encoding: "utf8", timeout: 180_000 });

/**
 * `wix env pull` into `cwd/.env.local`. The CLI mounts `env` only once the folder reads as an Astro
 * project (an astro.config.* file, or `site.outputDirectory` in the config); a folder that holds just
 * the downloaded `wix.config.json` gets "unknown command 'env'". Then the pull runs in a temp folder
 * holding a copy of the config and an empty astro.config.mjs, and the `.env.local` comes back here.
 */
export function pullEnv(cwd) {
  const envFile = join(cwd, ".env.local");
  let r = runPull(cwd);
  if (r.status === 0 && existsSync(envFile)) return { ok: true, via: "in place" };
  const notAProjectYet = /unknown command 'env'/.test(`${r.stderr}${r.stdout}`);
  if (notAProjectYet) {
    const tmp = mkdtempSync(join(tmpdir(), "wix-env-pull-"));
    try {
      copyFileSync(join(cwd, "wix.config.json"), join(tmp, "wix.config.json"));
      writeFileSync(join(tmp, "astro.config.mjs"), "");
      r = runPull(tmp);
      if (r.status === 0 && existsSync(join(tmp, ".env.local"))) {
        copyFileSync(join(tmp, ".env.local"), envFile);
        return { ok: true, via: "stub project" };
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return { ok: false, error: (r.stderr || r.stdout || "env pull produced no .env.local — is the Wix CLI logged in? (npx @wix/cli@latest whoami)").trim().slice(-400) };
}

/**
 * `{ deploy: { siteId, appId }, content: { siteId, clientId }, migration: { active, parentSiteId },
 *    env: { file, present, pulled }, pullError?, warnings: [] }`.
 * `pull`: "auto" (default) pulls when `.env.local` is missing; true always; false never.
 */
export function siteContext({ cwd = process.cwd(), pull = "auto" } = {}) {
  const config = readWixConfig(cwd) ?? {};
  const deploy = { siteId: config.siteId ?? config.projectId ?? null, appId: config.appId ?? null };
  const envFile = join(cwd, ".env.local");
  let pulled = false, pullError;
  if (deploy.siteId && (pull === true || (pull === "auto" && !existsSync(envFile)))) {
    const r = pullEnv(cwd);
    if (r.ok) pulled = r.via;
    else pullError = r.error;
  }
  const env = readEnvFile(envFile) ?? {};
  const parentSiteId = env[ENV.parentSiteId] || null;
  const active = !!parentSiteId && (truthy(env[ENV.migration]) || env[ENV.migration] === undefined);
  const migration = { active, parentSiteId: active ? parentSiteId : null };
  const clientId = env[ENV.clientId] || deploy.appId;
  const content = { siteId: active ? parentSiteId : deploy.siteId, clientId };
  const warnings = [];
  if (env[ENV.clientId] && deploy.appId && env[ENV.clientId] !== deploy.appId && !active) {
    warnings.push(`.env.local ${ENV.clientId} differs from wix.config.json appId and no migration is declared — the SDK client runs as the env's app, the release goes to the config's site`);
  }
  if (active && migration.parentSiteId === deploy.siteId) {
    warnings.push("the migration's parent site is the deploy site itself — nothing is being migrated");
  }
  return { deploy, content, migration, env: { file: envFile, present: Object.keys(env).length > 0, pulled }, ...(pullError ? { pullError } : {}), warnings };
}

// ---- CLI ----------------------------------------------------------------------------------------
if (process.argv[1] && /context\.mjs$/.test(process.argv[1])) {
  const argv = process.argv.slice(2);
  const pull = argv.includes("--no-pull") ? false : argv.includes("--refresh") ? true : "auto";
  console.log(JSON.stringify(siteContext({ pull }), null, 2));
}
