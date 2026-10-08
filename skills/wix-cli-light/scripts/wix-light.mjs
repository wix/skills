#!/usr/bin/env node
// `node wix-light.mjs <command> [flags]`. Every command finishes inside one call and prints one JSON
// object per line, in the Wix CLI's agent-mode vocabulary where the CLI has one.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { requestDeviceCode, exchangeDeviceCode, saveSession, session, accessToken } from "./lib/auth.mjs";
import { readPending, writePending, clearPending, ACCOUNT_FILE } from "./lib/state.mjs";
import { setCommandName } from "./lib/http.mjs";
import { readConfig, writeConfig, writeEnv, CONFIG, ENV_FILE } from "./lib/project.mjs";
import { getAppProject, createAppProject, getEnvironmentVariables, upsertEnvironmentVariables, deploy } from "./lib/hosting.mjs";
import { createSite, getOrCreateCompanionApp, setNamespace, installApp, getAppSecrets, configureOAuthApp, createComponentsOverride, release as releaseOverride, BACKEND_WORKER_COMPONENT_ID } from "./lib/devcenter.mjs";

const emit = (event, extra = {}) => process.stdout.write(JSON.stringify({ event, ...extra }) + "\n");
const fail = (event, extra = {}) => { emit(event, { ok: false, ...extra }); process.exit(1); };

const [, , command = "help", ...rest] = process.argv;
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) { positional.push(rest[i]); continue; }
  const key = rest[i].slice(2);
  const next = rest[i + 1];
  if (next === undefined || next.startsWith("--")) flags[key] = true; else { flags[key] = next; i++; }
}
const dir = () => resolve(flags.dir || process.cwd());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── login ─────────────────────────────────────────────────────────────────────────────────────
const awaiting = (p) => emit("awaiting_user", {
  userCode: p.userCode, verificationUri: p.verificationUri, expiresInSeconds: Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000)),
  message: `To connect your Wix account, open ${p.verificationUri} and enter the code ${p.userCode}. Then run this command again.`,
});

// Run 1 mints a code and returns; run 2, after the owner approved, exchanges it. `--wait <sec>`
// polls inside the call instead of returning; `--force` discards a pending code.
async function login() {
  const existing = await session();
  if (existing) { clearPending(); return emit("logged_in", { email: existing.userInfo.email, userId: existing.userInfo.userId, reused: true }); }
  let pending = flags.force ? null : readPending();
  if (pending && pending.expiresAt - Date.now() < 60_000) pending = null;
  if (!pending) {
    const d = await requestDeviceCode();
    pending = { deviceCode: d.deviceCode, userCode: d.userCode, verificationUri: d.verificationUri, expiresAt: Date.now() + d.expiresIn * 1000 };
    writePending(pending);
    awaiting(pending);
    if (!flags.wait) return;
  }
  const deadline = Date.now() + (flags.wait ? Number(flags.wait) * 1000 : 0);
  for (;;) {
    const tokens = await exchangeDeviceCode(pending.deviceCode);
    if (tokens) {
      const account = await saveSession(tokens);
      clearPending();
      return emit("logged_in", { email: account.userInfo.email, userId: account.userInfo.userId, file: ACCOUNT_FILE });
    }
    if (Date.now() >= deadline) return awaiting(pending);
    await sleep(3000);
  }
}

async function whoami() {
  const a = await session();
  if (!a) fail("login_required", { detail: "no Wix session: run `login`" });
  emit("logged_in", { email: a.userInfo.email, userId: a.userInfo.userId });
}

async function token() {
  const t = await accessToken(flags.site ? { siteId: flags.site } : {});
  if (flags.json) emit("token", { accessToken: t, ...(flags.site ? { siteId: flags.site } : {}) });
  else process.stdout.write(t + (process.stdout.isTTY ? "\n" : ""));
}

