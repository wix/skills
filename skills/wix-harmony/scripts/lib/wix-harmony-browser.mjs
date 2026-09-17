import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const EXECUTION_BLOCKED = Object.freeze({
  type: "blocked",
  code: "blocked_missing_owner_attribution_spi",
  message: "Attributed Harmony execution is not available in this build.",
});

export class HarmonyBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HarmonyBridgeError";
    this.code = code;
  }
}

export function validateEditorUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HarmonyBridgeError("invalid_editor_url", "--editor-url must be an absolute HTTPS Wix editor URL.");
  }
  const isWixHost = url.hostname === "wix.com" || url.hostname.endsWith(".wix.com");
  if (url.protocol !== "https:" || !isWixHost) {
    throw new HarmonyBridgeError("invalid_editor_url", "--editor-url must be an absolute HTTPS Wix editor URL.");
  }
  if (url.username || url.password) {
    throw new HarmonyBridgeError("invalid_editor_url", "--editor-url must not contain credentials.");
  }
  return url.href;
}

function canonicalizePotentialPath(value) {
  const missingSegments = [];
  let existingAncestor = value;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const canonicalAncestor = fs.realpathSync.native(existingAncestor);
  return path.resolve(canonicalAncestor, ...missingSegments);
}

export function validateProfileDir(value, skillDir) {
  if (!value || !path.isAbsolute(value)) {
    throw new HarmonyBridgeError("invalid_profile_dir", "--profile-dir must be an absolute dedicated automation-profile path.");
  }
  const resolved = canonicalizePotentialPath(path.resolve(value));
  const resolvedSkill = canonicalizePotentialPath(path.resolve(skillDir));
  const resolvedHome = canonicalizePotentialPath(path.resolve(os.homedir()));
  if (resolved === resolvedSkill || resolved.startsWith(`${resolvedSkill}${path.sep}`)) {
    throw new HarmonyBridgeError("invalid_profile_dir", "The automation profile must live outside the installed skill.");
  }
  if (resolved === path.parse(resolved).root || resolved === resolvedHome) {
    throw new HarmonyBridgeError("unsafe_profile_dir", "Choose a dedicated automation directory, not a filesystem root or home directory.");
  }
  const segments = resolved.toLowerCase().replaceAll("\\", "/").split("/").filter(Boolean);
  const normalProfileSequences = [
    ["google-chrome"],
    ["chromium"],
    ["google", "chrome"],
    ["microsoft-edge"],
    ["microsoft", "edge"],
    ["brave-browser"],
    ["bravesoftware"],
  ];
  const containsSequence = (sequence) => segments.some(
    (_, start) => sequence.every((segment, offset) => segments[start + offset] === segment),
  );
  if (normalProfileSequences.some(containsSequence)) {
    throw new HarmonyBridgeError("unsafe_profile_dir", "Do not use a normal Chrome, Chromium, Edge, or Brave profile; choose a dedicated automation directory.");
  }
  return resolved;
}

export function isAuthenticationUrl(value) {
  try {
    const url = new URL(value);
    const isWixHost = url.hostname === "wix.com" || url.hostname.endsWith(".wix.com");
    return isWixHost && (url.hostname === "users.wix.com" || /\/(login|signin)(\/|$)/i.test(url.pathname));
  } catch {
    return false;
  }
}

export function sanitizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return null;
  }
}

export async function waitForHarmony(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const debug = window.repluggableAppDebug;
      if (!debug?.utils || typeof debug.utils.unReadyEntryPoints !== "function") return false;
      if (debug.utils.unReadyEntryPoints().length !== 0) return false;
      return typeof window.__OdeditorE2EApi__ !== "undefined";
    },
    undefined,
    { timeout: timeoutMs },
  );
}

