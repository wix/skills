#!/usr/bin/env node
'use strict';

const { buildWixDashboardLink, buildWixDashboardUrl } = require('../lib/wix-dashboard-url.js');

function parseArgs(argv) {
  const options = { json: false, path: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--path') {
      i += 1;
      options.path = argv[i] || '';
    } else if (arg === '--meta-site-id' || arg === '--metasite-id' || arg === '--site-id') {
      i += 1;
      options.metaSiteId = argv[i];
    } else if (!options.metaSiteId) {
      options.metaSiteId = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    'Usage: node skills/wix-replatform/scripts/wix-dashboard-url.js <metaSiteId> [--json]',
    '       node skills/wix-replatform/scripts/wix-dashboard-url.js --meta-site-id <metaSiteId> [--path <dashboard-path>] [--json]',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.metaSiteId) {
    console.error(usage());
    process.exit(1);
  }

  const link = options.path
    ? {
        ...buildWixDashboardLink(options.metaSiteId),
        dashboardUrl: buildWixDashboardUrl(options.metaSiteId, { path: options.path }),
      }
    : buildWixDashboardLink(options.metaSiteId);

  console.log(options.json ? JSON.stringify(link, null, 2) : link.dashboardUrl);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
