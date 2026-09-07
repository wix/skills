import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const PLAYWRIGHT_PACKAGE = {
  playwright: "^1.62.0",
};

export async function resolveBrowserToolingContext({ startDir = process.cwd() } = {}) {
  const projectRoot = await findNearestPackageRoot(startDir);
  if (!projectRoot) {
    return {
      ok: false,
      projectRoot: null,
      packageManager: "unknown",
      manifest: null,
      requireFromRoot: null,
      reason: `No package.json was found above ${startDir}.`,
    };
  }

  const manifest = await readManifest(projectRoot);
  const packageManager = detectPackageManager(manifest);
  const nodeLinker = await detectNodeLinker(projectRoot);
  return {
    ok: true,
    projectRoot,
    packageManager,
    nodeLinker,
    manifest,
    requireFromRoot: createRequire(path.join(projectRoot, "package.json")),
  };
}

export async function runBrowserExtractionPreflight({ startDir = process.cwd(), fix = false } = {}) {
  const context = await resolveBrowserToolingContext({ startDir });
  const report = {
    ok: false,
    context: {
      projectRoot: context.projectRoot,
      packageManager: context.packageManager,
      nodeLinker: context.nodeLinker || "unknown",
    },
    checks: [],
    remediation: {
      commands: [],
      notes: [],
      autoFixAttempted: false,
      autoFixSucceeded: false,
    },
  };

  if (!context.ok) {
    report.checks.push(failCheck("project_root", context.reason));
    report.remediation.notes.push(
      "Create or choose a project root with a package.json, then add playwright and provide a runnable design-md-generator before retrying browser extraction.",
    );
    return report;
  }

  const declaredPackages = getDeclaredPackages(context.manifest);
  const requiredPackages = await requiredPackageSpecsForContext(context);
  const missingDeclarations = Object.keys(requiredPackages).filter((name) => !declaredPackages.has(name));
  report.checks.push(
    missingDeclarations.length === 0
      ? passCheck("dependency_declarations", "Required browser-extraction packages are declared in package.json.")
      : failCheck("dependency_declarations", `Missing package.json declarations for: ${missingDeclarations.join(", ")}`),
  );

  report.checks.push(
    context.packageManager !== "yarn" || context.nodeLinker === "node-modules"
      ? passCheck("package_manager_layout", context.packageManager === "yarn"
        ? "Yarn nodeLinker is set to node-modules."
        : `Package manager ${context.packageManager} does not require a Yarn nodeLinker check.`)
      : failCheck(
          "package_manager_layout",
          `Yarn project ${context.projectRoot} is using nodeLinker=${context.nodeLinker || "unknown"}. Browser extraction requires node-modules so host binaries and browser/design tooling resolve consistently.`,
        ),
  );

  const installDeclaredCommand = installCommandForContext(context, missingDeclarations, requiredPackages);
  if (installDeclaredCommand) {
    report.remediation.commands.push(installDeclaredCommand);
  }
  const linkerRemediationCommand = nodeLinkerRemediationCommand(context);
  if (linkerRemediationCommand) {
    report.remediation.commands.push(linkerRemediationCommand);
    report.remediation.notes.push(
      "Yarn Plug'n'Play is not compatible with the current browser/design extraction toolchain because the host repo needs a real node_modules layout for host binaries and runtime resolution.",
    );
  }

  let playwright = null;
  const playwrightLoad = await tryLoadPackage(context, "playwright");
  if (playwrightLoad.ok) {
    playwright = playwrightLoad.module;
    report.checks.push(passCheck("playwright_package", `Resolved playwright from ${playwrightLoad.resolvedPath}`));
  } else {
    report.checks.push(failCheck("playwright_package", playwrightLoad.message));
  }

  const designMdGenerator = await resolveDesignMdGeneratorExecutionFromContext(context);
  if (designMdGenerator.ok) {
    report.checks.push(
      passCheck(
        "design_md_generator",
        `Resolved design-md-generator in ${designMdGenerator.mode} mode at ${designMdGenerator.rootDir} using ${designMdGenerator.commandDescription}.`,
      ),
    );
  } else {
    report.checks.push(failCheck("design_md_generator", designMdGenerator.message));
    report.remediation.notes.push(...(designMdGenerator.notes || []));
  }

  const browserInstallCommand = browserInstallCommandForContext(context);
  let chromiumOkay = false;
  if (playwright) {
    const launch = await tryLaunchChromium(playwright);
    chromiumOkay = launch.ok;
    report.checks.push(
      launch.ok
        ? passCheck("chromium_runtime", "Chromium launched successfully.")
        : failCheck("chromium_runtime", launch.message),
    );
    if (!launch.ok && browserInstallCommand && !launch.environmentBlocked) {
      report.remediation.commands.push(browserInstallCommand);
    }
    if (!launch.ok && launch.environmentBlocked) {
      report.remediation.notes.push(
        "Chromium is installed but the current execution environment blocked browser launch. Retry from a normal local shell/session or rerun with the browser-launch permission/escalation your agent runtime requires before treating this as a hard blocker.",
      );
    }
  }

  const needsInstall = missingDeclarations.length > 0 || !playwrightLoad.ok;
  const needsNodeModulesLayout = Boolean(linkerRemediationCommand);
  if (fix && (needsInstall || !chromiumOkay || needsNodeModulesLayout)) {
    report.remediation.autoFixAttempted = true;
    const succeeded = await attemptAutoFix({
      context,
      installDeclaredCommand,
      runInstall: needsInstall,
      runBrowserInstall: !chromiumOkay,
      updateNodeLinker: needsNodeModulesLayout,
    });
    report.remediation.autoFixSucceeded = succeeded.ok;
    report.remediation.notes.push(...succeeded.notes);
    if (succeeded.ok) {
      return runBrowserExtractionPreflight({ startDir, fix: false });
    }
  }

  report.ok = report.checks.every((check) => check.status !== "fail");
  return report;
}

