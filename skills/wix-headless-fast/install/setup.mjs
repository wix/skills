// Set up the project in the current folder — one deterministic call from "the folder and the
// brief" to "brand layer can start", for a folder that is NOT yet a Wix project:
//
//   node <SKILL_ROOT>/install/setup.mjs --vertical <storefront|bookings|…> \
//        [--plan plan.json] [--business-name "<Brand>"] [--stack astro|react|lib|static] \
//        [--subfolder [--folder-name <npm-safe-name>]]
//
//   - `wix.config.json` present → refuses. The folder is already a Wix project; deploy.mjs adds
//     this skill's code or a solution to it, then one install, then the seed if there is content.
//     One exception: a config and NO project whose `.env.local` (`wix env pull`, run here) declares a
//     MIGRATION PREVIEW — the config names a site created only to host the deployment, the env names
//     the site being migrated. Then → MIGRATE: the composed template is copied in around the config,
//     the code deploys with the parent's app as its client, the install starts, and NO seed runs: the
//     parent owns its content. Release still goes where the config says (install/context.mjs).
//   - a project but no `wix.config.json` (a package.json, or an index.html at the root) → CONNECT:
//     `npm create @wix/new@latest init` in place creates the site and the config, then deploy.
//   - otherwise (empty, or loose files such as a CSV or a brief) → CREATE: `wix create` with the
//     vertical's composed template (templates/<vertical>/project: the CLI's blank scaffold with the
//     vertical deployed and a lockfile), placed in the current directory (`--business-name` required).
//
// The script reads file markers only (wix.config.json, a package.json or index.html); everything
// else is the agent's call: when connecting, `--stack` is required and comes from SKILL.md step 1,
// and what the project needs for that stack on Wix hosting is prose there, not detection here. The
// seed runs only when `--plan` is given: a brief that has not supplied any content gets no seed.
//
// Composes pieces that also remain individually runnable (deploy.mjs, the vertical's seed module)
// to recover one failed step. Emits ONE JSON event per line and exits in ~35s with the two long
// steps — the dependency install and the seed — running detached in the background (logs and
// completion markers in the final event), so the caller can build the brand layer while they finish.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CONFIG_FILES, writeAgentsMd } from "./agents-md.mjs";
import { listVerticals, templatesDir } from "./templates.mjs";
import { siteContext } from "./context.mjs";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const emit = (event, extra = {}) => console.log(JSON.stringify({ event, ...extra }));
const fail = (step, detail) => {
  emit("error", { step, detail: String(detail).slice(0, 600) });
  process.exit(1);
};

// ---- args ---------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const businessName = flag("business-name");
const planPath = flag("plan");
const vertical = flag("vertical");
const stackFlag = flag("stack");
// Opt-in: keep a CREATE's project in a subfolder instead of the current directory.
const subfolder = argv.includes("--subfolder");
// The shipped code: the repository's templates/ (a checkout, the cache, or fetched now, in a second).
let TEMPLATES;
try { TEMPLATES = templatesDir(); } catch (e) { fail("templates", e.message); }
const knownVerticals = listVerticals(TEMPLATES);
const usage = `usage: setup.mjs --vertical <${knownVerticals.join("|")}> [--plan plan.json] [--business-name "<Brand>"] [--stack astro|react|lib|static] [--subfolder]`;
// --vertical is REQUIRED: a defaulted vertical deploys the wrong code and runs the wrong seed.
if (!vertical) fail("args", usage);
if (!knownVerticals.includes(vertical)) {
  fail("args", `unknown vertical "${vertical}" — shipped verticals: ${knownVerticals.join(", ")}`);
}
if (stackFlag && !["astro", "react", "lib", "static"].includes(stackFlag)) {
  fail("args", `unknown --stack "${stackFlag}" — astro, react, lib or static`);
}
if (planPath && !existsSync(planPath)) fail("args", `plan file not found: ${planPath}`);

