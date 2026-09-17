#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXECUTION_BLOCKED,
  HarmonyBridgeError,
  isAuthenticationUrl,
  launchPersistentEditor,
  readHarmonyReadiness,
  readLiveEditorSnapshot,
  releaseProfileLock,
  sanitizeUrl,
  validateEditorUrl,
  validateProfileDir,
  waitForEditorApi,
  waitForHarmony,
} from "./lib/wix-harmony-browser.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, "..");

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  const valueOptions = new Set(["--editor-url", "--profile-dir", "--timeout-ms"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--headless") {
      throw new HarmonyBridgeError("invalid_arguments", "--headless is not supported; Wix Harmony authentication requires headed Chromium.");
    } else if (valueOptions.has(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new HarmonyBridgeError("invalid_arguments", `Missing value for ${token}.`);
      args[token.slice(2)] = token === "--timeout-ms" ? parseTimeoutMs(value) : value;
      index += 1;
    } else {
      throw new HarmonyBridgeError("invalid_arguments", `Unknown argument: ${token}`);
    }
  }
  return args;
}

export function parseTimeoutMs(value, fallback = 60_000) {
  const timeout = Number(value ?? fallback);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new HarmonyBridgeError("invalid_arguments", "--timeout-ms must be a positive finite number of milliseconds.");
  }
  return timeout;
}

