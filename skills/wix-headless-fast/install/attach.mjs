// Attach a NEW headless frontend to an EXISTING Wix site — setup's sibling for a site that already
// exists (named in the prompt by its id). `init`/`wix create` cannot do this: they always create
// a site. This script does what they do AFTER creating one — OAuth app, managed hosting, env
// vars, `wix.config.json` — against the site id given, then scaffolds and deploys like
// setup.mjs. Nothing on the site is created, changed or deleted; there is no seed step.
//
//   node <SKILL_ROOT>/install/attach.mjs [--site <metaSiteId>] --business-name "<Brand>" \
//        --vertical <a>[,<b>…] [--stack astro|react|lib|static] [--subfolder [--folder-name <name>]]
//
// --site           the site. May be omitted when the folder holds a wix.config.json: then it is
//                  the site in that config (what `init` left behind in an empty folder).
// --business-name  the site's name (names the folder, the hosting slug and the app project).
// --vertical       which shipped code deploys (no seed runs — the site owns its content). Both are
//                  the caller's decision, read off the site before calling this (SKILL.md step 3).
// --stack          astro (default) in a folder without a project: scaffolds the CLI's blank Astro
//                  template with the hosting adapter. react|static there: writes wix.config.json
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
// ready_for_brand_layer, or error). Requires a logged-in Wix CLI (`npx @wix/cli@latest whoami`)
// whose account owns or co-manages the site.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAgentsMd } from "./agents-md.mjs";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANAGE = "https://manage.wix.com";
const HEADLESS_PROJECT_TYPE_ID = "eb363dea-85a0-4159-9b05-949542be5079";
const TEMPLATES_REPO = "https://github.com/wix/headless-templates.git";
const TEMPLATE_PATH = "astro/blank";

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
const subfolder = argv.includes("--subfolder");
// ---- the folder ---------------------------------------------------------------------------------
const cwd = process.cwd();
const has = (p) => existsSync(join(cwd, p));
const cwdConfig = has("wix.config.json") ? JSON.parse(readFileSync(join(cwd, "wix.config.json"), "utf8")) : null;
const hasProject = has("package.json") || has("index.html");
const siteId = flag("site") ?? cwdConfig?.siteId ?? cwdConfig?.projectId ?? null;
const stack = stackFlag ?? "astro";
const knownVerticals = readdirSync(join(SKILL_ROOT, "references"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "shared" && existsSync(join(SKILL_ROOT, "references", d.name, "app")))
  .map((d) => d.name);
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
const mode = !subfolder && hasProject ? "link" : "scaffold";
emit("folder", { mode, stack, project: hasProject, config: cwdConfig ? "same site" : null });

// ---- http ---------------------------------------------------------------------------------------
const cliToken = (site) => {
  const r = spawnSync("npx", ["-y", "@wix/cli@latest", "token", ...(site ? ["--site", site] : [])], { encoding: "utf8", timeout: 120_000 });
  const t = (r.stdout || "").trim();
  if (r.status !== 0 || !t) fail("auth", (r.stderr || r.stdout || "no token — is the Wix CLI logged in? (npx @wix/cli@latest whoami)").slice(-400));
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
let appId, appProject, instanceId, secrets, hosting = "created";
try {
  const comp = await call(MANAGE, "/_api/companion-apps/v1/companion-apps/get-or-create", { ...opts, body: {} });
  appId = comp.companionApp?.id;
  if (!appId) throw new Error("get-or-create returned no companion app id");
  const slug = folderName;
  try { appProject = (await call(MANAGE, `/_api/wix-code-app-projects/v1/app-projects/${appId}`, { ...opts, method: "GET" })).appProject; } catch { appProject = null; }
  if (appProject) {
    hosting = "reused";
  } else {
    try { await call(MANAGE, `/apps-service/v1/apps/${appId}/set-namespace`, { ...opts, method: "PATCH", body: { appId, appName: businessName, namespace: slug } }); }
    catch (e) { emit("note", { step: "set-namespace", detail: String(e.message).slice(0, 200) }); }
  }
  try {
    const inst = await call(MANAGE, "/apps-installer-service/v1/app-instance/install", { ...opts, body: { tenant: { id: siteId, tenantType: "SITE" }, appInstance: { appDefId: appId, version: "latest" } } });
    instanceId = inst.appInstance?.id;
  } catch (e) { emit("note", { step: "install", detail: String(e.message).slice(0, 200) }); }
  secrets = (await call(MANAGE, `/apps-service/v1/apps/${appId}`, { ...opts, method: "GET", query: { withSecrets: true } })).app?.appSecrets;
  if (!secrets?.appSecret) throw new Error("app secrets unavailable for this app");
  if (!appProject) {
    appProject = (await call(MANAGE, "/_api/wix-code-app-projects/v1/app-projects", { ...opts, body: { appProject: { id: appId, displayName: businessName.slice(0, 50), slug, appProjectTypeId: HEADLESS_PROJECT_TYPE_ID } } })).appProject;
  }
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
} catch (e) {
  fail("attach", e?.message || e);
}
const baseUrl = String(appProject.baseUrl).replace(/\/$/, "");
emit("attached", { siteId, appId, baseUrl, hosting, note: hosting === "reused" ? "this site already has a headless frontend at baseUrl; `wix release` from this project replaces it" : undefined });

// ---- 2 · scaffold (only where there is no project) -------------------------------------------------
mkdirSync(projectDir, { recursive: true });
if (stack === "astro" && mode !== "link") {
  // The CLI's own blank template (what `wix create` copies), then what its extender adds: the
  // hosting adapter, React islands, the `wix` scripts. Pinned like a freshly created project.
  const tmp = mkdtempSync(join(tmpdir(), "wix-template-"));
  const clone = spawnSync("git", ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", TEMPLATES_REPO, tmp], { encoding: "utf8", timeout: 120_000 });
  if (clone.status !== 0) fail("scaffold", clone.stderr || "git clone of the template repo failed");
  const sparse = spawnSync("git", ["-C", tmp, "sparse-checkout", "set", TEMPLATE_PATH], { encoding: "utf8", timeout: 60_000 });
  if (sparse.status !== 0 || !existsSync(join(tmp, TEMPLATE_PATH, "package.json"))) fail("scaffold", sparse.stderr || `template ${TEMPLATE_PATH} not found in ${TEMPLATES_REPO}`);
  cpSync(join(tmp, TEMPLATE_PATH), projectDir, { recursive: true, force: false, errorOnExist: false });
  rmSync(tmp, { recursive: true, force: true });
  const pkgPath = join(projectDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = folderName;
  pkg.scripts = { astro: "astro", dev: "wix dev", build: "wix build", wix: "wix", preview: "wix preview", release: "wix release", generate: "wix generate", env: "wix env", skills: "wix skills" };
  pkg.devDependencies = {
    ...(pkg.devDependencies ?? {}),
    "@astrojs/react": "^4.3.0",
    "@types/react": "^18.3.1",
    "@types/react-dom": "^18.3.1",
    "@wix/cli": "^1.1.92",
    "@wix/astro-wix-hosting-adapter": "^2.0.0",
    react: "18.3.1",
    "react-dom": "18.3.1",
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  writeFileSync(join(projectDir, "astro.config.mjs"), `// @ts-check
import { defineConfig } from "astro/config";
import wix from "@wix/astro";
import wixPages from "@wix/astro-pages";
import react from "@astrojs/react";
import wixHostingAdapter from "@wix/astro-wix-hosting-adapter";

// https://astro.build/config
export default defineConfig({
  integrations: [wix(), wixPages(), react()],
  security: { checkOrigin: false },
  adapter: wixHostingAdapter(),
  image: { domains: ["static.wixstatic.com"] },
  output: "server",
});
`);
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
emit(mode === "link" ? "linked" : "scaffolded", { folder: folderName, stack, template: mode !== "link" && stack === "astro" ? `${TEMPLATES_REPO}#${TEMPLATE_PATH}` : null });
// the agent config files `wix create` writes (attach never runs the CLI's scaffold at all); fill-only
emit("agent_configs", writeAgentsMd(projectDir, { skill: basename(SKILL_ROOT), stack }));

if (mode !== "link" && stack !== "astro") {
  emit("ready", { projectDir, siteId, appId, baseUrl, hosting, stack, dashboardUrl: `https://manage.wix.com/dashboard/${siteId}`,
    next: `scaffold the ${stack} project in this folder per SKILL.md, then deploy.mjs <vertical…> --stack ${stack} (the client id is read from wix.config.json); no seed — the site owns its content` });
  process.exit(0);
}

// ---- 3 · deploy shipped code + deps + lockfile ---------------------------------------------------
let deployResult = {};
{
  const deploy = spawnSync("node", [join(SKILL_ROOT, "install", "deploy.mjs"), ...verticals, "--stack", stack], { cwd: projectDir, encoding: "utf8", timeout: 60_000 });
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
  const child = spawn("sh", ["-c", "npm ci --ignore-scripts || npm install --ignore-scripts"], { cwd: projectDir, detached: true, stdio: ["ignore", logFd, logFd] });
  child.unref();
  install = { log: installLog, doneMarker: "node_modules/.package-lock.json" };
  emit("install_started", install);
}

// ---- done ----------------------------------------------------------------------------------------
emit("ready_for_brand_layer", {
  projectDir,
  siteId,
  appId,
  baseUrl,
  hosting,
  verticals,
  dashboardUrl: `https://manage.wix.com/dashboard/${siteId}`,
  productsUrl: deployResult.productsUrl,
  categoriesUrl: deployResult.categoriesUrl,
  mode,
  stack,
  install,
  seed: null,
  next:
    "the site's content is live already — nothing to seed; get the measure of the site (SKILL.md step 3), theme + write the pages" +
    (mode === "link" ? "; make the project what its stack needs on Wix hosting (SKILL.md step 1)" : "") +
    (install ? "; wait for the install marker" : "") +
    "; then release as step 5 says for the stack",
});