// ---- 0 · read the folder --------------------------------------------------------------------------
const cwd = process.cwd();
const has = (p) => existsSync(join(cwd, p));
const pkg = has("package.json") ? JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) : null;
const hasProject = !!pkg || has("index.html");
// A config here: refuse, unless it is a migration preview with no project yet (the site context
// pulls .env.local when missing — that is where the migration is declared).
let ctx = null;
if (has("wix.config.json")) {
  ctx = siteContext({ cwd });
  if (hasProject || !ctx.migration.active) {
    fail("place", "this folder is already a Wix project (wix.config.json): nothing to set up. deploy.mjs <vertical> adds this skill's code or a solution to it; then ONE npm install; then the vertical's seed module if there is content to create. A config with no project is attach.mjs's case (SKILL.md step 3)" + (ctx.pullError ? ` — note: env pull failed here (${ctx.pullError.slice(0, 120)})` : ""));
  }
}
const mode = ctx ? "migrate" : hasProject ? "connect" : "create";
if (mode === "connect" && !stackFlag) {
  fail("args", "connecting a project on disk needs --stack astro|react|lib|static — the stack you resolved in SKILL.md step 1 for this project");
}
const stack = stackFlag ?? "astro";
emit("folder", { mode, stack, project: hasProject ? (pkg?.name ?? basename(cwd)) : null, ...(ctx ? { migration: ctx.migration, deploySiteId: ctx.deploy.siteId, warnings: ctx.warnings } : {}) });

let projectDir = cwd;
let folderName = null;

if (mode === "create") {
  // ---- 1 · scaffold -----------------------------------------------------------------------------
  if (!businessName) fail("args", `an empty folder is a CREATE run and needs --business-name. ${usage}`);
  folderName =
    flag("folder-name") ??
    businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  // `let`: the Wix CLI can only scaffold into a subfolder; by default we then move the scaffold up
  // into the current directory and repoint projectDir there, so the detached install/seed and every
  // reported path use the final location.
  projectDir = resolve(cwd, folderName);
  if (existsSync(join(projectDir, "wix.config.json"))) {
    emit("scaffold_skipped", { reason: "project already exists", folder: folderName });
  } else {
    // The composed template: the CLI copies it in place of its blank one, creates the site and
    // writes wix.config.json; the vertical's code and its lockfile arrive with it. Any other
    // stack takes the CLI's blank Astro scaffold, as before, and deploy below adds the code.
    // The composed project is the one part of the templates a project's repository does not keep;
    // a committed copy fetches it here, at the commit the rest came from.
    const template = stack === "astro" ? join(templatesDir({ need: `${vertical}/project` }), vertical, "project") : null;
    emit("scaffolding", { folder: folderName, template });
    const scaffold = spawnSync(
      "npm",
      // --skip-git: this wrapper composes its own steps and leaves version control to
      // the caller / the enclosing repo; the scaffold's own `git init` + "Initial
      // commit" is noise here, and becomes a nested-repo (submodule gitlink) hazard
      // if the project is later placed inside an existing repo. --skip-install for the
      // same reason: deps install in a detached step below.
      ["create", "@wix/new@latest", "--", "headless",
       "--folder-name", folderName, "--business-name", businessName,
       "--site-template", "blank", ...(template ? ["--template-path", template] : []),
       "--skip-install", "--skip-git", "--no-publish"],
      { env: { ...process.env, CI: "1" }, encoding: "utf8", timeout: 300_000 },
    );
    if (scaffold.status !== 0 || !existsSync(join(projectDir, "wix.config.json"))) {
      fail("scaffold", (scaffold.stderr || scaffold.stdout || "scaffold produced no wix.config.json — is the Wix CLI logged in? (npx @wix/cli@latest whoami)").slice(-600));
    }
  }
} else if (mode === "migrate") {
  // ---- 1 · a migration preview: the config and credentials came with the folder -------------------
  // No site is created and nothing is provisioned: `wix.config.json` already names the deploy site
  // and its app, `.env.local` the parent's. Managed Astro gets the vertical's composed template copied
  // in around them (what `wix create` would have copied; the config and env are never overwritten);
  // any other stack is code-only and deploy below adds it.
  if (planPath) emit("seed_skipped", { reason: `migration preview of site ${ctx.migration.parentSiteId}: the site owns its content and nothing is seeded — the plan is ignored` });
  if (stack === "astro") {
    const template = join(templatesDir({ need: `${vertical}/project` }), vertical, "project");
    emit("scaffolding", { folder: cwd, template, from: "migration preview" });
    cpSync(template, cwd, { recursive: true, force: false, errorOnExist: false });
    const pkgPath = join(cwd, "package.json");
    const scaffolded = JSON.parse(readFileSync(pkgPath, "utf8"));
    scaffolded.name = basename(cwd).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "site";
    writeFileSync(pkgPath, JSON.stringify(scaffolded, null, 2) + "\n");
  }
  const gi = join(cwd, ".gitignore");
  const cur = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!/\.env/.test(cur)) writeFileSync(gi, cur + "\n# local env (pulled from Wix)\n.env.local\n.env\n");
} else {
  // ---- 1 · init in place --------------------------------------------------------------------------
  // The CLI's `init` links the folder to a NEW site: creates the site and its OAuth app, writes
  // wix.config.json and .env.local, touches nothing else. Non-interactive under CI=1; the site is
  // named after the folder (rename it in the dashboard).
  emit("initializing", { folder: cwd });
  const init = spawnSync("npm", ["create", "@wix/new@latest", "--", "init"],
    { cwd, env: { ...process.env, CI: "1" }, encoding: "utf8", timeout: 300_000 });
  if (init.status !== 0 || !has("wix.config.json")) {
    fail("init", (init.stderr || init.stdout || "init produced no wix.config.json — is the Wix CLI logged in? (npx @wix/cli@latest whoami)").slice(-600));
  }
}
const wixConfig = JSON.parse(readFileSync(join(projectDir, "wix.config.json"), "utf8"));
const siteId = wixConfig.siteId ?? wixConfig.projectId;
// Static: `wix release` uploads the output folder whole, so the project root (config, plan, seed
// output, the skills) must not be it. The site lives in site/: the config points there and the REST
// layer deploys into it; the pages, styles and assets are the agent's to move (the `next` says so).
const STATIC_OUT = "site";
if (stack === "static") {
  wixConfig.site = { ...(wixConfig.site ?? {}), outputDirectory: `./${STATIC_OUT}` };
  writeFileSync(join(projectDir, "wix.config.json"), JSON.stringify(wixConfig, null, 2) + "\n");
}
emit(mode === "create" ? "scaffolded" : mode === "migrate" ? "migration_preview" : "connected", {
  folder: folderName ?? cwd, stack,
  ...(ctx ? { deploySiteId: ctx.deploy.siteId, contentSiteId: ctx.content.siteId } : { siteId }),
});

