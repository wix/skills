#!/usr/bin/env node
'use strict';

// Import a record now without one link whose parent record did not land (an operator choice).
//
//   node skills/wix-replatform/scripts/link-waiver.js list   --project-dir <dir> [--task <id>]
//   node skills/wix-replatform/scripts/link-waiver.js record --project-dir <dir> --task <id> --ref <ref>
//        --record <dependent source key> [--record ...] --parent <dependency source key>
//        (the key of the record the dependent links to: a variant's own key, not its product's)
//        --decided-by <who> --reason <why> [--explicit-request --warning <text shown to the user>]
//
// `list` prints the records the gate holds as dependency-parent-final, with each link's choice:
// `offer-omit` (the cutover task offers importing without the link) or `fix-only` (not offered;
// only on an explicit request, after the warning, with --explicit-request --warning). A link the
// target cannot do without is refused. `record` writes execution/link-waivers.json; the next
// --deferred-only pass of the task writes those records without the link. Nothing here writes to
// the site.

const path = require('node:path');
const fs = require('node:fs');
const waivers = require('../lib/link-waivers.js');
function parseArgs(argv) {
  const args = { command: argv[0], records: [] };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--project-dir') args.projectDir = path.resolve(argv[++i]);
    else if (flag === '--task') args.taskId = argv[++i];
    else if (flag === '--ref') args.ref = argv[++i];
    else if (flag === '--record') args.records.push(argv[++i]);
    else if (flag === '--parent') args.parent = argv[++i];
    else if (flag === '--decided-by') args.decidedBy = argv[++i];
    else if (flag === '--reason') args.reason = argv[++i];
    else if (flag === '--explicit-request') args.explicitRequest = true;
    else if (flag === '--warning') args.warning = argv[++i];
    else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}
function diagnostic(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, 'execution/dependency-readiness.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { tasks: {} }; throw error; }
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectDir || !['list', 'record'].includes(args.command)) throw new Error('usage: link-waiver.js list|record --project-dir <dir> ...');
  const tasks = diagnostic(args.projectDir).tasks || {};
  if (args.command === 'list') {
    console.log(JSON.stringify(Object.values(tasks).filter(task => !args.taskId || task.taskId === args.taskId).flatMap(task => (task.finalDeferrals || []).map(row => ({ taskId: task.taskId, ...row }))), null, 2)); return;
  }
  const task = tasks[args.taskId];
  if (!task || !args.ref || !args.parent || !args.records.length) throw new Error('record needs --task, --ref, --record and --parent');
  const rows = args.records.map(sourceStableKey => ({ sourceStableKey, ref: args.ref, dependencySourceKey: args.parent }));
  console.log(JSON.stringify(waivers.recordLinkWaiver({ projectDir: args.projectDir, siteId: task.siteId, taskId: args.taskId, rows, decidedBy: args.decidedBy, reason: args.reason, explicitRequest: args.explicitRequest === true, warning: args.warning || null }), null, 2));
}
try { main(); } catch (error) { console.error(error.code ? `${error.code}: ${error.message}` : error.message); process.exit(1); }
