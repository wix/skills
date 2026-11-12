#!/usr/bin/env node
'use strict';

// CMS-fallback plumbing for plugin capabilities, as one deterministic command:
//
//   node scripts/cms-fallback.js digest     --project-dir <dir>
//       Current resolution-input digest and which artifact (if any) is stale.
//   node scripts/cms-fallback.js stamp-plan --project-dir <dir> --plan mapping|setup
//       Copy inputs.cmsFallbackDigest into mapping/mapping-plan.json (from
//       discovery/plugin-coverage.json) or setup/setup-plan.json (from the mapping plan).
//   node scripts/cms-fallback.js guard      --project-dir <dir> [--capability <id>]
//       The write-time guard: which eligible capabilities may have CMS records written.
//       Exit 2 when the named capability (or, without --capability, any capability whose coverage
//       row still claims an approved CMS plan) is refused.
//
// Optional on every command: --plugins-root <dir> --target-knowledge-root <dir> (fixture trees).

const fs = require('node:fs');
const path = require('node:path');
const {
  checkCmsFallbackFreshness,
  cmsFallbackWriteGuard,
  stampPlanDigest,
} = require('../lib/plugin-cms-fallback.js');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    args[token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
    i += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readDecisions(projectDir) {
  try {
    return readJson(path.join(projectDir, 'orchestration', 'decisions.json'));
  } catch {
    return {};
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || !args.projectDir) {
    console.error('Usage: node scripts/cms-fallback.js digest|stamp-plan|guard --project-dir <dir> [--plan mapping|setup] [--capability <id>]');
    process.exit(1);
  }
  const projectDir = path.resolve(args.projectDir);
  const overrides = {
    pluginsRoot: args.pluginsRoot ? path.resolve(args.pluginsRoot) : undefined,
    targetKnowledgeRoot: args.targetKnowledgeRoot ? path.resolve(args.targetKnowledgeRoot) : undefined,
  };

  if (command === 'digest') {
    const result = checkCmsFallbackFreshness(projectDir, { decisions: readDecisions(projectDir), ...overrides });
    console.log(JSON.stringify({ ok: true, ...(result || { digest: null, stale: null, reason: 'no plugin coverage' }) }, null, 2));
    return;
  }
  if (command === 'stamp-plan') {
    console.log(JSON.stringify({ ok: true, ...stampPlanDigest(projectDir, args.plan) }, null, 2));
    return;
  }
  if (command === 'guard') {
    const result = cmsFallbackWriteGuard(projectDir, { ...overrides, attempted: args.capability ? [args.capability] : null });
    const refused = result.refusals;
    console.log(JSON.stringify({ ok: refused.length === 0, ...result }, null, 2));
    if (refused.length > 0) process.exitCode = 2;
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
}