// ---- 2 · deploy shipped code + deps ---------------------------------------------------------------
// A CREATE from the composed template already holds the code and the lock: deploy adds nothing and
// reports the project; a CONNECT gets the code and its dependencies here.
const deploy = spawnSync(
  "node",
  [join(SKILL_ROOT, "install", "deploy.mjs"), vertical, "--stack", stack, ...(stack === "static" ? ["--out", STATIC_OUT] : []), ...(planPath ? ["--plan", resolve(planPath)] : [])],
  { cwd: projectDir, encoding: "utf8", timeout: 60_000 },
);
if (deploy.status !== 0) fail("deploy", deploy.stderr || deploy.stdout);
let deployResult = {};
try { deployResult = JSON.parse(deploy.stdout); } catch { /* keep going with raw output below */ }
if (deployResult.error) fail("deploy", deployResult.error);
emit("deployed", deployResult);

// ---- 2c · place a CREATE's project in the current directory -------------------------------------
// The Wix CLI scaffolds into a subfolder, so the scaffold is moved up into the current directory —
// the folder that already holds the installed skills — and the subfolder removed. Done HERE, before
// the detached install below, on purpose: no node_modules exists yet, so the move is instant and
// cannot collide with a running install. A pure move: the scaffold was created with --skip-git, so
// there is no nested repo to reconcile — git is whatever the folder already is. Refuses rather than
// overwrite: an entry that already exists in the current directory stops the move before anything
// is touched. `--subfolder` skips this step.
if (mode === "create" && !subfolder && projectDir !== cwd) {
  // The CLI's own agent config files, when its generator managed to write them, are dropped from
  // the scaffold: ours (written below, after the move) carries the same CLI section plus this
  // project's skills. A file the user's folder already has is never overwritten or merged into —
  // it is kept as is, and the agent_configs event says so.
  for (const f of AGENT_CONFIG_FILES) rmSync(join(projectDir, f), { recursive: true, force: true });
  const entries = readdirSync(projectDir);
  const clashes = entries.filter((e) => existsSync(join(cwd, e)));
  if (clashes.length) {
    fail("place", `the current directory already has: ${clashes.join(", ")} — run with --subfolder to keep the project in ${folderName}/, or start in an empty folder`);
  }
  try {
    for (const entry of entries) renameSync(join(projectDir, entry), join(cwd, entry));
    rmSync(projectDir, { recursive: true, force: true });
    projectDir = cwd;
    emit("project_placed", { into: cwd });
  } catch (e) {
    fail("place", e?.stack || e);
  }
}

// ---- 2d · the agent config files `wix create` would have written --------------------------------
// Skipped by the CLI because of --skip-install. Fill-only: a project that has its own AGENTS.md
// keeps it (the event says `kept`).
emit("agent_configs", writeAgentsMd(projectDir, { skill: basename(SKILL_ROOT), stack, ...(ctx ? { migration: { parentSiteId: ctx.migration.parentSiteId, deploySiteId: ctx.deploy.siteId } } : {}) }));

