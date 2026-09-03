#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const w = require('../lib/wix-writers');
const verify = require('../lib/stores-verification');
const {
  createContractLedgerProposalFromStoresVerification,
  writeProposal,
} = require('../lib/contract-ledger');

function usage() {
  console.error(`Usage:
  node scripts/verify-stores.js stores subscription-create --artifact <file> [--proposal-artifact <file>] [--marker <id>] [--no-cleanup]
  node scripts/verify-stores.js stores product-count --artifact <file>
  node scripts/verify-stores.js stores product-by-source-marker --marker-path <path> --marker-value <value> --artifact <file>
  node scripts/verify-stores.js stores delete-probe --product-id <id> --artifact <file>

Credentials:
  WIX_AUTH_TOKEN and WIX_SITE_ID must be set in the environment.`);
}

function parseArgs(argv) {
  const args = [...argv];
  if (args[0] === 'verify') args.shift();
  if (args[0] !== 'stores') {
    usage();
    process.exit(2);
  }
  args.shift();
  const command = args.shift();
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-cleanup') {
      options.cleanup = false;
    } else if (arg.startsWith('--')) {
      options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = args[++i];
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return { command, options };
}

function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

(async () => {
  const { command, options } = parseArgs(process.argv.slice(2));
  loadEnvFile(options.env || path.join(process.cwd(), 'config/wix.env'));
  const authToken = process.env.WIX_AUTH_TOKEN;
  const siteId = process.env.WIX_SITE_ID;
  if (!authToken || !siteId) throw new Error('WIX_AUTH_TOKEN and WIX_SITE_ID are required');
  const wix = w.createWixClient({ authToken, siteId });
  const common = { wix, siteId, artifactPath: options.artifact };

  let result;
  if (command === 'subscription-create') {
    result = await verify.verifyStoresSubscriptionCreate({
      ...common,
      marker: options.marker,
      cleanup: options.cleanup !== false,
    });
    if (options.proposalArtifact) {
      result.artifactPath = options.artifact ? path.resolve(options.artifact) : null;
      const proposal = createContractLedgerProposalFromStoresVerification(result);
      proposal.sourceVerification.artifactPath = result.artifactPath;
      writeProposal(options.proposalArtifact, proposal);
      result.contractLedgerProposal = {
        path: path.resolve(options.proposalArtifact),
        status: proposal.status,
        proposalId: proposal.proposalId,
      };
      if (options.artifact) {
        fs.writeFileSync(options.artifact, `${JSON.stringify(result, null, 2)}\n`);
      }
    }
  } else if (command === 'product-count') {
    result = await verify.verifyStoresProductCount(common);
  } else if (command === 'product-by-source-marker') {
    result = await verify.verifyStoresProductBySourceMarker({
      ...common,
      markerPath: options.markerPath,
      markerValue: options.markerValue,
    });
  } else if (command === 'delete-probe') {
    result = await verify.verifyStoresDeleteProbe({ ...common, productId: options.productId });
  } else {
    usage();
    process.exit(2);
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'passed' ? 0 : 1);
})().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
