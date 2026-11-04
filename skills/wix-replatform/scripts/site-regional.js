#!/usr/bin/env node
'use strict';

// Deterministic driver for the Wix site's regional settings (currency, time zone, language, locale).
//
//   node scripts/site-regional.js emit    <projectDir>
//   node scripts/site-regional.js preview <projectDir>
//   node scripts/site-regional.js status  <projectDir>
//   node scripts/site-regional.js reconsider <projectDir>
//
// `emit` is what rp-setup-discovery runs after it writes the setup plan and requirements (before it stamps
// the plan): it adds the `import-site-locale` requirement and step as a pair, after notification safety,
// even when the source file is missing so setup fails closed instead of exempting the migration.
// `preview` is what rp-execution-policy runs while it builds the execution plan: it prints the plain-language
// section ("set currency / time zone / language to ...") from the source file alone. It reads no site.
// `status` prints whether the step is planned and whether the owner's question is open.
//
// The step itself runs in `rp-execute-setup`; this script never writes to the site.
//
// Exit codes: 0 done (including "nothing to do"); 3 the owner's question is open; 4 blocked (unusable source
// file); 1 usage error.

const path = require('node:path');

const site = require('../lib/site-regional.js');

async function status(projectDir) {
  const open = await site.listRegionalRequests(projectDir).catch(() => []);
  return { applicable: site.planHasRegionalStep(projectDir), openRequests: open.map((request) => request.requestId) };
}

async function main() {
  const [command, projectDirArg] = process.argv.slice(2);
  if (!['emit', 'preview', 'status', 'reconsider'].includes(command) || !projectDirArg) {
    process.stderr.write('Usage: site-regional.js emit|preview|status|reconsider <projectDir>\n');
    return 1;
  }
  const projectDir = path.resolve(projectDirArg);
  const result = command === 'emit' ? await site.emitRegionalSetup(projectDir)
    : command === 'preview' ? await site.previewRegionalPlan(projectDir)
      : command === 'reconsider' ? await site.reopenRegionalRequest(projectDir) : await status(projectDir);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok === false) return 4;
  if (result.openRequests && result.openRequests.length) return 3;
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exitCode = 1;
});