export async function ensureBrowserExtractionReady({ startDir = process.cwd(), fix = false } = {}) {
  const report = await runBrowserExtractionPreflight({ startDir, fix });
  if (!report.ok) {
    const lines = [];
    for (const check of report.checks.filter((item) => item.status === "fail")) {
      lines.push(`- ${check.id}: ${check.message}`);
    }
    const commands = report.remediation.commands.length
      ? `Suggested fixes:\n${report.remediation.commands.map((command) => `  ${command}`).join("\n")}`
      : "Suggested fixes: none were auto-derived; inspect the failing checks.";
    throw new Error(
      `Browser extraction preflight failed.\n${lines.join("\n")}\n${commands}\n` +
      "If browser launch was blocked by the execution environment, rerun with the required browser-launch escalation before treating the run as blocked.\n" +
      "If this repo uses the root helper scripts, run `corepack yarn browser-extraction:preflight --fix` from the project root.",
    );
  }
  return resolveBrowserToolingContext({ startDir });
}

export async function loadPlaywrightFromContext(context) {
  const loaded = await tryLoadPackage(context, "playwright");
  if (!loaded.ok) {
    throw new Error(loaded.message);
  }
  return loaded.module;
}

export async function resolveDesignMdGeneratorFromContext(context) {
  const result = await resolveDesignMdGeneratorExecutionFromContext(context);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result;
}

