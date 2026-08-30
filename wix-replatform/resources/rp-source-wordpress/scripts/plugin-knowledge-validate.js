#!/usr/bin/env node
'use strict';

// Repository-health check for the plugin profile knowledge base. Kept separate from
// plugin-knowledge.js (read access) for the same reason domain-knowledge-validate.js is
// separate from domain-knowledge.js: validation checks the repo, read access serves lookups.

const path = require('node:path');
const {
  pluginsRoot,
  validateKnowledge,
  writeJson,
} = require('../lib/plugin-knowledge.js');
const {
  knowledgeRoot: domainsRoot,
  knowledgeSummary,
} = require('../../rp-target-wix/lib/domain-knowledge.js');

function main() {
  const writeIndex = process.argv.includes('--write-index');
  const pluginsDir = pluginsRoot();

  let targetKnowledge = null;
  try {
    targetKnowledge = knowledgeSummary(domainsRoot(path.resolve(__dirname, '..', '..', 'rp-target-wix')));
  } catch (error) {
    console.error(`WARNING: could not load Wix target knowledge for cross-adapter checks: ${error.message}`);
  }

  if (writeIndex) {
    // Write the index first so the staleness check in validateKnowledge reflects the
    // regenerated file rather than reporting the state we are about to fix.
    const { generatedIndex } = validateKnowledge(pluginsDir, { targetKnowledge });
    writeJson(path.join(pluginsDir, 'index.json'), generatedIndex);
  }

  const result = validateKnowledge(pluginsDir, { targetKnowledge });
  if (!result.ok) {
    console.error(`FAIL: plugin knowledge validation found ${result.errors.length} problem(s)`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(
    writeIndex
      ? `OK: plugin knowledge index regenerated and valid (${result.profileCount} profile(s))`
      : `OK: plugin knowledge valid (${result.profileCount} profile(s))`,
  );
}

main();