// ── env pull ──────────────────────────────────────────────────────────────────────────────────
async function env() {
  if (positional[0] && positional[0] !== "pull") fail("env_failed", { detail: `env ${positional[0]}: only pull is supported` });
  const d = dir();
  const config = readConfig(d);
  const t = await accessToken({ siteId: config.siteId });
  const variables = await getEnvironmentVariables(t, config.appId, "prod");
  const merged = writeEnv(d, variables);
  emit("env_pulled", { file: join(d, ENV_FILE), keys: Object.keys(variables), total: Object.keys(merged).length });
}

// ── init / create: a site, its app, its hosting project ───────────────────────────────────────
const startCase = (s) => s.replace(/[-_.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().replace(/\b\w/g, (c) => c.toUpperCase());
const slugOf = (name) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 10).replace(/-+$/, "");
  return `${base}-${randomBytes(4).toString("hex")}`;
};
const displayNameOf = (name) => (name.length > 50 ? `${name.slice(0, 47)}...` : name);

function validateBusinessName(name) {
  const n = (name || "").trim();
  if (!n || n.length > 255) fail("args", { detail: "--business-name: 1 to 255 characters" });
  if (/wix/i.test(n)) fail("args", { detail: "--business-name must not contain \"wix\"" });
  if (!/[a-z0-9]/i.test(n)) fail("args", { detail: "--business-name needs at least one letter or digit" });
  return n;
}

/** The CLI's provisioning sequence; returns `{ siteId, appId, baseUrl, variables }`. */
async function provision({ businessName, cloudProvider, siteTemplate }) {
  const account = await accessToken();
  const siteId = await createSite(account, { name: businessName, ...(siteTemplate ? { templateId: siteTemplate } : {}) });
  emit("site_created", { siteId });
  const site = await accessToken({ siteId });
  const appId = await getOrCreateCompanionApp(site);
  const slug = slugOf(businessName);
  await setNamespace(site, appId, slug);
  const instanceId = await installApp(site, siteId, appId);
  const secrets = await getAppSecrets(site, appId);
  const project = await createAppProject(site, { id: appId, displayName: displayNameOf(businessName), slug, cloudProvider });
  await configureOAuthApp(site, appId, project.baseUrl);
  const variables = await upsertEnvironmentVariables(site, project.id, "system_global", {
    WIX_CLIENT_ID: appId, WIX_CLIENT_SECRET: secrets.appSecret, WIX_CLIENT_PUBLIC_KEY: secrets.webhookPublicKey, WIX_CLIENT_INSTANCE_ID: instanceId,
  });
  emit("app_created", { appId, baseUrl: project.baseUrl });
  return { siteId, appId, baseUrl: project.baseUrl, variables };
}

function writeProject(d, { siteId, appId, variables }, { astro }) {
  const config = astro
    ? { appId, siteId }
    : { projectType: "Site", appId, siteId, site: { outputDirectory: flags.output || "./dist" } };
  writeConfig(d, config);
  writeEnv(d, variables);
  return config;
}

// `init`: this folder becomes a Wix project. Static (an output folder is released as-is) unless
// `--astro`. Writes wix.config.json and .env.local.
async function init() {
  const d = dir();
  if (existsSync(join(d, CONFIG))) fail("init_failed", { detail: `${d} is already a Wix project (${CONFIG})` });
  const businessName = validateBusinessName(flags["business-name"] || startCase(basename(d)));
  const p = await provision({ businessName, cloudProvider: flags["cloud-provider"], siteTemplate: flags["site-template"] });
  const config = writeProject(d, p, { astro: !!flags.astro });
  emit("project_ready", { dir: d, siteId: p.siteId, appId: p.appId, baseUrl: p.baseUrl, config, env: join(d, ENV_FILE) });
}

