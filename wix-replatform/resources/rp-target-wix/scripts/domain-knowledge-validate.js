#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { knowledgeRoot, validateKnowledge, writeJson, listMissingDependsOn, checkScope } = require('../lib/domain-knowledge.js');

function main() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const domainsDir = knowledgeRoot(path.resolve(__dirname, '..'));

  if (args.has('--list-missing-deps')) {
    // Spec 0041's live backlog — entities that have never had dependsOn authored at all.
    // Non-blocking report, not a validation error; this is the thing to run instead of
    // trusting a hand-maintained list to stay accurate.
    const missing = listMissingDependsOn(domainsDir);
    process.stdout.write(`${missing.length} entit${missing.length === 1 ? 'y has' : 'ies have'} no dependsOn yet:\n`);
    for (const ref of missing) process.stdout.write(`  ${ref}\n`);
    return;
  }

  const checkScopeIndex = argv.indexOf('--check-scope');
  if (checkScopeIndex !== -1) {
    // Spec 0041's rp-mapper review-gate check: pass only the plan's own selected scope — checkScope
    // walks the transitive closure itself. --check-scope stores/product,gift-cards/gift-card,ecom/order
    const inScopeRefs = (argv[checkScopeIndex + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (inScopeRefs.length === 0) {
      process.stderr.write('ERROR: --check-scope requires a comma-separated list of domain/entity refs\n');
      process.exit(1);
    }
    const result = checkScope(domainsDir, inScopeRefs);
    if (result.ok) {
      process.stdout.write('OK: every selected ref resolves, every reachable dependency is in scope, and every reachable entity has been reviewed\n');
      return;
    }
    for (const ref of result.unknownRefs) {
      process.stdout.write(`UNKNOWN: ${ref} does not resolve to a real domain/entity file\n`);
    }
    for (const { ref, missing } of result.missingDependencies) {
      process.stdout.write(`MISSING: ${ref} depends on ${missing.join(', ')}, not in scope for this plan\n`);
    }
    for (const ref of result.unreviewedRefs) {
      process.stdout.write(`UNREVIEWED: ${ref} is reachable from this scope but has never had dependsOn authored\n`);
    }
    process.exit(1);
  }

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
