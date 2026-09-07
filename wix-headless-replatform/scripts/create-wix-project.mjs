#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  businessNameFromProject,
  countBy,
  docsDir,
  ensureDir,
  normalizeUrl,
  parseArgs,
  projectNameFromUrl,
  readJson,
  resolveOutputDir,
  selectWixTemplate,
  wixBusinessNameFromProject,
  wixFolderNameFromProject,
  writeJson,
} from "./lib/common.mjs";
import { clearWixStarter } from "./clear-wix-starter.mjs";

async function main() {
  const args = parseArgs();
  const url = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(url, args.out);
  const projectName = path.basename(outputDir);
  const result = await createWixProject({
    sourceUrl: url,
    outputDir,
    projectName,
    businessName: args["business-name"] || businessNameFromProject(projectNameFromUrl(url)),
    template: args.template,
    execute: Boolean(args.execute),
    clearStarter: args["clear-starter"] !== "false",
  });
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else console.log(result.command);
}

export async function createWixProject({ sourceUrl, outputDir, projectName, businessName, template, execute = false, clearStarter = true }) {
  const parentDir = path.dirname(outputDir);
  await ensureDir(parentDir);
  const discovery = await safeRead(path.join(docsDir(outputDir), "discovery.json"), { scope: "home", pages: [] });
  const counts = countBy(discovery.pages || [], (page) => page.area);
  const selectedTemplate = template || selectWixTemplate(discovery.scope || "home", counts);
  const wixFolderName = wixFolderNameFromProject(projectName);
  const normalizedBusinessName = sanitizeBusinessName(businessName) || wixBusinessNameFromProject(projectName);
  const wixCreateArgs = [
    "@wix/new@latest",
    "headless",
    "--folder-name",
    wixFolderName,
    "--business-name",
    normalizedBusinessName,
    "--site-template",
    selectedTemplate,
  ];
  const createRunner = await resolvePackageCreateRunner();
  const scaffoldParentDir = execute
    ? await resolveScaffoldParentDir({ preferredParentDir: parentDir, createRunner })
    : parentDir;
  const wixOutputDir = path.join(scaffoldParentDir, wixFolderName);
  const localOutputRename = path.resolve(wixOutputDir) !== path.resolve(outputDir);
  const createArgs = [...createRunner.argsPrefix, ...wixCreateArgs];
  const result = {
    sourceUrl,
    outputDir,
    projectName,
    businessName: normalizedBusinessName,
    template: selectedTemplate,
    wixFolderName,
    wixOutputDir,
    localOutputRename,
    clearStarter,
    command: `${createRunner.displayName} ${createArgs.map(shellQuote).join(" ")}`,
    executed: execute,
    generatedAt: new Date().toISOString(),
  };
  // Do not write clone metadata yet when provisioning. The Wix CLI requires a
  // clean target directory; artifacts are recorded only after it owns outputDir.
  if (!execute) {
    await writeJson(path.join(docsDir(outputDir), "wix-project.json"), result);
    return result;
  }
  const createRun = await runCommand(createRunner.command, createArgs, {
    cwd: scaffoldParentDir,
    timeoutMs: 300000,
    envOverrides: publicRegistryEnv(),
  });
  result.createRun = summarizeRun(createRun);
  const scaffoldExists = await pathExists(wixOutputDir);
  if (!createRun.ok) {
    if (!scaffoldExists) {
      result.executed = false;
      result.error = `Wix scaffold creation failed before a local scaffold was created: ${createRun.summary}`;
      await writeJson(path.join(docsDir(outputDir), "wix-project.json"), result);
      throw new Error(result.error);
    }
    result.recovery = {
      triggered: true,
      reason: createRun.timedOut ? "wix-cli-timed-out-after-scaffold-created" : "wix-cli-failed-after-scaffold-created",
    };
    await normalizeNodeRuntime(wixOutputDir);
    await ensureYarnProjectBoundary(wixOutputDir);
    const yarnInstall = await installWithYarn(wixOutputDir);
    result.recovery.yarnInstall = summarizeRun(yarnInstall);
    if (!yarnInstall.ok) {
      result.executed = false;
      result.error = `Wix scaffold recovery failed during yarn install: ${yarnInstall.summary}`;
      await writeJson(path.join(docsDir(outputDir), "wix-project.json"), result);
      throw new Error(result.error);
    }
  }
  if (localOutputRename) await moveOrMergeWixOutput({ wixOutputDir, outputDir });
  await ensureYarnProjectBoundary(outputDir);
  await normalizeNodeRuntime(outputDir);
  await normalizeHostingAdapterDependencies(outputDir);
  result.projectIdentity = await validateWixProjectIdentity(outputDir);
  if (!result.projectIdentity.ok) {
    result.executed = false;
    result.error = `Wix scaffold is incomplete: ${result.projectIdentity.summary}`;
    await writeJson(path.join(docsDir(outputDir), "wix-project.json"), result);
    throw new Error(result.error);
  }
  if (clearStarter) await clearWixStarter({ outputDir });
  result.runtimeContract = await verifyWixRuntimeProject(outputDir);
  if (!result.runtimeContract.ok) {
    result.executed = false;
    result.error = `Generated Wix project is missing its runnable package contract: ${result.runtimeContract.summary}`;
    await writeJson(path.join(docsDir(outputDir), "wix-project.json"), result);
    throw new Error(result.error);
  }
  await ensureYarnProjectBoundary(outputDir);
  const yarnInstall = await installWithYarn(outputDir);
  result.environment = {
    yarnInstall: summarizeRun(yarnInstall),
  };
  if (!yarnInstall.ok) {
    result.executed = false;
    result.error = `Generated Wix project failed dependency normalization: ${yarnInstall.summary}`;
    await writeJson(path.join(docsDir(outputDir), "wix-project.json"), result);
    throw new Error(result.error);
  }
  const yarnRunner = await resolveYarnRunner();
  const baselineBuild = await runCommand(yarnRunner.command, [...yarnRunner.argsPrefix, "build"], { cwd: outputDir, timeoutMs: 300000 });
  result.environment.baselineBuild = summarizeRun(baselineBuild);
  if (!baselineBuild.ok) {
    result.executed = false;
    result.error = `Generated Wix project failed baseline build verification: ${baselineBuild.summary}`;
    await writeJson(path.join(docsDir(outputDir), "wix-project.json"), result);
    throw new Error(result.error);
  }
  result.executed = true;
  result.finalOutputDir = outputDir;
  await writeJson(path.join(docsDir(outputDir), "wix-project.json"), result);
  return result;
}