export async function readHarmonyReadiness(page) {
  return page.evaluate(() => {
    const harmonyMarker = typeof window.__OdeditorE2EApi__ !== "undefined";
    const readUnready = window.repluggableAppDebug?.utils?.unReadyEntryPoints;
    if (typeof readUnready !== "function") {
      return {
        harmonyMarker,
        readinessApi: false,
        unreadyEntryPoints: null,
        editorReady: false,
      };
    }
    try {
      const unready = readUnready();
      const unreadyEntryPoints = Array.isArray(unready) ? unready.map(String) : [];
      return {
        harmonyMarker,
        readinessApi: true,
        unreadyEntryPoints,
        editorReady: harmonyMarker && unreadyEntryPoints.length === 0,
      };
    } catch (error) {
      return {
        harmonyMarker,
        readinessApi: true,
        unreadyEntryPoints: null,
        editorReady: false,
        readinessError: error?.message || String(error),
      };
    }
  });
}

const editorApiPredicate = () => {
  try {
    const api = window.repluggableAppDebug.host.getAPI({
      name: "RunEditorLLMCodeToolAPI",
      public: true,
      layer: "DATA_SERVICE",
    });
    return typeof api?.listNamespacesMetadata === "function" && typeof api?.execute === "function";
  } catch {
    return false;
  }
};

export async function waitForEditorApi(page, timeoutMs) {
  await page.waitForFunction(editorApiPredicate, undefined, { timeout: timeoutMs });
}

export async function readLiveEditorSnapshot(page, { includeNamespaces = false, includeMethodDocs = false } = {}) {
  return page.evaluate(async (options) => {
    const harmonyMarker = typeof window.__OdeditorE2EApi__ !== "undefined";
    const readUnready = window.repluggableAppDebug?.utils?.unReadyEntryPoints;
    let readinessApi = typeof readUnready === "function";
    let unreadyEntryPoints = null;
    let readinessError;
    if (readinessApi) {
      try {
        const unready = readUnready();
        unreadyEntryPoints = Array.isArray(unready) ? unready.map(String) : [];
      } catch (error) {
        readinessError = error?.message || String(error);
      }
    }
    const editorReady = harmonyMarker
      && readinessApi
      && !readinessError
      && unreadyEntryPoints.length === 0;
    const snapshot = {
      harmonyMarker,
      readinessApi,
      unreadyEntryPoints,
      editorReady,
      apiReady: false,
    };
    if (readinessError) snapshot.readinessError = readinessError;
    if (!editorReady) return snapshot;
    let api;
    try {
      api = window.repluggableAppDebug.host.getAPI({
        name: "RunEditorLLMCodeToolAPI",
        public: true,
        layer: "DATA_SERVICE",
      });
    } catch {
      return snapshot;
    }
    snapshot.apiReady = typeof api?.listNamespacesMetadata === "function" && typeof api?.execute === "function";
    if (!snapshot.apiReady || !options.includeNamespaces) return snapshot;
    try {
      snapshot.namespaces = await api.listNamespacesMetadata({ includeMethodDocs: options.includeMethodDocs });
    } catch (error) {
      snapshot.metadataError = error?.message || String(error);
    }
    return snapshot;
  }, { includeNamespaces: Boolean(includeNamespaces), includeMethodDocs: Boolean(includeMethodDocs) });
}

export function decodeItem(item) {
  try {
    return { status: item.status, contentType: "json", parsedContent: JSON.parse(item.content) };
  } catch {
    return { status: item.status, contentType: "text", rawContent: item.content };
  }
}

export function decodeExecuteResult(result) {
  return { ...result, items: Array.isArray(result?.items) ? result.items.map(decodeItem) : [] };
}

export async function loadPackagePlaywright() {
  return require("playwright");
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return true;
  }
}

function publishExclusiveFile(filePath, serialized) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, serialized, { mode: 0o600, flag: "wx" });
  try {
    fs.linkSync(temporaryPath, filePath);
  } finally {
    fs.unlinkSync(temporaryPath);
  }
}

function acquireProfileMutationGuard(lockPath) {
  const guard = {
    pid: process.pid,
    token: randomUUID(),
    guardPath: `${lockPath}.guard`,
  };
  try {
    publishExclusiveFile(guard.guardPath, `${JSON.stringify(guard)}\n`);
    return guard;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new HarmonyBridgeError(
      "profile_in_use",
      `The automation profile lock is being changed by another bridge, or an interrupted guard remains: ${guard.guardPath}. Verify no bridge is using the profile before removing the guard.`,
    );
  }
}

