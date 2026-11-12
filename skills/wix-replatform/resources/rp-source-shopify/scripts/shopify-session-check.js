#!/usr/bin/env node
'use strict';

// The Shopify session check. Run from rp-source-shopify:
//
//   node scripts/shopify-session-check.js --project <migrations-root>/<project> [--install] [--connect]
//   node scripts/shopify-session-check.js --project <dir> --confirm-staff-removal owner-removed-account
//   node scripts/shopify-session-check.js --project <dir> --repair-staff-access
//
// The store is SHOPIFY_SHOP_DOMAIN in config/source.shopify.env.
//
//   (no flag)   Node.js >= 22.12, the adapter's CLI 4.8.3, the connection, the scope readback and
//               the API-version canary; writes data/shopify-discovery/session-receipt.json.
//   --install   the operator consents to installing (or reinstalling) the adapter's own CLI 4.8.3
//               into ~/.replatform/tools; nothing is installed without it.
//   --connect   starts the browser approval (`store auth` with the derived scope list) through the
//               adapter's CLI with self-update off, then runs the check. Never type a bare
//               `shopify store auth`: that process would run without CI and could upgrade a
//               machine-wide Shopify CLI.
//
// Exit codes: 0 the check passed and the connection is confirmed as a dedicated migration staff
// account; 3 the first-connection question is pending (answer it, then run again); 2 stopped (the
// printed code says why; also every refused confirmation or repair); 1 usage error.

const path = require('node:path');
const { readEnvFile } = require('../../../lib/config-env.js');
const { SHOPIFY_SOURCE_ENV } = require('../../../lib/source-access.js');
const { ShopifyCliError } = require('../lib/shopify-cli.js');
const session = require('../lib/shopify-session.js');

const USAGE = 'Usage: shopify-session-check.js --project <migrations-root>/<project> [--install] [--connect] | --confirm-staff-removal owner-removed-account | --repair-staff-access\n';

function parseArgs(argv) {
  const args = { project: null, install: false, connect: false, confirm: null, repair: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--project') { args.project = argv[i + 1]; i += 1; }
    else if (arg === '--install') args.install = true;
    else if (arg === '--connect') args.connect = true;
    else if (arg === '--confirm-staff-removal') { args.confirm = argv[i + 1] || ''; i += 1; }
    else if (arg === '--repair-staff-access') args.repair = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if ((args.confirm !== null) + args.repair > 1) throw new Error('--confirm-staff-removal and --repair-staff-access are separate commands');
  return args;
}

async function configuredDomain(projectDir) {
  let values;
  try {
    values = await readEnvFile(path.join(projectDir, SHOPIFY_SOURCE_ENV));
  } catch (error) {
    if (error.code === 'ENOENT') throw new session.ShopifySessionStop('shopify_shop_domain_missing', `${SHOPIFY_SOURCE_ENV} is missing; record SHOPIFY_SHOP_DOMAIN=<shop>.myshopify.com there.`);
    throw error;
  }
  if (!values.SHOPIFY_SHOP_DOMAIN) throw new session.ShopifySessionStop('shopify_shop_domain_missing', `SHOPIFY_SHOP_DOMAIN is missing from ${SHOPIFY_SOURCE_ENV}.`);
  return session.normalizeDomain(values.SHOPIFY_SHOP_DOMAIN);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(argv = process.argv.slice(2), options = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    return 1;
  }
  if (args.help) { process.stdout.write(USAGE); return 0; }
  if (!args.project) { process.stderr.write(USAGE); return 1; }
  const projectDir = path.resolve(args.project);
  try {
    const domain = await configuredDomain(projectDir);
    if (args.confirm !== null) {
      const entry = session.confirmStaffRemoval(projectDir, domain, args.confirm);
      print({ ok: true, status: 'staff_removal_confirmed', shopDomain: entry.shopDomain, confirmedAt: entry.confirmedAt });
      return 0;
    }
    if (args.repair) {
      const result = await session.repairStaffAccess(projectDir, domain);
      print({ ok: true, status: result.changed ? 'staff_record_rebuilt' : 'staff_record_unchanged', ...(result.setAside ? { setAside: path.relative(projectDir, result.setAside) } : {}) });
      return 0;
    }
    const result = await session.runSessionCheck({ projectDir, store: domain, install: args.install, connect: args.connect, ...options });
    const confirmed = result.firstConnection.answer === 'dedicated-account';
    print({
      ok: true,
      status: confirmed ? 'passed' : 'awaiting_user_action',
      receipt: 'data/shopify-discovery/session-receipt.json',
      shopDomain: result.receipt.shopDomain,
      grantedScopes: result.receipt.grantedScopes,
      ...(confirmed ? {} : { requestId: result.firstConnection.requestId, message: 'Discovery does not start until the first-connection question is answered dedicated-account.' }),
    });
    return confirmed ? 0 : 3;
  } catch (error) {
    if (error instanceof session.ShopifySessionStop || error instanceof ShopifyCliError) {
      print({ ok: false, status: 'stopped', code: error.code, message: error.message, ...(error.details && error.details.missingScopes ? { missingScopes: error.details.missingScopes } : {}) });
      return 2;
    }
    throw error;
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
