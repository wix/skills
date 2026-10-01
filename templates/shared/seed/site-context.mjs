// Which site a seed or a reader targets — the templates' twin of install/context.mjs (the templates
// ship without the skill's install/ folder in reach, so the reading is repeated here, in full).
//
// A project's `wix.config.json` names the DEPLOY site; `.env.local` (what `wix env pull` writes) names
// the CONTENT site's app, and on a migration preview also the site being migrated (the parent). Seeds
// and readers are admin calls about content, so they target the content site: the config's site
// normally, the parent on a migration. `env pull` runs when `.env.local` is missing.
import { runWix } from "./wix-cli.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Spelled once in install/context.mjs; keep the two in step.
export const ENV = { clientId: "WIX_CLIENT_ID", parentSiteId: "EDITOR_MIGRATION_PARENT_SITE_ID", status: "EDITOR_MIGRATION_STATUS" };

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


const runPull = (dir) => runWix(["env", "pull"], { cwd: dir, env: { ...process.env, CI: "1" }, encoding: "utf8", timeout: 180_000 });

// `wix env pull` into cwd/.env.local, in place (every project shape has the command since Wix CLI
// 1.1.253; same as install/context.mjs).
function pullEnv(cwd) {
  const r = runPull(cwd);
  return r.status === 0 && existsSync(join(cwd, ".env.local"));
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
  const status = env[ENV.status];
  const active = !!parentSiteId && (status === undefined || status.trim().toUpperCase() === "ACTIVE");
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
