'use strict';
// Preloaded (`node --require`) into the design-md-generator process. That generator is a separate CLI that
// launches its own Chromium and navigates to the source URL, so it cannot call the in-process guard. This hook
// wraps Playwright's launch so every context/page it creates gets the same request guard as the other
// extractors: any navigation, redirect hop or subresource to a non-public destination is aborted.
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const guardModule = import(pathToFileURL(path.join(__dirname, 'url-safety.mjs')).href);
const guarded = new WeakSet();

async function guard(target) {
  if (guarded.has(target)) return target;
  guarded.add(target);
  const { guardPageRequests } = await guardModule;
  await guardPageRequests(target);
  return target;
}

function wrapBrowser(browser) {
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = async (...args) => guard(await newContext(...args));
  browser.newPage = async (...args) => guard(await newPage(...args));
  return browser;
}

function wrapChromium(chromium) {
  if (!chromium || chromium.__rpRequestGuard) return;
  chromium.__rpRequestGuard = true;
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => wrapBrowser(await launch(...args));
  if (chromium.launchPersistentContext) {
    const persistent = chromium.launchPersistentContext.bind(chromium);
    chromium.launchPersistentContext = async (...args) => guard(await persistent(...args));
  }
  if (chromium.connectOverCDP) {
    const connect = chromium.connectOverCDP.bind(chromium);
    chromium.connectOverCDP = async (...args) => wrapBrowser(await connect(...args));
  }
}

// Hook Module._load rather than Module.prototype.require: it is what `require()` calls, and also what the
// ESM loader calls when an ES module `import`s a CommonJS package such as playwright, so both CLI styles of
// the generator are covered. The ESM entry resolves to an absolute path, hence the substring match.
const originalLoad = Module._load;
Module._load = function patchedLoad(request) {
  const loaded = originalLoad.apply(this, arguments);
  if (typeof request === 'string' && request.includes('playwright')) {
    try {
      wrapChromium(loaded && loaded.chromium);
    } catch {
      /* an export that is not Playwright's */
    }
  }
  return loaded;
};
