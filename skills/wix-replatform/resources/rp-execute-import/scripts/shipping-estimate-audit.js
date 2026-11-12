#!/usr/bin/env node
'use strict';

// The finished-project shipping-estimate audit. Read-only against Wix: it GETs
// crosswalked shipping options and never POSTs or PATCHes. Locally it may upsert ONE crosswalk row
// per adopted `recreated:<id>` decision, then rewrites execution/shipping-estimates.json, the
// completion report's shipping operatorActions, and the post-execution handoff.
//
//   node skills/wix-replatform/resources/rp-execute-import/scripts/shipping-estimate-audit.js --project-dir <dir>
//   node skills/wix-replatform/resources/rp-execute-import/scripts/shipping-estimate-audit.js --project-dir <dir> --list <code>
//
// `--list <code>` makes no Wix call: it prints every option recorded under that operatorActions
// code in execution/shipping-estimates.json, for relaying a long list to the Cutover Operator.

const path = require('node:path');
const { readEnvFile } = require('../../../lib/config-env.js');
const { createWixClient } = require('../../rp-target-wix/lib/wix-writers.js');
const { runShippingEstimateAudit, listShippingEstimateItems } = require('../../rp-target-wix/lib/shipping-option-stage.js');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-dir') args.projectDir = argv[++i];
    else if (arg === '--list') args.list = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function wixFromProject(projectDir) {
  const env = await readEnvFile(path.join(projectDir, 'config', 'wix.env'));
  const authToken = env.WIX_AUTH_TOKEN || env.WIX_API_KEY;
  if (!authToken || !env.WIX_SITE_ID) throw new Error('config/wix.env must provide WIX_AUTH_TOKEN (or WIX_API_KEY) and WIX_SITE_ID');
  return createWixClient({ authToken, siteId: env.WIX_SITE_ID });
}

async function main(argv = process.argv.slice(2), { wix = null, log = console.log } = {}) {
  const args = parseArgs(argv);
  if (args.help || !args.projectDir) {
    log('Usage: shipping-estimate-audit.js --project-dir <dir> [--list <code>]');
    return { ok: Boolean(args.help) };
  }
  const projectDir = path.resolve(args.projectDir);
  if (args.list) {
    const items = await listShippingEstimateItems(projectDir, args.list);
    log(JSON.stringify({ ok: true, code: args.list, count: items.length, items }, null, 2));
    return { ok: true, items };
  }
  const client = wix || await wixFromProject(projectDir);
  const result = await runShippingEstimateAudit(client, { projectDir });
  log(JSON.stringify({
    ok: true,
    operatorActions: result.fragment.operatorActions.map((row) => ({ code: row.code, affectedCount: row.affectedCount })),
    crosswalkUpserts: result.audit.crosswalkUpserts.length,
    completionReportUpdated: Boolean(result.completionReport),
    handoff: result.handoff ? { ok: result.handoff.ok, reason: result.handoff.reason || null } : null,
  }, null, 2));
  return { ok: true, result };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