export function createHarmonyBridge({ browserLauncher = launchPersistentEditor, timeoutMs = 60_000 } = {}) {
  let context;
  let page;
  let profileLock;
  let activeProfileDir;
  let harmonyReady = false;
  let editorReady = false;
  let apiReady = false;
  let authRequired = false;
  let editorUrl;
  let closingSession;
  const closedContexts = new WeakSet();
  const isReady = () => harmonyReady && editorReady && apiReady && !authRequired;
  const resetReadiness = () => {
    harmonyReady = false;
    editorReady = false;
    apiReady = false;
    authRequired = false;
  };
  const authenticationResult = (url = page.url()) => {
    resetReadiness();
    authRequired = true;
    return { state: "auth_required", url: sanitizeUrl(url), execution: EXECUTION_BLOCKED };
  };
  const currentUrl = () => {
    try {
      return page?.url?.() ?? null;
    } catch {
      return null;
    }
  };
  const detachSession = (expectedContext, expectedPage) => {
    if (expectedContext && context !== expectedContext) return undefined;
    if (expectedPage && page !== expectedPage) return undefined;
    const lock = profileLock;
    context = undefined;
    page = undefined;
    profileLock = undefined;
    activeProfileDir = undefined;
    resetReadiness();
    return lock;
  };
  const handleExternalContextClose = (closedContext) => {
    closedContexts.add(closedContext);
    if (context !== closedContext) return;
    try {
      releaseProfileLock(detachSession(closedContext));
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
    }
  };
  const handleExternalPageClose = (pageContext, closedPage) => {
    if (context !== pageContext || page !== closedPage) return;
    const lock = detachSession(pageContext, closedPage);
    const settle = (async () => {
      let closeSucceeded = false;
      let closeError;
      try {
        await pageContext.close();
        closeSucceeded = true;
      } catch (error) {
        closeError = error;
      }
      if (closeSucceeded || closedContexts.has(pageContext)) {
        try {
          releaseProfileLock(lock);
        } catch (error) {
          process.stderr.write(`${error.message}\n`);
        }
        if (closeError) process.stderr.write(`${closeError.message}\n`);
      } else if (closeError) {
        process.stderr.write(`${closeError.message} The profile lock was retained at ${lock?.lockPath} because the browser context may still be open.\n`);
      }
    })();
    const pending = settle.finally(() => {
      if (closingSession === pending) closingSession = undefined;
    });
    closingSession = pending;
  };
  // The bridge is not the only thing that can navigate or close the headed window, so an
  // earlier successful open is never evidence about the page in front of us now.
  const refreshLiveReadiness = async ({ includeNamespaces = false, includeMethodDocs = false } = {}) => {
    if (!page) return { ready: false, message: "Run open successfully before metadata." };
    const url = currentUrl();
    if (url && isAuthenticationUrl(url)) {
      authenticationResult(url);
      return {
        ready: false,
        message: "The live page is on Wix authentication; authenticate in the headed browser and run open again.",
      };
    }
    authRequired = false;
    let snapshot;
    try {
      snapshot = await readLiveEditorSnapshot(page, { includeNamespaces, includeMethodDocs });
    } catch (error) {
      resetReadiness();
      return { ready: false, message: `The live editor page could not be re-verified: ${error.message}` };
    }
    harmonyReady = Boolean(snapshot.harmonyMarker);
    editorReady = Boolean(snapshot.editorReady);
    if (!editorReady) {
      apiReady = false;
      return {
        ready: false,
        message: "The live page is no longer a ready Harmony editor; run open again before reading metadata.",
      };
    }
    apiReady = Boolean(snapshot.apiReady);
    if (!apiReady) {
      return {
        ready: false,
        message: "RunEditorLLMCodeToolAPI is no longer contributed by the live page; run open again before reading metadata.",
      };
    }
    if (snapshot.metadataError) {
      return { ready: false, code: "metadata_failed", message: `Namespace metadata failed: ${snapshot.metadataError}` };
    }
    return { ready: true, namespaces: snapshot.namespaces };
  };
  const requireLiveReadiness = async (options) => {
    const readiness = await refreshLiveReadiness(options);
    if (!readiness.ready) throw new HarmonyBridgeError(readiness.code || "editor_not_ready", readiness.message);
    return readiness;
  };

  return {
    async dispatch(command, defaults = {}) {
      if (closingSession) await closingSession;
      switch (command.action) {
        case "open": {
          editorUrl = validateEditorUrl(command.editorUrl || defaults.editorUrl);
          const profileDir = validateProfileDir(command.profileDir || defaults.profileDir, skillDir);
          const openTimeoutMs = parseTimeoutMs(command.timeoutMs ?? defaults.timeoutMs, timeoutMs);
          if (context && profileDir !== activeProfileDir) {
            throw new HarmonyBridgeError(
              "profile_mismatch",
              `The live browser uses ${activeProfileDir}; close it before opening a different profile.`,
            );
          }
          if (!context) {
            ({ context, page, profileLock } = await browserLauncher({ profileDir, headless: false }));
            activeProfileDir = profileDir;
            const openedContext = context;
            const openedPage = page;
            openedContext.once?.("close", () => handleExternalContextClose(openedContext));
            openedPage.once?.("close", () => handleExternalPageClose(openedContext, openedPage));
          }
          resetReadiness();
          await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
          if (isAuthenticationUrl(page.url())) {
            return authenticationResult();
          }
          try {
            await waitForHarmony(page, openTimeoutMs);
          } catch (error) {
            if (isAuthenticationUrl(page.url())) return authenticationResult();
            let diagnosis;
            try {
              diagnosis = await readHarmonyReadiness(page);
              harmonyReady = Boolean(diagnosis.harmonyMarker);
              editorReady = Boolean(diagnosis.editorReady);
            } catch {}
            if (!diagnosis?.harmonyMarker) {
              throw new HarmonyBridgeError("harmony_marker_timeout", `The positive Harmony marker never appeared: ${error.message}`);
            }
            if (!diagnosis.readinessApi) {
              throw new HarmonyBridgeError("harmony_entry_points_timeout", `Harmony was identified, but its readiness API never appeared: ${error.message}`);
            }
            if (!diagnosis.editorReady) {
              const detail = diagnosis.unreadyEntryPoints?.length
                ? ` Still unready: ${diagnosis.unreadyEntryPoints.slice(0, 20).join(", ")}.`
                : diagnosis.readinessError ? ` Readiness check failed: ${diagnosis.readinessError}.` : "";
              throw new HarmonyBridgeError("harmony_entry_points_timeout", `Harmony entry points did not become ready.${detail}`);
            }
            throw new HarmonyBridgeError("harmony_readiness_timeout", `Harmony readiness changed while the timeout was being diagnosed: ${error.message}`);
          }
          harmonyReady = true;
          editorReady = true;
          try {
            await waitForEditorApi(page, openTimeoutMs);
          } catch (error) {
            if (isAuthenticationUrl(page.url())) return authenticationResult();
            throw new HarmonyBridgeError("editor_api_timeout", `RunEditorLLMCodeToolAPI gate timed out: ${error.message}`);
          }
          const finalReadiness = await refreshLiveReadiness();
          if (!finalReadiness.ready) {
            if (authRequired) return authenticationResult(currentUrl());
            throw new HarmonyBridgeError(
              finalReadiness.code || "editor_not_ready",
              `The live page changed before open completed: ${finalReadiness.message}`,
            );
          }
          return {
            state: "ready",
            harmony: harmonyReady,
            editorReady,
            api: apiReady,
            authRequired,
            url: sanitizeUrl(page.url()),
            execution: EXECUTION_BLOCKED,
          };
        }
        case "metadata": {
          const readiness = await requireLiveReadiness({
            includeNamespaces: true,
            includeMethodDocs: command.includeMethodDocs,
          });
          return { namespaces: readiness.namespaces };
        }
        case "execute":
          return { ...EXECUTION_BLOCKED };
        case "status":
          await refreshLiveReadiness();
          return {
            state: authRequired ? "auth_required" : isReady() ? "ready" : context ? "open_not_ready" : "closed",
            process: context ? "open" : "closed",
            harmony: harmonyReady,
            editorReady,
            api: apiReady,
            authRequired,
            authentication: authRequired ? "required" : isReady() ? "authenticated" : context ? "unknown" : "not_open",
            url: sanitizeUrl(currentUrl() || editorUrl),
            execution: EXECUTION_BLOCKED,
          };
        case "close": {
          // Detach before closing so the external-close listener cannot swallow the lock
          // release that this caller is entitled to hear about.
          const live = context;
          const lock = detachSession();
          if (live) {
            try {
              await live.close();
            } catch (error) {
              if (closedContexts.has(live)) releaseProfileLock(lock);
              else {
                throw new HarmonyBridgeError(
                  "browser_close_failed",
                  `${error.message} The profile lock was retained at ${lock?.lockPath} because the browser context may still be open.`,
                );
              }
              throw error;
            }
          }
          releaseProfileLock(lock);
          return { state: "closed" };
        }
        default:
          throw new HarmonyBridgeError("unknown_action", `Unknown action: ${command.action || "<missing>"}`);
      }
    },
  };
}

export async function runBridgeProtocol({ bridge, input, defaults = {}, write = (record) => process.stdout.write(record) }) {
  try {
    for await (const line of input) {
      if (!line.trim()) continue;
      let command;
      try {
        command = JSON.parse(line);
        const result = await bridge.dispatch(command, defaults);
        write(`${JSON.stringify({ id: command.id ?? null, ok: true, result })}\n`);
        if (command.action === "close") break;
      } catch (error) {
        write(`${JSON.stringify({ id: command?.id ?? null, ok: false, error: serializeError(error) })}\n`);
      }
    }
  } finally {
    await bridge.dispatch({ action: "close" }, defaults);
  }
}

function serializeError(error) {
  const message = String(error.message || error).replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url) || "[redacted URL]");
  return { code: error.code || "bridge_error", message };
}

async function main() {
  const args = parseArgs();
  const defaults = {
    editorUrl: args["editor-url"],
    profileDir: args["profile-dir"],
    timeoutMs: args["timeout-ms"],
  };
  const bridge = createHarmonyBridge();
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  await runBridgeProtocol({ bridge, input, defaults });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
