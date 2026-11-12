#!/usr/bin/env node
'use strict';

// The site's CMS item quota against the rows this import will create.
//
//   node skills/wix-replatform/scripts/cms-item-quota.js plan   --project-dir <dir> --expected-rows <n>
//   node skills/wix-replatform/scripts/cms-item-quota.js status --project-dir <dir>
//   node skills/wix-replatform/scripts/cms-item-quota.js skip   --project-dir <dir> --collection <id> [--collection <id>] --decided-by <name> --reason <why>
//   node skills/wix-replatform/scripts/cms-item-quota.js unskip --project-dir <dir>
//
// `plan` reads the quota (Site Data Usage) and writes execution/cms-item-quota-plan.json, the
// line the plan shows before consent. It never blocks: a quota it cannot read is `unknown`, and
// a shortfall is a hold-and-resume plus a cutover task, not a refusal. `status` prints the hold
// and its cutover action, if any. `skip` records the operator's explicit decision that the
// waiting data of the named archive collections is not needed (who and why; later archive items are journaled
// skipped_out_of_scope, never silently dropped); `unskip` undoes it. None writes to the site.

const fs = require('node:fs');
const path = require('node:path');
const quota = require('../resources/rp-target-wix/lib/cms-item-quota.js');

const PLAN_FILE = 'execution/cms-item-quota-plan.json';

function readEnv(projectDir) {
  const raw = fs.readFileSync(path.join(projectDir, 'config', 'wix.env'), 'utf8');
  return Object.fromEntries(raw.split(/\r?\n/).map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(([, key, value]) => [key, value.trim()]));
}

async function plan(projectDir, expectedRows, { wix = null } = {}) {
  let client = wix;
  if (!client) {
    const env = readEnv(projectDir);
    const wixAuth = require('../lib/wix-auth.js');
    const writers = require('../resources/rp-target-wix/lib/wix-writers.js');
    client = writers.createWixClient({ siteId: env.WIX_SITE_ID, tokenSource: wixAuth.createWixTokenSource({ projectDir, siteId: env.WIX_SITE_ID }) });
  }
  const line = quota.quotaPlanLine({ expectedRows, quota: await quota.readCmsItemQuota(client) });
  const file = path.join(projectDir, PLAN_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, ...line }, null, 2)}\n`);
  return line;
}

function parseArgs(argv) {
  const args = { command: argv[0] };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--project-dir') args.projectDir = path.resolve(argv[++i]);
    else if (argv[i] === '--expected-rows') args.expectedRows = Number(argv[++i]);
    else if (argv[i] === '--collection') (args.collectionIds = args.collectionIds || []).push(argv[++i]);
    else if (argv[i] === '--decided-by') args.decidedBy = argv[++i];
    else if (argv[i] === '--reason') args.reason = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectDir || !['plan', 'status', 'skip', 'unskip'].includes(args.command)) throw new Error('usage: cms-item-quota.js plan|status|skip|unskip --project-dir <dir> [--expected-rows <n>] [--collection <id> --decided-by <name> --reason <why>]');
  if (args.command === 'plan') console.log(JSON.stringify(await plan(args.projectDir, args.expectedRows), null, 2));
  else if (args.command === 'skip') console.log(JSON.stringify(quota.recordArchiveSkip(args.projectDir, { decidedBy: args.decidedBy, reason: args.reason, collectionIds: args.collectionIds }), null, 2));
  else if (args.command === 'unskip') console.log(JSON.stringify(quota.clearArchiveSkip(args.projectDir), null, 2));
  else console.log(JSON.stringify({ hold: quota.readHold(args.projectDir), cutoverAction: quota.cutoverAction(args.projectDir) }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.message || error); process.exit(1); });
module.exports = { plan, PLAN_FILE };