// `create --business-name <n> --folder <name> [--template-dir <path> | --template-repo <url> --template-path <sub>]`:
// a new folder with the template's files, then `init` in it. Astro unless `--static` or `--output`.
async function create() {
  const businessName = validateBusinessName(flags["business-name"]);
  const folder = flags.folder;
  if (!folder || !/^[a-z0-9][a-z0-9-]*$/.test(folder)) fail("args", { detail: "--folder <name>: lowercase letters, digits and dashes" });
  const d = resolve(process.cwd(), folder);
  if (existsSync(d) && readdirSync(d).length) fail("args", { detail: `${d} is not empty` });
  mkdirSync(d, { recursive: true });
  if (flags["template-dir"]) {
    cpSync(resolve(flags["template-dir"]), d, { recursive: true, filter: (src) => basename(src) !== ".git" && basename(src) !== "node_modules" });
    emit("template_copied", { from: resolve(flags["template-dir"]) });
  } else if (flags["template-repo"]) {
    const tmp = join(d, ".template-clone");
    const r = spawnSync("git", ["clone", "--depth", "1", ...(flags["template-ref"] ? ["--branch", flags["template-ref"]] : []), flags["template-repo"], tmp], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    if (r.status !== 0) fail("create_failed", { detail: (r.stderr || r.stdout || "git clone failed").slice(-400) });
    const src = flags["template-path"] ? join(tmp, flags["template-path"]) : tmp;
    if (!existsSync(src)) fail("create_failed", { detail: `${flags["template-path"]} is not in ${flags["template-repo"]}` });
    cpSync(src, d, { recursive: true, filter: (s) => basename(s) !== ".git" });
    spawnSync(process.platform === "win32" ? "cmd" : "rm", process.platform === "win32" ? ["/c", "rmdir", "/s", "/q", tmp] : ["-rf", tmp]);
    emit("template_copied", { from: `${flags["template-repo"]}${flags["template-path"] ? `#${flags["template-path"]}` : ""}` });
  }
  const astro = !(flags.static || flags.output);
  const p = await provision({ businessName, cloudProvider: flags["cloud-provider"] || "CLOUD_FLARE", siteTemplate: flags["site-template"] });
  const config = writeProject(d, p, { astro });
  emit("project_ready", { dir: d, siteId: p.siteId, appId: p.appId, baseUrl: p.baseUrl, config, env: join(d, ENV_FILE), next: existsSync(join(d, "package.json")) ? "npm install, then build and release" : "add the site's files, then release" });
}

// ── release ───────────────────────────────────────────────────────────────────────────────────
const STATIC_IGNORE = /^(CVS|Thumbs\.db|__pycache__.*|build.*|config\.gypi|coverage.*|dist.*|node_modules.*|npm-debug\.log|venv|package-lock\.json|.*\.lock|pnpm-lock\.yaml|bun\.lockb|package\.json|wix\.config\.json|wix-error\.log|.*\.log)$/;

function walk(root, { ignore = false, skipDotfiles = false, exclude = [] } = {}) {
  const out = [];
  const visit = (abs) => {
    for (const name of readdirSync(abs)) {
      const p = join(abs, name);
      if (skipDotfiles && name.startsWith(".")) continue;
      if (ignore && STATIC_IGNORE.test(name)) continue;
      if (exclude.some((e) => p === e || p.startsWith(e + "/"))) continue;
      const st = statSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) visit(p); else out.push({ path: p, relativePath: relative(root, p).split("\\").join("/") });
    }
  };
  visit(root);
  return out;
}

function buildFiles(d, config) {
  if (config.site?.outputDirectory != null) {
    const o = config.site.outputDirectory;
    const clientDir = typeof o === "string" ? resolve(d, o) : o.client ? resolve(d, o.client) : null;
    const serverDir = typeof o === "string" ? null : o.server ? resolve(d, o.server) : null;
    for (const x of [clientDir, serverDir]) if (x && !x.startsWith(d)) fail("release_failed", { detail: `site.outputDirectory ${x} is outside the project` });
    if (clientDir && !existsSync(clientDir)) fail("release_failed", { detail: `build output ${clientDir} is missing` });
    return { client: clientDir ? walk(clientDir, { ignore: true, skipDotfiles: true }) : [], server: serverDir ? walk(serverDir) : [], manifest: null, groupId: false };
  }
  const metaFile = join(d, ".wix", "build-metadata.json");
  if (!existsSync(metaFile)) fail("release_failed", { detail: `${metaFile} is missing: run the project's build first` });
  const meta = JSON.parse(readFileSync(metaFile, "utf8"));
  const abs = (p) => (p ? resolve(d, p) : null);
  const clientDir = abs(meta.clientDir); const serverDir = abs(meta.serverDir); const manifestPath = abs(meta.appManifestPath);
  if (!manifestPath || !existsSync(manifestPath)) fail("release_failed", { detail: `app manifest ${manifestPath} is missing` });
  const exclude = [manifestPath, ...(serverDir ? [serverDir] : [])];
  return {
    client: clientDir ? walk(clientDir, { exclude }) : [],
    server: serverDir ? walk(serverDir, { exclude: [manifestPath] }) : [],
    manifest: { path: manifestPath, statics: meta.staticsUrlPlaceholder, server: meta.serverUrlPlaceholder },
    groupId: !!meta.generateAppDeploymentGroupId,
  };
}

const noSlash = (s) => s.replace(/\/$/, "");
// A static site's manifest is empty; an Astro build ships one with URL placeholders. Both get the
// backend worker component that points the release at the deployment.
function manifestFor(d, config, files, deployment) {
  let manifest = { appId: config.appId, components: [] };
  if (files.manifest) {
    let text = readFileSync(files.manifest.path, "utf8");
    for (const key of [files.manifest.statics, files.manifest.server]) if (key && deployment.deploymentBaseUrl) text = text.replaceAll(noSlash(key), noSlash(deployment.deploymentBaseUrl));
    manifest = JSON.parse(text);
  }
  if (deployment.deploymentId && deployment.deploymentBaseUrl) {
    const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: d, encoding: "utf8" });
    manifest.components.push({ compId: BACKEND_WORKER_COMPONENT_ID, compType: "BACKEND_WORKER", compData: { backendWorker: { deploymentId: deployment.deploymentId, deploymentUrl: deployment.deploymentBaseUrl, ...(git.status === 0 ? { commitHash: git.stdout.trim() } : {}) } } });
  }
  return manifest;
}

