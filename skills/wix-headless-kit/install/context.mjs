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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The variables the editor-to-headless migration writes into the child project's `prod`
// environment (headless-bo, editorMigrations/environmentMetadata.ts), which `wix env pull` copies
// into `.env.local` unchanged. The names are the platform's and are spelled once, here.
export const ENV = {
  clientId: "WIX_CLIENT_ID",
  parentSiteId: "EDITOR_MIGRATION_PARENT_SITE_ID",
  /** ACTIVE while the migration is under way; COMPLETED once the parent serves the child's frontend. */
  status: "EDITOR_MIGRATION_STATUS",
  childSiteId: "EDITOR_MIGRATION_CHILD_SITE_ID",
  childAppId: "EDITOR_MIGRATION_CHILD_APP_ID",
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

const ENV_PULL = ["-y", "@wix/cli@latest", "env", "pull"];
const runPull = (dir) => spawnSync("npx", ENV_PULL, { cwd: dir, env: { ...process.env, CI: "1" }, encoding: "utf8", timeout: 180_000 });

/**
 * `wix env pull` into `cwd/.env.local`, in place. Every project shape gets the command since Wix CLI
 * 1.1.253 (2026-09-29): before it, a config with `site.outputDirectory` (the static stack, a site
 * published through the drop flow) landed in a limited command set without `env`, and this pulled
 * through a temp copy of the config. Non-interactive; a failure comes back as `error`.
 */
export function pullEnv(cwd) {
  const envFile = join(cwd, ".env.local");
  const r = runPull(cwd);
  if (r.status === 0 && existsSync(envFile)) return { ok: true, via: "in place" };
  return { ok: false, error: (r.stderr || r.stdout || "env pull produced no .env.local — is the Wix CLI logged in? (npx @wix/cli@latest whoami)").trim().slice(-400) };
}

/**
 * Whether a frontend exists in this folder: a `package.json` (a bundled project), an `index.html` at
 * the root (plain pages), or an `index.html` inside the folder the config's `site.outputDirectory`
 * names (a static site laid out for release, pages under site/). Nothing else counts — not this
 * skill's code, not the skills folder, not AGENTS.md: those say who ran here, not what is here.
 */
export function frontendPresent(cwd = process.cwd()) {
  const has = (p) => existsSync(join(cwd, p));
  const outDir = (readWixConfig(cwd)?.site?.outputDirectory ?? "").replace(/^\.\//, "").replace(/\/$/, "");
  return {
    packageJson: has("package.json"),
    rootIndex: has("index.html"),
    outputIndex: !!outDir && outDir !== "." && has(join(outDir, "index.html")),
    outputDirectory: outDir || null,
  };
}

/**
 * What the folder IS, from five file facts — the one classification every script and SKILL.md
 * step 3 share: wix.config.json, its site.outputDirectory, the migration variables in .env.local,
 * package.json, index.html. `migrationActive` comes from siteContext (it needs `.env.local`).
 *
 *   empty             nothing that reads as a project → setup CREATE: the run makes the site, seeds the plan
 *   project           a frontend, no wix.config.json → setup ADOPT: `init` gives it a new, empty site, seeds the plan
 *   config-only       a config, no frontend → attach.mjs on the config's site; nothing seeded
 *   migration         a config whose .env.local declares an ACTIVE editor migration, with or without the blank
 *                     Astro starter the download carries → setup MIGRATE; nothing seeded. Decided before the
 *                     frontend test: the starter's package.json must not read as a project to iterate on
 *   wix-project       a config AND a frontend (package.json, or index.html in the output folder) → iterate:
 *                     never scaffold, init or reseed; deploy.mjs adds a solution, edits, release
 *   published-static  a config, index.html at the ROOT, no package.json, no laid-out output folder (a site
 *                     published through the drop flow and downloaded) → setup makes site/ the upload and
 *                     deploys the REST layer; the config's site, no init, nothing seeded
 */
export function folderShape(cwd = process.cwd(), { migrationActive = false } = {}) {
  const config = existsSync(join(cwd, "wix.config.json"));
  const f = frontendPresent(cwd);
  const next = {
    empty: "setup.mjs --vertical <v> --business-name <brand> [--plan]: creates the site here and seeds the plan (CREATE)",
    project: "setup.mjs --vertical <v> --stack <stack> [--plan]: init links the folder to a new, empty site, seeds the plan and deploys (ADOPT)",
    "config-only": "attach.mjs: the site exists and has no frontend yet; read what it holds (the vertical's read-site.mjs) — nothing is seeded; the vertical's seed module with a plan only when the brief supplies or describes content",
    migration: "setup.mjs (MIGRATE): the shipped code into the starter the download carries (or the composed template around a bare config); the site being migrated owns its content — guides/migration.md",
    "wix-project": "iterate: never scaffold, init or reseed. deploy.mjs <vertical…> --stack <stack> adds a solution, then ONE npm install; file edits for a change; release. Read the site (read-site.mjs) before any seed module runs",
    "published-static": "setup.mjs --vertical <v>: the config's site, no init; site/ becomes the upload and the REST layer lands in site/js/wix/; move the pages, styles and assets into site/. Nothing is seeded: read the site, then run the vertical's seed module with a plan when the brief gives content; release keeps the URL",
  };
  let shape;
  if (!config) shape = f.packageJson || f.rootIndex ? "project" : "empty";
  else if (migrationActive) shape = "migration";
  else if (f.packageJson || f.outputIndex) shape = "wix-project";
  else if (f.rootIndex) shape = "published-static";
  else shape = "config-only";
  return { shape, next: next[shape], facts: { config, ...f } };
}

/**
 * `{ folder: { shape, next, tells }, deploy: { siteId, appId }, content: { siteId, clientId },
 *    migration: { active, parentSiteId }, env: { file, present, pulled }, pullError?, warnings: [] }`.
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
  const status = env[ENV.status];
  // ACTIVE (or a parent id with no status yet) is a migration under way; COMPLETED means the parent
  // already serves this frontend and the project is an ordinary one again.
  const active = !!parentSiteId && (status === undefined || status.trim().toUpperCase() === "ACTIVE");
  const migration = { active, parentSiteId: active ? parentSiteId : null, ...(status ? { status: status.trim().toUpperCase() } : {}) };
  const clientId = env[ENV.clientId] || deploy.appId;
  const content = { siteId: active ? parentSiteId : deploy.siteId, clientId };
  const warnings = [];
  if (env[ENV.clientId] && deploy.appId && env[ENV.clientId] !== deploy.appId && !active && migration.status !== "COMPLETED") {
    warnings.push(`.env.local ${ENV.clientId} differs from wix.config.json appId and no migration is declared — the SDK client runs as the env's app, the release goes to the config's site`);
  }
  if (active && migration.parentSiteId === deploy.siteId) {
    warnings.push("the migration's parent site is the deploy site itself — nothing is being migrated");
  }
  return { folder: folderShape(cwd, { migrationActive: active }), deploy, content, migration, env: { file: envFile, present: Object.keys(env).length > 0, pulled }, ...(pullError ? { pullError } : {}), warnings };
}

// ---- CLI ----------------------------------------------------------------------------------------
if (process.argv[1] && /context\.mjs$/.test(process.argv[1])) {
  const argv = process.argv.slice(2);
  const pull = argv.includes("--no-pull") ? false : argv.includes("--refresh") ? true : "auto";
  console.log(JSON.stringify(siteContext({ pull }), null, 2));
}
