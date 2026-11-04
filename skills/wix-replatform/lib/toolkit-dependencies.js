'use strict';

// Third-party packages the skill's own scripts load. They ship inside the skill under vendor/,
// because an installed skill (`npx skills add`) has no package.json and no node_modules.
const path = require('node:path');

const VENDORED = Object.freeze({ commander: path.join(__dirname, '..', 'vendor', 'commander') });

const FIX = 'The installed wix-replatform skill is incomplete or this Node.js is too old: reinstall the skill with `npx skills add wix/skills/skills/wix-replatform` and use Node.js 22.12 or newer.';

// Names of vendored packages that do not load. Loading (not just resolving) also catches a Node
// too old to require() an ES module.
function missingToolkitDependencies(loadModule = (name) => require(VENDORED[name])) {
  return Object.keys(VENDORED).filter((name) => {
    try { loadModule(name); return false; } catch { return true; }
  });
}

module.exports = { VENDORED, FIX, missingToolkitDependencies };
