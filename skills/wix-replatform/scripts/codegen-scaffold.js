#!/usr/bin/env node
'use strict';

// The codegen scaffold (lib/codegen-scaffold.js). The route script already runs it when a run
// enters codegen; run it by hand after a plan change, or to restore a changed scaffold file.
// Offline: reads the plan and the toolkit, writes src/import/{handlers,hooks} and src/lib copies.
//
//   node scripts/codegen-scaffold.js --project <dir>            write or refresh (hook bodies kept)
//   node scripts/codegen-scaffold.js --project <dir> --verify   list changes outside hook bodies
//   node scripts/codegen-scaffold.js --project <dir> --restore  put the toolkit's version back
//   node scripts/codegen-scaffold.js --project <dir> --release <entity> --reason "<why>"
//        the escape hatch: the entity's handler is yours to replace; reported as a toolkit finding
// Exit: 0 ok; 1 findings (--verify); 2 usage error.

const path = require('node:path');
const scaffold = require('../lib/codegen-scaffold.js');

function main(argv) {
  const at = argv.indexOf('--project');
  const dir = at >= 0 ? argv[at + 1] : null;
  if (!dir) { console.error('usage: codegen-scaffold.js --project <dir> [--verify|--restore]'); return 2; }
  const projectDir = path.resolve(dir);
  if (argv.includes('--verify')) {
    const findings = scaffold.verifyScaffold(projectDir, { repair: false });
    console.log(JSON.stringify({ findings }, null, 2));
    return findings.length ? 1 : 0;
  }
  if (argv.includes('--release')) {
    const entity = argv[argv.indexOf('--release') + 1];
    const reason = argv.includes('--reason') ? argv[argv.indexOf('--reason') + 1] : '';
    if (!entity || !reason) { console.error('usage: codegen-scaffold.js --project <dir> --release <entity> --reason "<why>"'); return 2; }
    const row = scaffold.releaseScaffold(projectDir, entity, reason);
    if (!row) { console.error(`no scaffolded entity ${entity}`); return 2; }
    console.log(JSON.stringify({ released: row.sourceEntity, handler: row.handlerPath, reason: row.released.reason }, null, 2));
    return 0;
  }
  if (argv.includes('--restore')) { console.log(JSON.stringify(scaffold.restoreScaffold(projectDir), null, 2)); return 0; }
  const result = scaffold.writeScaffold(projectDir);
  console.log(JSON.stringify({ ...result, entities: result.entities.map((e) => ({ sourceEntity: e.sourceEntity, handler: e.handlerPath || null, hooks: e.hooksPath || null, hookRows: (e.hooks || []).map((h) => h.id), existingHandler: e.existingHandler })) }, null, 2));
  return result.ok ? 0 : 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main };
