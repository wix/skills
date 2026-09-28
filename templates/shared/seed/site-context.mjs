// Which site a seed or a reader targets — the templates' twin of install/context.mjs (the templates
// ship without the skill's install/ folder in reach, so the reading is repeated here, in full).
//
// A project's `wix.config.json` names the DEPLOY site; `.env.local` (what `wix env pull` writes) names
// the CONTENT site's app, and on a migration preview also the site being migrated (the parent). Seeds
// and readers are admin calls about content, so they target the content site: the config's site
// normally, the parent on a migration. `env pull` runs when `.env.local` is missing.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Spelled once in install/context.mjs; keep the two in step.
export const ENV = { clientId: "WIX_CLIENT_ID", parentSiteId: "WIX_MIGRATION_PARENT_SITE_ID", migration: "WIX_MIGRATION" };

function readEnvFile(file) {
  if (!existsSync(file)) return null;
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).replace(/\\"/g, '"');
    out[line.slice(0, eq).trim().replace(/^export\s+/, "")] = value;
  }
  return out;
}

const truthy = (v) => typeof v === "string" && /^(1|true|yes|on)$/i.test(v.trim());

const runPull = (dir) => spawnSync("npx", ["-y", "@wix/cli@latest", "env", "pull"], { cwd: dir, env: { ...process.env, CI: "1" }, encoding: "utf8", timeout: 180_000 });

// `wix env pull` into cwd/.env.local. The CLI mounts `env` only once the folder reads as an Astro
// project; a folder holding just the config gets "unknown command 'env'" and is pulled through a temp
// folder with a copy of the config and an empty astro.config.mjs (same as install/context.mjs).
function pullEnv(cwd) {
  const envFile = join(cwd, ".env.local");
  let r = runPull(cwd);
  if (r.status === 0 && existsSync(envFile)) return true;
  if (!/unknown command 'env'/.test(`${r.stderr}${r.stdout}`)) return false;
  const tmp = mkdtempSync(join(tmpdir(), "wix-env-pull-"));
  try {
    copyFileSync(join(cwd, "wix.config.json"), join(tmp, "wix.config.json"));
    writeFileSync(join(tmp, "astro.config.mjs"), "");
    r = runPull(tmp);
    if (r.status === 0 && existsSync(join(tmp, ".env.local"))) { copyFileSync(join(tmp, ".env.local"), envFile); return true; }
    return false;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** `{ deploySiteId, contentSiteId, migration: { active, parentSiteId } }` for the folder. */
export function siteContext({ cwd = process.cwd() } = {}) {
  const configFile = join(cwd, "wix.config.json");
  const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
  const deploySiteId = config.siteId ?? config.projectId ?? null;
  const envFile = join(cwd, ".env.local");
  if (deploySiteId && !existsSync(envFile)) pullEnv(cwd);
  const env = readEnvFile(envFile) ?? {};
  const parentSiteId = env[ENV.parentSiteId] || null;
  const active = !!parentSiteId && (truthy(env[ENV.migration]) || env[ENV.migration] === undefined);
  return { deploySiteId, contentSiteId: active ? parentSiteId : deploySiteId, migration: { active, parentSiteId: active ? parentSiteId : null } };
}

/** The site a READ targets (a reader, a sizing): the content site. */
export function contentSiteId({ cwd = process.cwd() } = {}) {
  return siteContext({ cwd }).contentSiteId;
}

/**
 * The site a SEED writes to. On a migration preview the content site is the live original, so the
 * seed stops unless the caller passed `--allow-parent` after the user confirmed. Throws with the reason.
 */
export function seedSiteId({ cwd = process.cwd(), argv = process.argv } = {}) {
  const ctx = siteContext({ cwd });
  if (!ctx.deploySiteId) throw new Error("wix.config.json has no siteId — is this a Wix CLI project?");
  if (ctx.migration.active && !argv.includes("--allow-parent")) {
    throw new Error(`this project deploys a migration preview of site ${ctx.migration.parentSiteId}: seeding would write into the live original. The site owns its content — skip the seed; if the user asked for content to be created there, re-run with --allow-parent.`);
  }
  return ctx.contentSiteId;
}