export async function verifyWixRuntimeProject(projectDir) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(projectDir, "package.json"), "utf8"));
  } catch (error) {
    return { ok: false, summary: `missing or unreadable package.json: ${error.message}` };
  }
  const scripts = manifest.scripts || {};
  const missing = ["dev", "build"].filter((name) => !String(scripts[name] || "").trim());
  if (missing.length) return { ok: false, summary: `package.json is missing required scripts: ${missing.join(", ")}` };
  const wixConfig = path.join(projectDir, "wix.config.json");
  if (!await pathExists(wixConfig)) return { ok: false, summary: "wix.config.json is missing" };
  return { ok: true, summary: "package.json, Wix config, and dev/build scripts are present" };
}

function sanitizeBusinessName(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function moveOrMergeWixOutput({ wixOutputDir, outputDir }) {
  try {
    await rename(wixOutputDir, outputDir);
    return;
  } catch (error) {
    if (error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") throw error;
  }

  await ensureDir(outputDir);
  const entries = await readdir(wixOutputDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(wixOutputDir, entry.name);
    const to = path.join(outputDir, entry.name);
    await copyEntryNoOverwrite({ from, to, entry });
  }
  await rm(wixOutputDir, { recursive: true, force: true });
}

async function copyEntryNoOverwrite({ from, to, entry }) {
  if (entry.isDirectory()) {
    await ensureDir(to);
    const children = await readdir(from, { withFileTypes: true });
    for (const child of children) {
      await copyEntryNoOverwrite({
        from: path.join(from, child.name),
        to: path.join(to, child.name),
        entry: child,
      });
    }
    return;
  }
  await copyFile(from, to, fsConstants.COPYFILE_EXCL);
}

async function installWithYarn(projectDir) {
  const yarnRunner = await resolveYarnRunner();
  await ensureYarnProjectBoundary(projectDir);
  let run = await runCommand(yarnRunner.command, [...yarnRunner.argsPrefix, "install"], { cwd: projectDir, timeoutMs: 300000 });
  if (run.ok) return run;
  if (needsProjectBoundaryLockfile(run)) {
    await ensureYarnProjectBoundary(projectDir);
    run = await runCommand(yarnRunner.command, [...yarnRunner.argsPrefix, "install"], { cwd: projectDir, timeoutMs: 300000 });
  }
  return run;
}

function needsProjectBoundaryLockfile(run) {
  const text = `${run.stdout}\n${run.stderr}`;
  return /nearest package directory|doesn't seem to be part of the project/i.test(text);
}

export async function ensureYarnProjectBoundary(projectDir) {
  const lockfile = path.join(projectDir, "yarn.lock");
  if (await pathExists(lockfile)) return;
  await writeFile(lockfile, "", "utf8");
}

export async function normalizeHostingAdapterDependencies(projectDir) {
  const packageJsonPath = path.join(projectDir, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    return { ok: false, changed: false, summary: "package.json was not readable during hosting-adapter normalization" };
  }

  const devDependencies = manifest.devDependencies || {};
  if (!devDependencies["@wix/astro-wix-hosting-adapter"]) {
    return { ok: true, changed: false, summary: "Wix hosting adapter is not declared; no hosting dependency normalization was needed" };
  }
  if (!devDependencies["@astrojs/cloudflare"]) {
    return { ok: true, changed: false, summary: "Standalone manifest already defers Cloudflare adapter ownership to the Wix hosting adapter" };
  }

  delete devDependencies["@astrojs/cloudflare"];
  manifest.devDependencies = sortObjectKeys(devDependencies);
  await writeFile(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { ok: true, changed: true, summary: "Removed direct @astrojs/cloudflare so the Wix hosting adapter owns the compatible Cloudflare adapter dependency" };
}

export async function normalizeNodeRuntime(projectDir) {
  const packageJsonPath = path.join(projectDir, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    return { ok: false, changed: false, summary: "package.json was not readable during Node runtime normalization" };
  }
  const major = Number(String(process.versions.node).split(".")[0]);
  const declared = String(manifest.engines?.node || "");
  if (!declared || declared.includes(String(major))) {
    return { ok: true, changed: false, summary: "The generated project declares the active Node major" };
  }
  manifest.engines = { ...(manifest.engines || {}), node: `>=${major}.0.0 <${major + 1}.0.0-0` };
  await writeFile(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { ok: true, changed: true, summary: `Normalized generated project Node engine to active major ${major}` };
}

function sortObjectKeys(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function summarizeRun(run) {
  return {
    ok: run.ok,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    summary: run.summary,
    stdoutTail: String(run.stdout || "").slice(-4000),
    stderrTail: String(run.stderr || "").slice(-4000),
  };
}

async function validateWixProjectIdentity(projectDir) {
  const configPath = path.join(projectDir, "wix.config.json");
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      summary: `missing or unreadable wix.config.json at ${configPath}: ${error.message}`,
    };
  }

  const appId = firstNonEmptyString(config.appId, config.applicationId);
  const siteId = firstNonEmptyString(config.siteId);
  const errors = [];
  if (!isGuid(appId)) errors.push("wix.config.json appId is missing or not a valid GUID");
  if (!isGuid(siteId)) errors.push("wix.config.json siteId is missing or not a valid GUID");

  const appConfigPath = path.join(projectDir, ".wix", "app.config.json");
  const topologyPath = path.join(projectDir, ".wix", "topology.json");
  if (!await pathExists(appConfigPath)) errors.push(".wix/app.config.json is missing");
  if (!await pathExists(topologyPath)) errors.push(".wix/topology.json is missing");

  return {
    ok: errors.length === 0,
    appId,
    siteId,
    summary: errors.length ? errors.join("; ") : `validated appId ${appId} and siteId ${siteId}`,
  };
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isGuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function runCommand(command, args, { cwd, timeoutMs, envOverrides = {} }) {
  return new Promise((resolve, reject) => {
    const nodeBinDir = process.execPath ? path.dirname(process.execPath) : "";
    const pathParts = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
    const mergedPath = [nodeBinDir, ...pathParts].filter(Boolean).join(path.delimiter);
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: mergedPath,
        ...envOverrides,
      },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        timedOut,
        stdout,
        stderr,
        summary: timedOut
          ? `timed out after ${timeoutMs / 1000}s`
          : `exited with code ${code}`,
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(command) {
  const candidates = [];
  if (path.isAbsolute(command)) candidates.push(command);
  const pathEntries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) candidates.push(path.join(entry, command));
  if (command === "npm" && process.execPath) {
    candidates.push(path.join(path.dirname(process.execPath), "npm"));
  }
  if (command === "corepack" && process.execPath) {
    candidates.push(path.join(path.dirname(process.execPath), "corepack"));
  }

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep searching.
    }
  }
  throw new Error(`Unable to resolve executable "${command}" from PATH.`);
}

async function resolvePackageCreateRunner() {
  try {
    return {
      command: await resolveExecutable("npm"),
      argsPrefix: ["create"],
      displayName: "npm",
    };
  } catch {
    try {
      return {
        command: await resolveExecutable("pnpm"),
        argsPrefix: ["dlx"],
        displayName: "pnpm",
      };
    } catch {
      return {
        command: await resolveExecutable("yarn"),
        argsPrefix: ["dlx"],
        displayName: "yarn",
      };
    }
  }
}

async function resolveYarnRunner() {
  try {
    return {
      command: await resolveExecutable("corepack"),
      argsPrefix: ["yarn"],
      displayName: "corepack yarn",
    };
  } catch {
    return {
      command: await resolveExecutable("yarn"),
      argsPrefix: [],
      displayName: "yarn",
    };
  }
}

async function resolveScaffoldParentDir({ preferredParentDir, createRunner }) {
  if (createRunner.displayName === "npm") {
    return preferredParentDir;
  }
  const tempBaseDir = path.join("/private/tmp", "wix-headless-replatform-");
  return mkdtemp(tempBaseDir);
}

function publicRegistryEnv() {
  return {
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
    npm_config_registry: "https://registry.npmjs.org",
    NPM_CONFIG_USERCONFIG: "/dev/null",
    npm_config_userconfig: "/dev/null",
    YARN_NPM_REGISTRY_SERVER: "https://registry.npmjs.org",
  };
}

function shellQuote(value) {
  return /^[a-zA-Z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value);
}

async function safeRead(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