// `release [--minor] [--comment <text>]`: uploads the build output and makes it the live version.
async function release() {
  const d = dir();
  const config = readConfig(d);
  const t = await accessToken({ siteId: config.siteId });
  const files = buildFiles(d, config);
  emit("uploading", { client: files.client.length, server: files.server.length, kind: files.manifest ? "astro" : "static" });
  const deployment = (files.client.length || files.server.length) ? await deploy(t, config.appId, files) : {};
  emit("uploaded", deployment);
  const manifest = manifestFor(d, config, files, deployment);
  const overrideId = await createComponentsOverride(t, manifest);
  const releaseBaseUrl = await releaseOverride(t, config.appId, overrideId, { minor: !!flags.minor, comment: flags.comment });
  const project = await getAppProject(t, config.appId);
  const url = project?.customDomain?.domain ? `https://${project.customDomain.domain}` : releaseBaseUrl;
  emit("released", { url, releaseBaseUrl, deploymentBaseUrl: deployment.deploymentBaseUrl, overrideId, siteId: config.siteId, appId: config.appId });
}

const commands = { login, whoami, token, env, init, create, release };
if (command === "help" || !commands[command]) {
  process.stdout.write([
    "wix-light <command>",
    "  login [--wait <sec>] [--force]",
    "  whoami",
    "  token [--site <siteId>] [--json]",
    "  env pull [--dir <project>]",
    "  init [--business-name <name>] [--astro] [--output <dir>] [--dir <folder>]",
    "  create --business-name <name> --folder <name> [--template-dir <path> | --template-repo <url> [--template-path <sub>] [--template-ref <ref>]] [--static] [--output <dir>] [--site-template <id>]",
    "  release [--minor] [--comment <text>] [--dir <project>]",
    "",
  ].join("\n"));
  process.exit(commands[command] ? 0 : 1);
}
setCommandName(command);
commands[command]().catch((e) => {
  if (e.code === "LoginRequired") fail("login_required", { detail: "no Wix session: run `login`" });
  if (e.code === "NoProject") fail(`${command}_failed`, { detail: e.message });
  fail(`${command}_failed`, { detail: String(e.message || e).slice(0, 600), ...(e.status ? { status: e.status } : {}) });
});