// ---- 3 · start the dependency install, detached --------------------------------------------------
// ONE install, here, for any project with a package.json (deploy patched it). The static stack has
// no package.json and nothing to install. `npm ci` only where a lockfile exists: without one it fails
// with a usage error that sits at the top of the log and reads as a failed install (run 109).
let install = null;
if (stack !== "static" && existsSync(join(projectDir, "package.json"))) {
  const installLog = join(projectDir, "npm-install.log");
  const logFd = openSync(installLog, "a");
  const child = spawn("sh", ["-c", existsSync(join(projectDir, "package-lock.json")) ? "npm ci --ignore-scripts || npm install --ignore-scripts" : "npm install --ignore-scripts"], {
    cwd: projectDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  install = { log: installLog, doneMarker: "node_modules/.package-lock.json" };
  emit("install_started", install);
}

// ---- 4 · start the seed, detached (only with a plan) ---------------------------------------------
// The seed includes a Wix-side provisioning wait of unpredictable length (10-80s); running it in
// the caller's foreground would idle the agent for exactly that long. Detach it like the install:
// result JSON + exit-code marker land as files the caller syncs on before release. Seeding is
// additive: it never deletes or overwrites what the site holds.
let seed = null;
if (planPath && mode !== "migrate") {
  const seedDir = join(TEMPLATES, vertical, "seed");
  const seedName = existsSync(seedDir)
    ? readdirSync(seedDir).find((f) => f.startsWith("seed-") && f.endsWith(".mjs"))
    : undefined;
  if (!seedName) fail("seed", `no seed module found under ${seedDir}`);
  const seedFile = join(seedDir, seedName);
  const planAbs = resolve(planPath);
  const seedChild = spawn(
    "sh",
    ["-c", `node "${seedFile}" "${planAbs}" > seed-result.json 2> seed.log; echo $? > .seed-exit`],
    { cwd: projectDir, detached: true, stdio: "ignore" },
  );
  seedChild.unref();
  seed = { resultFile: "seed-result.json", log: "seed.log", doneMarker: ".seed-exit", success: "file contains 0" };
  emit("seeding_started", { vertical, ...seed });
}

// ---- done ----------------------------------------------------------------------------------------
const release = {
  astro: "npx @wix/cli@latest build, then npx @wix/cli@latest release",
  react: "the project's own build, then npx @wix/cli@latest release of the build folder named in wix.config.json (what Wix hosting serves and how routes must be shaped: SKILL.md step 1)",
  lib: "the project's own build, then npx @wix/cli@latest release of the build folder named in wix.config.json (SKILL.md step 1)",
  static: `npx @wix/cli@latest release — no build; it uploads ${STATIC_OUT}/ whole (wix.config.json site.outputDirectory), so the pages, styles and assets move into ${STATIC_OUT}/ first and import the modules from ./js/wix/ there; the root keeps the config, the plan, the seed output and the skills`,
}[stack];
// On a migration preview the links and `siteId` are the PARENT's — the site whose content the pages
// show and whose dashboard manages it; `deploySiteId` is where `wix release` goes.
emit("ready_for_brand_layer", {
  mode,
  stack,
  projectDir,
  siteId: ctx ? ctx.content.siteId : siteId,
  ...(ctx ? { deploySiteId: ctx.deploy.siteId, migration: { parentSiteId: ctx.migration.parentSiteId } } : {}),
  dashboardUrl: deployResult.dashboardUrl,
  productsUrl: deployResult.productsUrl,
  categoriesUrl: deployResult.categoriesUrl,
  install,
  seed,
  next:
    (mode === "migrate"
      ? "a migration preview: the site being migrated owns its content (read it with the vertical's read-site.mjs when the brief allows probing; never seed it); theme + write the home page; "
      : planPath
      ? "theme + write the home page; "
      : "the site is new and empty — seed it (a plan per step 2, the vertical's seed module) or say so; theme + write the home page; ") +
    (install || seed ? "then wait for the done markers" + (seed ? ", verify .seed-exit is 0 (else read seed.log and re-run the seed module)" : "") + "; " : "") +
    `then ${release}` +
    (mode === "migrate" ? "; the release is the PREVIEW on the deploy site — close with its URL and the parent's dashboard, say the original site is unchanged and that completing the migration is the user's next step in the Wix CLI once they approve" : ""),
});
