#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  EXECUTION_BLOCKED,
  HarmonyBridgeError,
  executableExists,
  loadPackagePlaywright,
  validateEditorUrl,
  validateProfileDir,
} from "./lib/wix-harmony-browser.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, "..");
const yarnBinary = path.join(skillDir, ".yarn", "releases", "yarn-4.9.2.cjs");

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  const valueOptions = new Set(["--editor-url", "--profile-dir"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--fix" || token === "--json") args[token.slice(2)] = true;
    else if (valueOptions.has(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}.`);
      args[token.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

export function runChildCommand(command, args, spawn = spawnSync) {
  return spawn(command, args, { cwd: skillDir, stdio: ["ignore", 2, 2], shell: false }).status === 0;
}

export async function runPreflight({
  editorUrl,
  profileDir,
  fix = false,
  playwrightLoader = loadPackagePlaywright,
  nodeVersion = process.versions.node,
  runCommand = runChildCommand,
} = {}) {
  const checks = [];
  const add = (name, ok, remediation = null, detail = null) => checks.push({ name, status: ok ? "pass" : "fail", remediation, detail });

  const nodeOk = Number(nodeVersion.split(".")[0]) >= 20;
  add("node", nodeOk, nodeOk ? null : "Install Node.js 20 or newer.", nodeVersion);

  try {
    validateEditorUrl(editorUrl);
    add("editor_url", true);
  } catch (error) {
    add("editor_url", false, "Pass --editor-url with an absolute HTTPS Wix editor URL.", error.message);
  }

  let validProfile;
  try {
    validProfile = validateProfileDir(profileDir, skillDir);
    if (!fs.existsSync(validProfile)) {
      if (!fix) {
        throw new HarmonyBridgeError(
          "profile_missing",
          "The dedicated automation profile does not exist; rerun preflight with --fix to create it securely.",
        );
      }
      fs.mkdirSync(validProfile, { recursive: true, mode: 0o700 });
    }
    const profileStat = fs.lstatSync(validProfile);
    if (profileStat.isSymbolicLink() || !profileStat.isDirectory()) {
      throw new HarmonyBridgeError("invalid_profile_dir", "The automation profile must be a real directory, not a file or symbolic link.");
    }
    if ((profileStat.mode & 0o077) !== 0) {
      if (fix) fs.chmodSync(validProfile, 0o700);
      else {
        throw new HarmonyBridgeError(
          "unsafe_profile_permissions",
          "The automation profile is accessible to other local users; rerun preflight with --fix to set mode 0700.",
        );
      }
    }
    fs.accessSync(validProfile, fs.constants.W_OK);
    add("profile_dir", true);
  } catch (error) {
    add("profile_dir", false, "Pass --profile-dir with a writable absolute dedicated automation directory outside normal browser profiles.", error.message);
  }

  let playwright;
  try {
    playwright = await playwrightLoader();
    add("package_local_playwright", true);
  } catch (error) {
    if (fix && runCommand(process.execPath, [yarnBinary, "install", "--immutable"])) {
      try {
        playwright = await playwrightLoader();
      } catch {}
    }
    add(
      "package_local_playwright",
      Boolean(playwright),
      playwright ? null : `Run: cd "${skillDir}" && node .yarn/releases/yarn-4.9.2.cjs install --immutable`,
      playwright ? null : error.message,
    );
  }

  let browserOk = Boolean(playwright && executableExists(playwright));
  if (!browserOk && fix && playwright) {
    runCommand(path.join(skillDir, "node_modules", ".bin", "playwright"), ["install", "chromium"]);
    browserOk = executableExists(playwright);
  }
  add(
    "chromium",
    browserOk,
    browserOk ? null : `Run: cd "${skillDir}" && node .yarn/releases/yarn-4.9.2.cjs install-browser`,
  );

  checks.push({
    name: "attributed_execution",
    status: "blocked",
    code: EXECUTION_BLOCKED.code,
    detail: EXECUTION_BLOCKED.message,
  });

  return {
    ok: checks.every((check) => check.status !== "fail"),
    skillDir,
    checks,
    execution: EXECUTION_BLOCKED,
  };
}

async function main() {
  const args = parseArgs();
  const report = await runPreflight({
    editorUrl: args["editor-url"],
    profileDir: args["profile-dir"],
    fix: args.fix,
  });
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    for (const check of report.checks) {
      process.stdout.write(`${check.status.toUpperCase()} ${check.name}${check.detail ? `: ${check.detail}` : ""}\n`);
      if (check.remediation) process.stdout.write(`  ${check.remediation}\n`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