function releaseProfileMutationGuard(guard) {
  try {
    const current = JSON.parse(fs.readFileSync(guard.guardPath, "utf8"));
    if (current.pid !== guard.pid || current.token !== guard.token) {
      throw new Error("guard ownership changed");
    }
    fs.unlinkSync(guard.guardPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw new HarmonyBridgeError(
      "profile_lock_corrupt",
      `The automation profile mutation guard could not be released safely: ${guard.guardPath}.`,
    );
  }
}

export function acquireProfileLock(profileDir) {
  const canonicalProfileDir = canonicalizePotentialPath(path.resolve(profileDir));
  const lockPath = `${canonicalProfileDir}.wix-harmony.lock`;
  const lock = { pid: process.pid, token: randomUUID(), profileDir: canonicalProfileDir };
  const guard = acquireProfileMutationGuard(lockPath);
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        publishExclusiveFile(lockPath, `${JSON.stringify(lock)}\n`);
        acquired = true;
        return { ...lock, lockPath };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let serialized;
        try {
          serialized = fs.readFileSync(lockPath, "utf8");
        } catch (readError) {
          if (readError.code === "ENOENT") continue;
          throw new HarmonyBridgeError(
            "profile_in_use",
            `The automation profile lock is unreadable: ${lockPath}. Verify no bridge is using it before removing the lock.`,
          );
        }
        let existing = null;
        if (serialized.trim()) {
          try {
            existing = JSON.parse(serialized);
          } catch {
            throw new HarmonyBridgeError(
              "profile_in_use",
              `The automation profile lock is unreadable: ${lockPath}. Verify no bridge is using it before removing the lock.`,
            );
          }
        }
        const isStale = !existing
          || (Number.isInteger(existing.pid) && existing.pid > 0 && !processIsAlive(existing.pid));
        if (isStale) {
          // Every compliant publisher holds the mutation guard, so the lock cannot be
          // replaced between this exact-byte check and the unlink.
          let current;
          try {
            current = fs.readFileSync(lockPath, "utf8");
          } catch (readError) {
            if (readError.code === "ENOENT") continue;
            throw readError;
          }
          if (current !== serialized) continue;
          fs.unlinkSync(lockPath);
          continue;
        }
        throw new HarmonyBridgeError(
          "profile_in_use",
          `The automation profile is already in use by process ${existing.pid || "unknown"}. Close that bridge or choose another dedicated profile.`,
        );
      }
    }
    throw new HarmonyBridgeError("profile_in_use", "The automation profile could not be locked safely.");
  } finally {
    try {
      releaseProfileMutationGuard(guard);
    } catch (error) {
      if (acquired) releaseProfileLock({ ...lock, lockPath });
      throw error;
    }
  }
}

export function releaseProfileLock(lock) {
  if (!lock?.lockPath) return;
  try {
    const current = JSON.parse(fs.readFileSync(lock.lockPath, "utf8"));
    if (current.pid === lock.pid && current.token === lock.token) fs.unlinkSync(lock.lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new HarmonyBridgeError(
        "profile_lock_corrupt",
        `The automation profile lock could not be released safely: ${lock.lockPath}.`,
      );
    }
  }
}

export async function launchPersistentEditor({ profileDir, headless = false, playwrightLoader = loadPackagePlaywright }) {
  if (headless) {
    throw new HarmonyBridgeError("invalid_arguments", "Wix Harmony requires headed Chromium so authentication can be completed safely.");
  }
  const profileLock = acquireProfileLock(profileDir);
  let context;
  try {
    const { chromium } = await playwrightLoader();
    context = await chromium.launchPersistentContext(profileLock.profileDir, { headless: false });
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    return { context, page, profileLock };
  } catch (error) {
    if (context) {
      try {
        await context.close();
      } catch (cleanupError) {
        error.message = `${error.message} Context cleanup failed; the profile lock was retained at ${profileLock.lockPath}: ${cleanupError.message}`;
        throw error;
      }
    }
    try {
      releaseProfileLock(profileLock);
    } catch (cleanupError) {
      error.message = `${error.message} Profile-lock cleanup also failed: ${cleanupError.message}`;
    }
    throw error;
  }
}

export function executableExists(playwright) {
  const executable = playwright?.chromium?.executablePath?.();
  return Boolean(executable && fs.existsSync(executable));
}
