// Attach a NEW headless frontend to an EXISTING Wix site — setup's sibling for a site that already
// exists (named in the prompt by its id). `init`/`wix create` cannot do this: they always create
// a site. This script does what they do AFTER creating one — OAuth app, managed hosting, env
// vars, `wix.config.json` — against the site id given, then scaffolds and deploys like
// setup.mjs. Nothing on the site is changed or deleted. Seeding is the caller's decision: with
// --plan the first vertical's seed runs with it (additive, idempotent by name; what the site already
// held comes back as preexisting[]); without one nothing is seeded — the site owns its content.
//
//   node <SKILL_ROOT>/install/attach.mjs [--site <metaSiteId>] --business-name "<Brand>" \
//        --vertical <a>[,<b>…] [--plan plan.json] [--stack astro|react|lib|static] [--hosting wix|self [--origin <url>[,<url>]]] \
//        [--subfolder [--folder-name <name>]]
//
// --plan           the content to seed, per the vertical's SEED.md — given when the brief supplies or
//                  describes content (SKILL.md step 2). Also carries plan.capabilities (mediaUpload,
//                  siteSearch) into deploy. Without it: no seed, and no capabilities.
//
// --hosting        wix (default): the frontend releases to Wix hosting — the site's app project is
//                  created or reused and `wix release` uploads to its *.wix-site-host.com address.
//                  self: the frontend is hosted elsewhere (Vercel, a Flask server, …): no app
//                  project, no Wix address, no Astro template; the OAuth app, wix.config.json and
//                  .env.local are still set up, the code deploys for --stack, and the origins given
//                  in --origin go on the OAuth app's redirect allow-list, which is what a Wix-hosted
//                  flow (checkout) needs to return to a frontend on another host.
//
// --site           the site. May be omitted when the folder holds a wix.config.json: then it is
//                  the site in that config (what `init` left behind in an empty folder).
// --business-name  the site's name (names the folder, the hosting slug and the app project).
// --vertical       which shipped code deploys, and whose seed runs with --plan (the first one). Both
//                  are the caller's decision, read off the site before calling this (SKILL.md step 3).
// --stack          astro (default) in a folder without a project: copies the first vertical's
//                  composed template (templates/<vertical>/project). react|static there: writes wix.config.json
//                  and stops — the caller scaffolds (Vite / plain HTML) per SKILL.md. In a folder
//                  that holds a project, --stack is required and nothing is scaffolded.
//
// The FOLDER decides, on file markers only:
//   - a project (package.json or index.html) AND wix.config.json → refuses: a Wix project with a
//     frontend already; deploy.mjs adds a solution to it.
//   - a project, no config → LINK: the hosting calls, then wix.config.json and .env.local are
//     written into the project as it is, the shipped code deploys for --stack, the install starts.
//   - no project (empty, or only a config for this same site) → the scaffold path above.
//   - a config naming a different site → refuses: never re-point a folder; use --subfolder.
// The project lives in the CURRENT DIRECTORY — the folder that already holds the installed skills —
// so it is self-contained. `--subfolder` (opt-in) creates it in a new folder named after the
// business instead.
//
// Emits ONE JSON event per line (attached, scaffolded, deployed, install_started,
// ready_for_brand_layer, or error). Requires a logged-in Wix CLI (`npx @wix/cli@<pinned> whoami`, the version in pins.json)
// whose account owns or co-manages the site.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAgentsMd } from "./agents-md.mjs";
import { frontendPresent, siteContext } from "./context.mjs";
import { listVerticals, templatesDir } from "./templates.mjs";
const PINS = JSON.parse(readFileSync(new URL("./pins.json", import.meta.url), "utf8"));
const WIX_CLI = `@wix/cli@${PINS["@wix/cli"]}`;

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANAGE = "https://manage.wix.com";
const API = "https://www.wixapis.com";
const HEADLESS_PROJECT_TYPE_ID = "eb363dea-85a0-4159-9b05-949542be5079";
// The shipped code: the repository's templates/ (a checkout, the cache, or fetched now, in a second).
let TEMPLATES;
try { TEMPLATES = templatesDir(); } catch (e) { fail("templates", e.message); }

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
const stackFlag = flag("stack");
const planPath = flag("plan");
if (planPath && !existsSync(resolve(planPath))) fail("args", `--plan ${planPath}: no such file`);
const hosting0 = flag("hosting") ?? "wix";
const origins = (flag("origin") ?? "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
const subfolder = argv.includes("--subfolder");
// ---- the folder ---------------------------------------------------------------------------------
const cwd = process.cwd();
const has = (p) => existsSync(join(cwd, p));
const cwdConfig = has("wix.config.json") ? JSON.parse(readFileSync(join(cwd, "wix.config.json"), "utf8")) : null;
// A frontend here: a package.json, an index.html at the root, or an index.html in the folder the
// config's site.outputDirectory names (a static site laid out for release) — install/context.mjs.
const fp = frontendPresent(cwd);
const hasProject = fp.packageJson || fp.rootIndex || fp.outputIndex;
// A migration preview (wix.config.json names a deploy-only site, .env.local names the site being
// migrated) is already provisioned: its app, hosting and credentials came with the folder. Nothing
// here applies — setup.mjs takes it (SKILL.md step 3).
if (cwdConfig) {
  const ctx = siteContext({ cwd });
  if (ctx.migration.active) {
    fail("place", `this folder deploys a migration preview of site ${ctx.migration.parentSiteId} (deploy site ${ctx.deploy.siteId}): the app and hosting are provisioned already — run setup.mjs --vertical <vertical> [--stack <stack>] here instead; nothing is attached or re-pointed`);
  }
}
const siteId = flag("site") ?? cwdConfig?.siteId ?? cwdConfig?.projectId ?? null;
// Where the site came from decides the seed (SKILL.md step 3). A config in this folder for this site
// is what `init` leaves behind, and `init` always creates a site: that site was made for this run and
// is empty. A site named with --site (and not already this folder's) existed before the run.
const siteOrigin = cwdConfig && (cwdConfig.siteId === siteId || cwdConfig.projectId === siteId) ? "init" : "given";
const stack = stackFlag ?? "astro";
const knownVerticals = listVerticals(TEMPLATES);
const verticals = argv
  .flatMap((a, i) => (a === "--vertical" && argv[i + 1] ? argv[i + 1].split(",") : []))
  .map((v) => v.trim())
  .filter(Boolean);
const businessName = flag("business-name");
if (!siteId || !/^[0-9a-f-]{36}$/i.test(siteId) || !businessName || !verticals.length) {
  fail("args", `usage: attach.mjs [--site <metaSiteId>] --business-name "<Brand>" --vertical <${knownVerticals.join("|")}>[,…] [--stack astro|react|lib|static] (--site may be omitted when wix.config.json is here)`);
}
for (const v of verticals) if (!knownVerticals.includes(v)) fail("args", `unknown vertical "${v}" — shipped verticals: ${knownVerticals.join(", ")}`);
if (!["astro", "react", "lib", "static"].includes(stack)) fail("args", `unknown stack "${stack}" — astro, react, lib or static`);
if (!["wix", "self"].includes(hosting0)) fail("args", `unknown --hosting "${hosting0}" — wix or self`);
for (const o of origins) if (!/^https?:\/\/[^/\s]+$/.test(o)) fail("args", `--origin must be a scheme and host such as https://shop.example.com or http://localhost:8000, got "${o}"`);
if (hosting0 === "self" && stack === "astro" && !hasProject && !stackFlag) {
  fail("args", "--hosting self scaffolds nothing: pass --stack for the frontend you will host (react|lib|static), or attach from inside the project on disk");
}
if (!subfolder) {
  if (hasProject && cwdConfig) {
    fail("place", "this folder is already a Wix project with a frontend (wix.config.json and a project): nothing to attach. deploy.mjs <vertical> adds this skill's code or a solution to it; then ONE npm install");
  }
  if (cwdConfig && (cwdConfig.siteId ?? cwdConfig.projectId) !== siteId) {
    fail("place", `this folder is attached to site ${cwdConfig.siteId ?? cwdConfig.projectId}, not ${siteId} — a folder is never re-pointed; attach the other site with --subfolder`);
  }
  if (hasProject && !stackFlag) {
    fail("args", "attaching a project on disk needs --stack astro|react|lib|static — the stack you resolved in SKILL.md step 1 for this project");
  }
}
const mode = !subfolder && hasProject ? "link" : hosting0 === "self" ? "config-only" : "scaffold";
emit("folder", { mode, stack, hosting: hosting0, project: hasProject, config: cwdConfig ? "same site" : null, siteOrigin });

// ---- http ---------------------------------------------------------------------------------------
const cliToken = (site) => {
  const r = spawnSync("npx", ["-y", WIX_CLI, "token", ...(site ? ["--site", site] : [])], { encoding: "utf8", timeout: 120_000 });
  const t = (r.stdout || "").trim();
  if (r.status !== 0 || !t) fail("auth", (r.stderr || r.stdout || `no token — is the Wix CLI logged in? (npx ${WIX_CLI} whoami)`).slice(-400));
  return t;
};
async function call(base, path, { method = "POST", token, site, body, query } = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "X-XSRF-TOKEN": "nocheck",
      Cookie: "XSRF-TOKEN=nocheck",
      "User-Agent": "wix-cli",
      ...(site ? { "wix-site-id": site } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.pathname} ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

const folderName = flag("folder-name") ?? (businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site");
const projectDir = subfolder ? resolve(cwd, folderName) : cwd;
if (subfolder && existsSync(join(projectDir, "wix.config.json"))) fail("args", `${folderName}/ is already a Wix project — pick --folder-name, or run deploy.mjs there`);

// ---- 1 · attach: OAuth app + hosting + env, on the manage host with a site token -----------------
// The same calls `init` makes after it has created a site, in the same order.
const siteToken = cliToken(siteId);
const opts = { token: siteToken, site: siteId };
let appId, appProject = null, instanceId, secrets, hosting = hosting0 === "self" ? "self" : "created";
try {
  const comp = await call(MANAGE, "/_api/companion-apps/v1/companion-apps/get-or-create", { ...opts, body: {} });
  appId = comp.companionApp?.id;
  if (!appId) throw new Error("get-or-create returned no companion app id");
  const slug = folderName;
  if (hosting0 === "wix") {
    try { appProject = (await call(MANAGE, `/_api/wix-code-app-projects/v1/app-projects/${appId}`, { ...opts, method: "GET" })).appProject; } catch { appProject = null; }
    if (appProject) {
      hosting = "reused";
    } else {
      try { await call(MANAGE, `/apps-service/v1/apps/${appId}/set-namespace`, { ...opts, method: "PATCH", body: { appId, appName: businessName, namespace: slug } }); }
      catch (e) { emit("note", { step: "set-namespace", detail: String(e.message).slice(0, 200) }); }
    }
  }
  try {
    const inst = await call(MANAGE, "/apps-installer-service/v1/app-instance/install", { ...opts, body: { tenant: { id: siteId, tenantType: "SITE" }, appInstance: { appDefId: appId, version: "latest" } } });
    instanceId = inst.appInstance?.id;
  } catch (e) { emit("note", { step: "install", detail: String(e.message).slice(0, 200) }); }
  secrets = (await call(MANAGE, `/apps-service/v1/apps/${appId}`, { ...opts, method: "GET", query: { withSecrets: true } })).app?.appSecrets;
  if (!secrets?.appSecret) throw new Error("app secrets unavailable for this app");
  if (hosting0 === "self") {
    // No Wix hosting. The one thing a frontend on another host needs from the site: its origins on
    // the OAuth app's redirect allow-list, so checkout and the other Wix-hosted flows can return.
    // The public OAuth Apps API (wix-manage: Manage OAuth Apps), merged with what is already there.
    if (origins.length) {
      const current = (await call(API, `/oauth-app/v1/oauth-apps/${appId}`, { ...opts, method: "GET" })).oAuthApp ?? {};
      const merged = [...new Set([...(current.allowedRedirectDomains ?? []), ...origins])];
      await call(API, `/oauth-app/v1/oauth-apps/${appId}`, { ...opts, method: "PATCH", body: { oAuthApp: { allowedRedirectDomains: merged }, mask: { paths: ["allowedRedirectDomains"] } } });
      emit("origins_allowed", { appId, allowedRedirectDomains: merged });
    } else {
      emit("note", { step: "origins", detail: "no --origin given: add the frontend's origins to the OAuth app's allowedRedirectDomains (wix-manage: Manage OAuth Apps) before the first checkout test" });
    }
  }
  if (hosting0 === "wix" && !appProject) {
    appProject = (await call(MANAGE, "/_api/wix-code-app-projects/v1/app-projects", { ...opts, body: { appProject: { id: appId, displayName: businessName.slice(0, 50), slug, appProjectTypeId: HEADLESS_PROJECT_TYPE_ID } } })).appProject;
  }
  if (hosting0 === "wix") {
  if (!appProject?.baseUrl) throw new Error("app project has no baseUrl");
  const prod = String(appProject.baseUrl).replace(/\/$/, "");
  const host = new URL(appProject.baseUrl).hostname;
  const local = "http://localhost:4321";
  await call(MANAGE, `/oauth-app-service/v1/oauth-apps/${appId}`, { ...opts, method: "PATCH", body: {
    oAuthApp: {
      id: appId,
      allowedDomains: [local, `https://(.*)-${host}`, prod],
      allowedRedirectUris: [`${local}/api/auth/callback`, `${local}/api/auth/logout-callback`, `https://*-${host}/api/auth/callback`, `https://*-${host}/api/auth/logout-callback`, `${prod}/api/auth/callback`, `${prod}/api/auth/logout-callback`],
      redirectUrlWixPages: prod,
      origin: "other",
    },
    mask: { paths: ["allowedDomains", "allowedRedirectUris", "redirectUrlWixPages", "origin"] },
  } });
  if (!instanceId) {
    // reused app: the instance id is on the existing env, keep it
    try {
      const env = await call(MANAGE, `/_api/wix-code-app-environments/v2/app-projects/${appProject.id}/app-environment-variables`, { ...opts, method: "GET", query: { environment: "system_global" } });
      instanceId = (env.appEnvironmentVariables ?? []).find((v) => v.key === "WIX_CLIENT_INSTANCE_ID")?.value ?? null;
    } catch { /* fall through */ }
  }
  const variables = { WIX_CLIENT_ID: appId, WIX_CLIENT_SECRET: secrets.appSecret, WIX_CLIENT_PUBLIC_KEY: secrets.webhookPublicKey, ...(instanceId ? { WIX_CLIENT_INSTANCE_ID: instanceId } : {}) };
  await call(MANAGE, `/_api/wix-code-app-environments/v2/bulk/app-projects/${appProject.id}/app-environment-variables/upsert`, { ...opts, body: {
    appProjectId: appProject.id, environment: "system_global", mutability: "STATIC", returnEntity: true, returnAllEnvironment: true, variables,
  } });
  }
} catch (e) {
  fail("attach", e?.message || e);
}
const baseUrl = appProject ? String(appProject.baseUrl).replace(/\/$/, "") : null;
// Is a frontend serving at that address? The hosting project says nothing about it (init and the
// provisioning call create one with nothing behind it). The site's release slots do: the release
// with slug `prod` is production traffic and names the deployment it serves — the same read the
// headless back office makes for its frontend status. Absent means nothing was ever released.
// Deployments keep their own addresses, so a replaced one is not lost; prod can be pointed back.
// A folder that reaches this point is not the one that released (a linked project never runs
// attach), so a `prod` release here means a NEW project is about to take over a live frontend.
let frontend = null;
if (appProject) {
  try {
    const r = await call(MANAGE, `/_api/wix-code-app-releases/v1/app-projects/${appProject.id}/app-releases/query`, { ...opts, body: { query: { cursorPaging: { limit: 20 } } } });
    const prod = (r.appReleases ?? []).find((x) => x.releaseSlug === "prod");
    frontend = prod
      ? { serving: true, releasedAt: prod.updatedDate ?? prod.createdDate ?? null, deploymentId: prod.appDeploymentId ?? null }
      : { serving: false };
  } catch (e) {
    emit("note", { step: "releases", detail: String(e.message).slice(0, 200) });
    frontend = { serving: null };
  }
}
const note =
  hosting === "self" ? "no Wix hosting: the frontend is yours to host; its origins must be on the OAuth app's allow-list"
  : frontend?.serving === true
    ? `a frontend is SERVING at ${baseUrl}, released ${frontend.releasedAt}. This is a new project: a \`wix release\` from here replaces it (the current deployment keeps its own address and prod can be pointed back). Tell the user before releasing; unless the brief asked for a new frontend, ask.`
  : frontend?.serving === false
    ? `${hosting === "created" ? "hosting created" : "hosting exists"} at ${baseUrl}; nothing served yet — the first release from this project fills it`
  : frontend
    ? `could not read whether a frontend is serving at ${baseUrl}; check the address before releasing`
    : undefined;
emit("attached", { siteId, appId, baseUrl, hosting, frontend, origins: hosting0 === "self" ? origins : undefined, note });

// ---- 2 · scaffold (only where there is no project) -------------------------------------------------
mkdirSync(projectDir, { recursive: true });
if (stack === "astro" && mode === "scaffold") {
  // The first vertical's composed template: the CLI's blank scaffold with the vertical deployed
  // and its lockfile, the same folder `wix create --template-path` copies for a new site. Copied
  // here because the CLI's create makes a new site and this folder gets an existing one. Further
  // verticals are deployed below.
  cpSync(join(templatesDir({ need: `${verticals[0]}/project` }), verticals[0], "project"), projectDir, { recursive: true, force: false, errorOnExist: false });
  const pkgPath = join(projectDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = folderName;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  const gi = join(projectDir, ".gitignore");
  const cur = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!/\.env/.test(cur)) writeFileSync(gi, cur + "\n# local env (pulled from Wix)\n.env.local\n.env\n");
}
writeFileSync(join(projectDir, "wix.config.json"), JSON.stringify({ appId, siteId }, null, 2) + "\n");
// The env the CLI's build reads. Same content `wix env pull` writes; written here so the build
// needs no extra call.
const quote = (v) => `"${String(v ?? "").replace(/"/g, '\\"')}"`;
writeFileSync(join(projectDir, ".env.local"), [
  `WIX_CLOUD_PROVIDER=${quote("wix")}`,
  `WIX_CLIENT_ID=${quote(appId)}`,
  ...(instanceId ? [`WIX_CLIENT_INSTANCE_ID=${quote(instanceId)}`] : []),
  `WIX_CLIENT_PUBLIC_KEY=${quote(secrets.webhookPublicKey)}`,
  `WIX_CLIENT_SECRET=${quote(secrets.appSecret)}`,
  "",
].join("\n"));
emit(mode === "link" ? "linked" : mode === "config-only" ? "configured" : "scaffolded", { folder: folderName, stack, template: mode === "scaffold" && stack === "astro" ? join(TEMPLATES, verticals[0], "project") : null });
// the agent config files `wix create` writes (attach never runs the CLI's scaffold at all); fill-only
emit("agent_configs", writeAgentsMd(projectDir, { skill: basename(SKILL_ROOT), stack }));

if (mode !== "link" && (stack !== "astro" || mode === "config-only")) {
  emit("ready", { projectDir, siteId, appId, baseUrl, hosting, frontend, stack, dashboardUrl: `https://manage.wix.com/dashboard/${siteId}`,
    next: `scaffold the ${stack} project in this folder per SKILL.md, then deploy.mjs <vertical…> --stack ${stack}${planPath ? ` --plan ${planPath}` : ""} (the client id is read from wix.config.json); ` +
      (planPath ? `then seed with the plan: node <SKILL_ROOT>/templates/${verticals[0]}/seed/seed-<vertical>.mjs ${planPath}` : `no plan given, so nothing seeds — the site owns its content`) +
      (hosting === "self" ? `; you host it: origins on the OAuth app allow-list now: ${origins.join(", ") || "none — add them before the first checkout test"}` : "") });
  process.exit(0);
}

// ---- 3 · deploy shipped code + deps (adds nothing to a scaffold from the template) --------------
let deployResult = {};
{
  const deploy = spawnSync("node", [join(SKILL_ROOT, "install", "deploy.mjs"), ...verticals, "--stack", stack, ...(planPath ? ["--plan", resolve(planPath)] : [])], { cwd: projectDir, encoding: "utf8", timeout: 60_000 });
  if (deploy.status !== 0) fail("deploy", deploy.stderr || deploy.stdout);
  try { deployResult = JSON.parse(deploy.stdout); } catch { /* keep going */ }
  if (deployResult.error) fail("deploy", deployResult.error);
  emit("deployed", deployResult);
}

// ---- 4 · dependency install, detached (any project with a package.json) --------------------------
let install = null;
if (existsSync(join(projectDir, "package.json"))) {
  const installLog = join(projectDir, "npm-install.log");
  const logFd = openSync(installLog, "a");
  const child = spawn("sh", ["-c", existsSync(join(projectDir, "package-lock.json")) ? "npm ci --ignore-scripts || npm install --ignore-scripts" : "npm install --ignore-scripts"], { cwd: projectDir, detached: true, stdio: ["ignore", logFd, logFd] });
  child.unref();
  install = { log: installLog, doneMarker: "node_modules/.package-lock.json" };
  emit("install_started", install);
}

// ---- 5 · the seed, detached, only with --plan ------------------------------------------------------
// The site existed before this run, so content goes in only when the caller says so (the brief
// supplied or described it). Same shape as setup: result JSON + exit marker, synced on before release.
// Seeds are additive and idempotent by name; what the site already held is reported, never touched.
let seed = null;
if (planPath) {
  const seedDir = join(TEMPLATES, verticals[0], "seed");
  const seedName = existsSync(seedDir) ? readdirSync(seedDir).find((f) => f.startsWith("seed-") && f.endsWith(".mjs")) : undefined;
  if (!seedName) fail("seed", `no seed module found under ${seedDir}`);
  const seedChild = spawn(
    "sh",
    ["-c", `node "${join(seedDir, seedName)}" "${resolve(planPath)}" > seed-result.json 2> seed.log; echo $? > .seed-exit`],
    { cwd: projectDir, detached: true, stdio: "ignore" },
  );
  seedChild.unref();
  seed = { resultFile: "seed-result.json", log: "seed.log", doneMarker: ".seed-exit", success: "file contains 0" };
  emit("seeding_started", { vertical: verticals[0], ...seed, ...(verticals.length > 1 ? { note: `the plan seeds ${verticals[0]}; the other verticals' seeds run afterwards, each with its own plan` } : {}) });
} else {
  if (siteOrigin === "init") {
    emit("note", { step: "seed", detail: `this site was made for this run (init) and is empty: draft a plan per templates/${verticals[0]}/seed/SEED.md — the brief's content, else demo content — and run node <SKILL_ROOT>/templates/${verticals[0]}/seed/seed-<vertical>.mjs plan.json from the project root` });
  }
  if (verticals.includes("members")) {
    emit("note", { step: "seed", detail: "members: the Members Area app (the profile layer, no content) is installed by templates/members/seed/seed-members.mjs — run it unless the site already has the app" });
  }
}

// ---- done ----------------------------------------------------------------------------------------
emit("ready_for_brand_layer", {
  projectDir,
  siteId,
  appId,
  baseUrl,
  hosting,
  frontend,
  verticals,
  dashboardUrl: `https://manage.wix.com/dashboard/${siteId}`,
  productsUrl: deployResult.productsUrl,
  categoriesUrl: deployResult.categoriesUrl,
  mode,
  stack,
  install,
  seed,
  siteOrigin,
  next:
    (seed
      ? "the plan is seeding in the background (additive; the result's preexisting[] names what the site already held) — sync on .seed-exit before release; "
      : siteOrigin === "init"
        ? "no plan given and this site was made for this run (empty): draft a plan per SEED.md and run the vertical's seed before release; "
        : "no plan given, so nothing seeds — the site existed before this run and its content is its own; ") +
    "get the measure of the site (SKILL.md step 3), theme + write the pages" +
    (mode === "link" && hosting !== "self" ? "; make the project what its stack needs on Wix hosting (SKILL.md step 1)" : "") +
    (install ? "; wait for the install marker" : "") +
    (hosting === "self"
      ? `; you host it — no wix release; origins on the OAuth app allow-list now: ${origins.join(", ") || "none — add them before the first checkout test"}; add the public one when it goes live`
      : "; then release as step 5 says for the stack"),
});