async function findNearestPackageRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (await pathExists(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readManifest(projectRoot) {
  return JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
}

async function detectNodeLinker(projectRoot) {
  const yarnrcPath = path.join(projectRoot, ".yarnrc.yml");
  if (!(await pathExists(yarnrcPath))) return null;
  const yarnrc = await readFile(yarnrcPath, "utf8");
  const match = yarnrc.match(/^\s*nodeLinker:\s*([^\s#]+)\s*$/m);
  return match ? match[1] : null;
}

function detectPackageManager(manifest) {
  const raw = String(manifest?.packageManager || "").trim();
  if (raw.startsWith("yarn@")) return "yarn";
  if (raw.startsWith("pnpm@")) return "pnpm";
  if (raw.startsWith("npm@")) return "npm";
  return "npm";
}

function getDeclaredPackages(manifest) {
  return new Set(
    [
      ...Object.keys(manifest?.dependencies || {}),
      ...Object.keys(manifest?.devDependencies || {}),
      ...Object.keys(manifest?.optionalDependencies || {}),
    ],
  );
}

async function tryLoadPackage(context, packageName) {
  try {
    const resolvedPath = context.requireFromRoot.resolve(packageName);
    const module = context.requireFromRoot(packageName);
    return { ok: true, resolvedPath, module };
  } catch (error) {
    return {
      ok: false,
      message: `Could not resolve ${packageName} from ${context.projectRoot}. Install project dependencies first. Details: ${error.message}`,
    };
  }
}

async function resolvePackageBinary(context, packageName, binName) {
  try {
    const pkgDir = await resolvePackageDir(context, packageName);
    if (!pkgDir) {
      return {
        ok: false,
        message: `Could not resolve ${packageName} from ${context.projectRoot}. Install project dependencies first.`,
      };
    }
    const binPath = path.join(context.projectRoot, "node_modules", ".bin", binName);
    if (await pathExists(binPath)) {
      return { ok: true, path: binPath, pkgDir };
    }
    return {
      ok: false,
      message: `${packageName} was resolved, but ${binName} was not found at ${binPath}. Use a node-modules install (for example Yarn with nodeLinker: node-modules) and reinstall dependencies.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Could not resolve ${packageName} from ${context.projectRoot}. Details: ${error.message}`,
    };
  }
}

export async function resolveDesignMdGeneratorExecutionFromContext(context) {
  const packageDir = await resolvePackageDir(context, "design-md-generator");
  const localCandidates = [
    process.env.DESIGN_MD_GENERATOR_DIR,
    path.join(context.projectRoot, "tools", "design-md-generator"),
    path.join(context.projectRoot, "test-designmd", "design-md-generator"),
  ].filter(Boolean);
  let lastFailure = null;

  for (const candidate of localCandidates) {
    const checkout = await resolveDesignMdGeneratorCheckout(candidate);
    if (checkout.ok) {
      return checkout;
    }
    const packageMode = await resolveDesignMdGeneratorPackageMode(candidate, context.projectRoot);
    if (packageMode.ok) {
      return packageMode;
    }
    if (packageMode.message) {
      lastFailure = packageMode;
    }
  }

  const packageMode = await resolveDesignMdGeneratorPackageMode(packageDir, context.projectRoot);
  if (packageMode.ok) {
    return packageMode;
  }
  if (packageMode.message) {
    return packageMode;
  }
  if (lastFailure) {
    return lastFailure;
  }

  return {
    ok: false,
    message: "design-md-generator was not found in a runnable form. Declare it in package.json and install a built CLI, or set DESIGN_MD_GENERATOR_DIR to a local checkout.",
    notes: [
      `Repo-default checkout path: ${path.join(context.projectRoot, "tools", "design-md-generator")}`,
      "External repos can either install a built design-md-generator package or provide DESIGN_MD_GENERATOR_DIR=/absolute/path/to/design-md-generator.",
    ],
  };
}

async function resolveDesignMdGeneratorCheckout(candidate) {
  if (!candidate) return { ok: false };
  const extractScript = path.join(candidate, "scripts", "extract.ts");
  const packageJsonPath = path.join(candidate, "package.json");
  if (!await pathExists(extractScript) || !await pathExists(packageJsonPath)) {
    return { ok: false };
  }
  return {
    ok: true,
    mode: "checkout",
    rootDir: candidate,
    command: "npx",
    args: ["ts-node", "scripts/extract.ts"],
    retryCommand: "corepack",
    retryArgs: ["yarn", "ts-node", "scripts/extract.ts"],
    commandDescription: "npx ts-node scripts/extract.ts",
  };
}

async function resolveDesignMdGeneratorPackageMode(packageDir, projectRoot) {
  if (!packageDir) return { ok: false };
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!await pathExists(packageJsonPath)) return { ok: false };

  let manifest;
  try {
    manifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      message: `design-md-generator package metadata at ${packageJsonPath} could not be read: ${error.message}`,
    };
  }

  const binField = manifest?.bin;
  const binEntries = typeof binField === "string" ? [binField] : Object.values(binField || {});
  for (const relativeBin of binEntries) {
    const cliPath = path.join(packageDir, relativeBin);
    if (await pathExists(cliPath)) {
      return {
        ok: true,
        mode: "package",
        rootDir: packageDir,
        command: "node",
        args: [cliPath],
        retryCommand: null,
        retryArgs: null,
        commandDescription: `node ${path.relative(packageDir, cliPath)}`,
      };
    }
  }

  const distCli = path.join(packageDir, "dist", "cli.js");
  if (await pathExists(distCli)) {
    return {
      ok: true,
      mode: "package",
      rootDir: packageDir,
      command: "node",
      args: [distCli],
      retryCommand: null,
      retryArgs: null,
      commandDescription: `node ${path.relative(packageDir, distCli)}`,
    };
  }

  return {
    ok: false,
    message: `design-md-generator is installed at ${packageDir}, but it does not contain a runnable extractor entrypoint. Expected either a built CLI from package.json/bin or a checkout entrypoint such as scripts/extract.ts.`,
    notes: [
      `For this repo, prefer a real checkout at ${path.join(projectRoot, "tools", "design-md-generator")}.`,
      "Outside this repo, set DESIGN_MD_GENERATOR_DIR to a local checkout or install a built package that exposes a working CLI.",
    ],
  };
}

async function resolvePackageDir(context, packageName) {
  try {
    const resolvedEntry = context.requireFromRoot.resolve(packageName);
    return await findPackageDirFromResolvedPath(resolvedEntry, packageName);
  } catch {
    try {
      const pkgJsonPath = context.requireFromRoot.resolve(`${packageName}/package.json`);
      return path.dirname(pkgJsonPath);
    } catch {
      return null;
    }
  }
}

async function findPackageDirFromResolvedPath(resolvedPath, packageName) {
  let current = path.dirname(resolvedPath);
  while (true) {
    const pkgJsonPath = path.join(current, "package.json");
    if (await pathExists(pkgJsonPath)) {
      try {
        const manifest = JSON.parse(await readFile(pkgJsonPath, "utf8"));
        if (manifest?.name === packageName) {
          return current;
        }
      } catch {}
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function tryLaunchChromium(playwright) {
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    return { ok: true };
  } catch (error) {
    const details = String(error?.message || error);
    const environmentBlocked = /Permission denied \(1100\)|MachPortRendezvousServer|bootstrap_check_in/i.test(details);
    return {
      ok: false,
      environmentBlocked,
      message: environmentBlocked
        ? `Chromium could not launch because the current execution environment blocked Playwright from starting the browser. Details: ${details}`
        : `Chromium could not launch. Install the browser runtime and retry. Details: ${details}`,
    };
  } finally {
    await browser?.close();
  }
}

function installCommandForContext(context, missingDeclarations, requiredPackages) {
  if (missingDeclarations.length > 0) {
    const pkgSpecs = missingDeclarations.map((name) => `${name}@${requiredPackages[name]}`);
    switch (context.packageManager) {
      case "yarn":
        return `corepack yarn add -D ${pkgSpecs.join(" ")}`;
      case "pnpm":
        return `corepack pnpm add -D ${pkgSpecs.join(" ")}`;
      default:
        return `npm install --save-dev ${pkgSpecs.join(" ")}`;
    }
  }

  switch (context.packageManager) {
    case "yarn":
      return `corepack yarn install`;
    case "pnpm":
      return `corepack pnpm install`;
    default:
      return `npm install`;
  }
}

async function requiredPackageSpecsForContext(context) {
  const specs = { ...PLAYWRIGHT_PACKAGE };
  const repoLocalTool = path.join(context.projectRoot, "tools", "design-md-generator", "package.json");
  if (await pathExists(repoLocalTool)) {
    specs["design-md-generator"] = "file:tools/design-md-generator";
  }
  return specs;
}

function browserInstallCommandForContext(context) {
  switch (context.packageManager) {
    case "yarn":
      return `npx playwright install chromium`;
    case "pnpm":
      return `npx playwright install chromium`;
    default:
      return `npx playwright install chromium`;
  }
}

function nodeLinkerRemediationCommand(context) {
  if (context.packageManager !== "yarn" || context.nodeLinker === "node-modules") {
    return null;
  }
  return "printf 'nodeLinker: node-modules\\n' > .yarnrc.yml";
}

async function attemptAutoFix({ context, installDeclaredCommand, runInstall, runBrowserInstall, updateNodeLinker }) {
  const notes = [];
  if (updateNodeLinker) {
    const linkerUpdate = await runShellCommand("printf 'nodeLinker: node-modules\\n' > .yarnrc.yml", context.projectRoot);
    if (!linkerUpdate.ok) {
      notes.push(`Yarn nodeLinker remediation failed: ${linkerUpdate.summary}`);
      return { ok: false, notes };
    }
    notes.push("Updated .yarnrc.yml to use nodeLinker: node-modules");
  }
  if (runInstall && installDeclaredCommand) {
    const install = await runShellCommand(installDeclaredCommand, context.projectRoot);
    if (!install.ok) {
      notes.push(`Dependency remediation failed: ${install.summary}`);
      return { ok: false, notes };
    }
    notes.push(`Ran dependency remediation: ${installDeclaredCommand}`);
  }
  if (runBrowserInstall) {
    const browserInstallCommand = browserInstallCommandForContext(context);
    const browserInstall = await runShellCommand(browserInstallCommand, context.projectRoot);
    if (!browserInstall.ok) {
      notes.push(`Chromium remediation failed: ${browserInstall.summary}`);
      return { ok: false, notes };
    }
    notes.push(`Ran browser remediation: ${browserInstallCommand}`);
  }
  return { ok: true, notes };
}

function runShellCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        summary: code === 0 ? "ok" : `exit ${code}: ${String(stderr || stdout).slice(-1000)}`,
      });
    });
  });
}

function passCheck(id, message) {
  return { id, status: "pass", message };
}

function failCheck(id, message) {
  return { id, status: "fail", message };
}

function skippedCheck(id, message) {
  return { id, status: "skip", message };
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
