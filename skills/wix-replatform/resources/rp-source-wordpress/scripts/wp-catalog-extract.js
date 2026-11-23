#!/usr/bin/env node
'use strict';

// Run the WooCommerce/WordPress reader catalog for a project and write data/source-extract.
// Reads only; never writes to Wix.
//
//   node wp-catalog-extract.js --project <dir> [--entity a,b | --all] [--sample] [--list] [--install]
//        [--progress-log <path>] [--run-id <id>]
//
// --entity  ids from reader-catalog.json or the project's src/extract/reader-catalog.extra.json
//           (a child id such as product-variation re-reads its parent). Default: the plan's
//           executionScope.resolvedEntityRefs (else selectedEntityRefs) that have a reader, plus
//           derived entries; ids with no reader are reported as failed (reader_missing).
// --all     every catalog reader, optional ones included (the toolkit's background extract at
//           discovery end, lib/source-extract-background.js); a route the store lacks reads 0 records
// --sample  first few records of each entity into data/source-extract/sample/ (no manifest, no ledger)
// --list    print the merged catalog ids, routes and the plan filter each one gets, then exit
// --install codegen's extract step: vendor the extractor into the project and write the fixed
//           src/extract/run-extract.js (generated-plugin-handoff.js emitCatalogExtract), then exit
// Exit: 0 all extracted; 1 some failed; 2 usage or config error. Prints JSON (no source values).

const fs = require('node:fs');
const path = require('node:path');
const { parseProgressArgs, createProgressLogger } = require('../../../lib/progress-log.js');
const { createCatalogExtractor, loadSourceEnv } = require('../lib/catalog-extractor.js');

function parseArgs(argv) {
  const args = { project: null, entity: null, all: false, sample: false, list: false, install: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--entity') args.entity = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--all') args.all = true;
    else if (a === '--sample') args.sample = true;
    else if (a === '--list') args.list = true;
    else if (a === '--install') args.install = true;
    else throw Object.assign(new Error(`unknown argument: ${a}`), { usage: true });
  }
  if (!args.project) throw Object.assign(new Error('--project is required'), { usage: true });
  return args;
}

function planScope(projectDir) {
  try {
    const plan = JSON.parse(fs.readFileSync(path.join(projectDir, 'mapping', 'mapping-plan.json'), 'utf8'));
    return plan.executionScope?.resolvedEntityRefs || plan.executionScope?.selectedEntityRefs || null;
  } catch { return null; }
}

async function main() {
  const { args: rest, progress: p } = parseProgressArgs(process.argv.slice(2));
  const args = parseArgs(rest);
  const projectDir = path.resolve(args.project);
  if (args.install) return { code: 0, out: require('../../../lib/generated-plugin-handoff.js').emitCatalogExtract(projectDir) };
  if (args.list) {
    const x = createCatalogExtractor({ projectDir, env: {} });
    return { code: 0, out: { entities: x.entries.map((e) => ({ id: e.id, route: e.route || e.reader || `derived:${e.from}`, target: e.target ?? null, filter: e.kind === 'derived' ? {} : x.planFilter(e.id) })) } };
  }
  const progress = createProgressLogger({ script: 'wp-catalog-extract', progressLog: p.progressLog || path.join(projectDir, 'execution', 'progress.ndjson'), runId: p.runId, parentRunId: p.parentRunId });
  const extractor = createCatalogExtractor({ projectDir, env: await loadSourceEnv(projectDir), progress });
  let ids = args.entity || (args.all ? extractor.entries.map((e) => e.id) : planScope(projectDir));
  if (ids && !args.entity && !args.all) ids = [...ids, ...extractor.entries.filter((e) => e.kind === 'derived').map((e) => e.id)];
  const results = await extractor.extractAll(ids || undefined, { sample: args.sample });
  return { code: results.some((r) => r.status === 'failed') ? 1 : 0, out: { results } };
}

main().then(({ code, out }) => { console.log(JSON.stringify(out, null, 2)); process.exitCode = code; }, (error) => {
  console.log(JSON.stringify({ ok: false, error: error.code || (error.usage ? 'usage' : 'extract_failed'), message: String(error.message).slice(0, 300) }));
  process.exitCode = 2;
});
