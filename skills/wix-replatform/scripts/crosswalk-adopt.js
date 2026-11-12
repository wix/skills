#!/usr/bin/env node
'use strict';

// Adopt a quick-mode crosswalk into the standard crosswalk for adopt-only import tasks.
//
//   node scripts/crosswalk-adopt.js --project-dir <dir> [--dry-run] [--site-id <id>]
//       [--source <file>] [--adapter <quick adapter id>] [--bindings <json file>]
//
// Reads state/crosswalk/<adapter id>.json (the adapter id comes from state/quick-import-started.json),
// takes the adopted refs and their keys from the approved mapping plan (`adopt-only-no-writes`) and the
// execution manifest when present, and appends the missing rows to state/crosswalk/crosswalk.ndjson.
// Idempotent; never overwrites a row. Prints ids and counts only. Exit 2 when it reports conflicts.

const fs = require('node:fs');
const path = require('node:path');
const { adoptCrosswalk, deriveBindings } = require('../lib/crosswalk-adoption.js');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === 'dryRun') args.dryRun = true; else { args[key] = argv[i + 1]; i += 1; }
  }
  return args;
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectDir) throw new Error('Usage: node scripts/crosswalk-adopt.js --project-dir <dir> [--dry-run] [--site-id <id>] [--source <file>] [--adapter <id>] [--bindings <file>]');
  const projectDir = path.resolve(args.projectDir);
  const started = fs.existsSync(path.join(projectDir, 'state', 'quick-import-started.json')) ? readJson(path.join(projectDir, 'state', 'quick-import-started.json')) : {};
  const adapterId = args.adapter || started.adapter?.id;
  if (!adapterId && !(args.source && args.bindings)) throw new Error('no quick adapter id: pass --adapter, or --source with --bindings');
  const sourceFile = path.resolve(args.source || path.join(projectDir, 'state', 'crosswalk', `${adapterId}.json`));
  const contractFile = path.join(__dirname, '..', 'resources', `rp-${adapterId}`, 'quick-mode.json');
  const bindings = args.bindings ? readJson(path.resolve(args.bindings)) : deriveBindings(projectDir, { contract: readJson(contractFile) });
  if (!bindings.length) throw new Error('no adopt-only entity in mapping/mapping-plan.json maps to a quick adapter section');
  let siteId = args.siteId;
  if (!siteId && !args.dryRun) {
    const destination = path.join(projectDir, 'orchestration', 'destination.json');
    siteId = fs.existsSync(destination) ? readJson(destination).metaSiteId : undefined;
  }
  const result = await adoptCrosswalk({ projectDir, sourceFile, bindings, siteId, dryRun: args.dryRun === true });
  console.log(JSON.stringify({ siteId: siteId || null, ...result }, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
