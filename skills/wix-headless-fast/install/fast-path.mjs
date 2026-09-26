// Fast path for a managed CREATE run — one deterministic call from "plan exists" to
// "brand layer can start". Composes the pieces that also remain individually runnable
// (deploy.mjs, the vertical's seed module); use those directly to recover a failed step,
// or for connect/iterate runs (which must NOT scaffold and don't use this script).
//
//   node <SKILL_ROOT>/install/fast-path.mjs --business-name "<Brand>" --plan plan.json \
//        --vertical <storefront|bookings|…> [--stack astro] [--subfolder [--folder-name <npm-safe-name>]]
//
// The project is created in the CURRENT DIRECTORY — the folder the entry had the agent work from,
// which already holds the installed skills (`.agents/skills/`), so the project is self-contained
// and a later session opened in it finds them. `--subfolder` (opt-in) leaves it in a new folder
// named after the business instead, for a current folder that must stay as it is.
//
// It emits ONE JSON event per line and exits in ~35s with BOTH long steps — the dependency
// install AND the seed — running detached in the background (logs + completion markers
// reported in the final event), so the caller can build the brand layer while they finish.
// Steps: scaffold (Wix CLI; requires a logged-in session) → deploy shipped code + deps +
// lockfile → start `npm ci || npm install` detached → start the seed detached.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeCliAgentsMd } from "./cli-agents-md.mjs";

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
const stack = flag("stack") ?? "astro";
// Opt-in: keep the project in a subfolder instead of the current directory.
const subfolder = argv.includes("--subfolder");
// --vertical is REQUIRED: a defaulted vertical deploys the wrong code and runs the wrong
// seed against the plan — fail loudly with the discovered choices instead.
const knownVerticals = readdirSync(join(SKILL_ROOT, "references"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "shared" && existsSync(join(SKILL_ROOT, "references", d.name, "app")))
  .map((d) => d.name);
if (!businessName || !planPath || !vertical) {
  fail("args", `usage: fast-path.mjs --business-name "<Brand>" --plan plan.json --vertical <${knownVerticals.join("|")}> [--stack astro]`);
}
if (!knownVerticals.includes(vertical)) {
  fail("args", `unknown vertical "${vertical}" — shipped verticals: ${knownVerticals.join(", ")}`);
}
if (!existsSync(planPath)) fail("args", `plan file not found: ${planPath}`);
const plan = JSON.parse(readFileSync(planPath, "utf8"));

const folderName =
  flag("folder-name") ??
  businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
// `let`: the Wix CLI can only scaffold into a subfolder; by default we then move the scaffold up
// into the current directory and repoint projectDir there, so the detached install/seed and every
// reported path use the final location.
let projectDir = resolve(process.cwd(), folderName);

// ---- 1 · scaffold -------------------------------------------------------------------------------
if (existsSync(join(process.cwd(), "wix.config.json"))) {
  fail("scaffold", "the current directory is already a Wix project — this script is for CREATE runs only; use deploy.mjs + the seed module directly");
}
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
const wixConfig = JSON.parse(readFileSync(join(projectDir, "wix.config.json"), "utf8"));
const siteId = wixConfig.siteId ?? wixConfig.projectId;
emit("scaffolded", { folder: folderName, siteId });

// ---- 2 · deploy shipped code + deps + lockfile ---------------------------------------------------
const deploy = spawnSync(
  "node",
  [
    join(SKILL_ROOT, "install", "deploy.mjs"),
    vertical,
    "--stack",
    stack,
    "--plan",
    resolve(planPath),
  ],
  { cwd: projectDir, encoding: "utf8", timeout: 60_000 },
);
if (deploy.status !== 0) fail("deploy", deploy.stderr || deploy.stdout);
let deployResult = {};
try { deployResult = JSON.parse(deploy.stdout); } catch { /* keep going with raw output below */ }
if (deployResult.error) fail("deploy", deployResult.error);
emit("deployed", deployResult);

// ---- 2c · place the project in the current directory --------------------------------------------
// The default. The Wix CLI scaffolds into a subfolder, so the scaffold is moved up into the current
// directory — the folder that already holds the installed skills — and the subfolder removed. Done
// HERE, before the detached install below, on purpose: no node_modules exists yet, so the move is
// instant and cannot collide with a running install. A pure move: the scaffold was created with
// --skip-git, so there is no nested repo to reconcile — git is whatever the folder already is.
// Refuses rather than overwrite: an entry that already exists in the current directory stops the
// move before anything is touched. `--subfolder` skips this step.
const targetDir = process.cwd();
if (!subfolder && projectDir !== targetDir) {
  const entries = readdirSync(projectDir);
  const clashes = entries.filter((e) => existsSync(join(targetDir, e)));
  if (clashes.length) {
    fail("place", `the current directory already has: ${clashes.join(", ")} — run with --subfolder to keep the project in ${folderName}/, or start in an empty folder`);
  }
  try {
    for (const entry of entries) renameSync(join(projectDir, entry), join(targetDir, entry));
    rmSync(projectDir, { recursive: true, force: true });
    projectDir = targetDir;
    emit("project_placed", { into: targetDir });
  } catch (e) {
    fail("place", e?.stack || e);
  }
}

// ---- 2d · the agent config files `wix create` would have written --------------------------------
// Skipped by the CLI because of --skip-install (see cli-agents-md.mjs). Written after the move so
// they land at the project root.
emit("agent_configs", { written: writeCliAgentsMd(projectDir) });

// ---- 3 · start the dependency install, detached --------------------------------------------------
const installLog = join(projectDir, "npm-install.log");
const logFd = openSync(installLog, "a");
const install = spawn("sh", ["-c", "npm ci --ignore-scripts || npm install --ignore-scripts"], {
  cwd: projectDir,
  detached: true,
  stdio: ["ignore", logFd, logFd],
});
install.unref();
emit("install_started", { log: installLog, doneMarker: "node_modules/.package-lock.json" });

// ---- 4 · start the seed, detached ----------------------------------------------------------------
// The seed includes a Wix-side provisioning wait of unpredictable length (10-80s); running it
// in the caller's foreground would idle the agent for exactly that long. Detach it like the
// install: result JSON + exit-code marker land as files the caller syncs on before release.
const seedDir = join(SKILL_ROOT, "references", vertical, "seed");
const seedName = existsSync(seedDir)
  ? readdirSync(seedDir).find((f) => f.startsWith("seed-") && f.endsWith(".mjs"))
  : undefined;
const seedFile = seedName ? join(seedDir, seedName) : null;
if (!seedFile) fail("seed", `no seed module found under ${seedDir}`);
const seedResultFile = join(projectDir, "seed-result.json");
const seedLog = join(projectDir, "seed.log");
const seedDoneMarker = join(projectDir, ".seed-exit");
const planAbs = resolve(planPath);
const seedChild = spawn(
  "sh",
  ["-c", `node "${seedFile}" "${planAbs}" > seed-result.json 2> seed.log; echo $? > .seed-exit`],
  { cwd: projectDir, detached: true, stdio: "ignore" },
);
seedChild.unref();
emit("seeding_started", { vertical, resultFile: seedResultFile, log: seedLog, doneMarker: seedDoneMarker });

// ---- done ----------------------------------------------------------------------------------------
emit("ready_for_brand_layer", {
  projectDir,
  siteId,
  dashboardUrl: deployResult.dashboardUrl,
  productsUrl: deployResult.productsUrl,
  categoriesUrl: deployResult.categoriesUrl,
  install: { log: installLog, doneMarker: "node_modules/.package-lock.json" },
  seed: { resultFile: "seed-result.json", log: "seed.log", doneMarker: ".seed-exit", success: "file contains 0" },
  next: "theme SiteLayout + write the home page; then wait for BOTH done markers, verify .seed-exit is 0 (else read seed.log and re-run the seed module), build, release",
});
