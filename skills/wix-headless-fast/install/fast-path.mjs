// Fast path — one deterministic call from "the folder and the brief" to "brand layer can start".
// The FOLDER decides what happens; there is no create/connect switch:
//
//   node <SKILL_ROOT>/install/fast-path.mjs --vertical <storefront|bookings|…> \
//        [--plan plan.json] [--business-name "<Brand>"] [--stack astro|react|lib|static] \
//        [--subfolder [--folder-name <npm-safe-name>]]
//
//   - the current directory holds `wix.config.json` AND code this skill deployed → refuses: the
//     project is built here; a later prompt iterates on it (deploy.mjs adds a solution).
//   - `wix.config.json` but none of this skill's code (a Wix project made by hand or by the CLI)
//     → CONNECT: no init, the site is the one in the config; deploy into the project as it is.
//   - a project but no `wix.config.json` (a package.json, or an index.html at the root) → CONNECT:
//     `npm create @wix/new@latest init` in place creates the site and the config, then deploy.
//   - none of the above (empty, or loose files such as a CSV or a brief) → CREATE: scaffold the Wix
//     CLI's Astro template and place it in the current directory (`--business-name` required).
//
// The script reads file markers only (wix.config.json, this skill's deployed folder, a package.json
// or index.html); everything else is the agent's call: when connecting, `--stack` is required and
// comes from SKILL.md step 1, and what the project needs for that stack on Wix hosting is prose
// there, not detection here. The seed runs only when `--plan` is given: a site that already has its
// content, or a brief that has not supplied any, gets no seed.
//
// Composes pieces that also remain individually runnable (deploy.mjs, the vertical's seed module)
// to recover one failed step. Emits ONE JSON event per line and exits in ~35s with the two long
// steps — the dependency install and the seed — running detached in the background (logs and
// completion markers in the final event), so the caller can build the brand layer while they finish.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CONFIG_FILES, writeAgentsMd } from "./agents-md.mjs";

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
const knownVerticals = readdirSync(join(SKILL_ROOT, "references"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "shared" && existsSync(join(SKILL_ROOT, "references", d.name, "app")))
  .map((d) => d.name);
const usage = `usage: fast-path.mjs --vertical <${knownVerticals.join("|")}> [--plan plan.json] [--business-name "<Brand>"] [--stack astro|react|lib|static] [--subfolder]`;
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
const hasConfig = has("wix.config.json");
const hasOurCode = has("src/wix") || has("js/wix");
const pkg = has("package.json") ? JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) : null;
const hasProject = !!pkg || has("index.html");

if (hasConfig && hasOurCode) {
  fail("place", "this folder already holds a Wix project with this skill's code deployed (wix.config.json and src/wix/ or js/wix/): nothing to create or connect. To add a solution: deploy.mjs <vertical> from here. To change what is built: edit the files and release");
}
const mode = hasConfig || hasProject ? "connect" : "create";
if (mode === "connect" && !stackFlag) {
  fail("args", "connecting a project on disk needs --stack astro|react|lib|static — the stack you resolved in SKILL.md step 1 for this project");
}
const stack = stackFlag ?? "astro";
emit("folder", { mode, stack, hasConfig, project: hasProject ? (pkg?.name ?? basename(cwd)) : null });

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
    emit("scaffolding", { folder: folderName });
    const scaffold = spawnSync(
      "npm",
      // --skip-git: this wrapper composes its own steps and leaves version control to
      // the caller / the enclosing repo; the scaffold's own `git init` + "Initial
      // commit" is noise here, and becomes a nested-repo (submodule gitlink) hazard
      // if the project is later placed inside an existing repo. --skip-install for the
      // same reason: deps install in a detached step below.
      ["create", "@wix/new@latest", "--", "headless",
       "--folder-name", folderName, "--business-name", businessName,
       "--site-template", "--skip-install", "--skip-git", "--no-publish"],
      { env: { ...process.env, CI: "1" }, encoding: "utf8", timeout: 300_000 },
    );
    if (scaffold.status !== 0 || !existsSync(join(projectDir, "wix.config.json"))) {
      fail("scaffold", (scaffold.stderr || scaffold.stdout || "scaffold produced no wix.config.json — is the Wix CLI logged in? (npx @wix/cli@latest whoami)").slice(-600));
    }
  }
} else if (!hasConfig) {
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
emit(mode === "create" ? "scaffolded" : "connected", { folder: folderName ?? cwd, siteId, stack, init: mode === "connect" && !hasConfig });

// ---- 2 · deploy shipped code + deps + lockfile ---------------------------------------------------
const deploy = spawnSync(
  "node",
  [join(SKILL_ROOT, "install", "deploy.mjs"), vertical, "--stack", stack, ...(planPath ? ["--plan", resolve(planPath)] : [])],
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
emit("agent_configs", writeAgentsMd(projectDir, { skill: basename(SKILL_ROOT), stack }));

// ---- 3 · start the dependency install, detached --------------------------------------------------
// ONE install, here, for any project with a package.json (deploy patched it). The static stack has
// no package.json and nothing to install.
let install = null;
if (stack !== "static" && existsSync(join(projectDir, "package.json"))) {
  const installLog = join(projectDir, "npm-install.log");
  const logFd = openSync(installLog, "a");
  const child = spawn("sh", ["-c", "npm ci --ignore-scripts || npm install --ignore-scripts"], {
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
if (planPath) {
  const seedDir = join(SKILL_ROOT, "references", vertical, "seed");
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
  static: "npx @wix/cli@latest release — no build; wix.config.json site.outputDirectory points at the folder the pages live in",
}[stack];
emit("ready_for_brand_layer", {
  mode,
  stack,
  projectDir,
  siteId,
  dashboardUrl: deployResult.dashboardUrl,
  productsUrl: deployResult.productsUrl,
  categoriesUrl: deployResult.categoriesUrl,
  install,
  seed,
  next:
    (mode === "connect" && hasConfig && !planPath
      ? "get the measure of the site before designing (SKILL.md step 3); "
      : planPath
      ? "theme + write the home page; "
      : "the site is new and empty — seed it (a plan per step 2, the vertical's seed module) or say so; theme + write the home page; ") +
    (install || seed ? "then wait for the done markers" + (seed ? ", verify .seed-exit is 0 (else read seed.log and re-run the seed module)" : "") + "; " : "") +
    `then ${release}`,
});
