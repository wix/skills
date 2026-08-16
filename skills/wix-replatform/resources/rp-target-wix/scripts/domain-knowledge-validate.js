#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { knowledgeRoot, validateKnowledge, writeJson } = require('../lib/domain-knowledge.js');

function main() {
  const args = new Set(process.argv.slice(2));
  const domainsDir = knowledgeRoot(path.resolve(__dirname, '..'));
  const result = validateKnowledge(domainsDir);

  if (args.has('--write-index')) {
    writeJson(path.join(domainsDir, 'index.json'), result.generatedIndex);
    const afterWrite = validateKnowledge(domainsDir);
    if (!afterWrite.ok) {
      for (const error of afterWrite.errors) process.stderr.write(`ERROR: ${error}\n`);
      process.exit(1);
    }
    process.stdout.write('OK: domain knowledge index regenerated and valid\n');
    return;
  }

  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`ERROR: ${error}\n`);
    process.exit(1);
  }

  process.stdout.write('OK: domain knowledge valid\n');
}

main();
