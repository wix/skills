#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { readEnvFile } = require('../lib/config-env.js');
const {
  createWixSecretsClient,
  resolveSourceSecrets,
} = require('../lib/source-secrets.js');

function usage() {
  return [
    'Usage:',
    '  node skills/wix-replatform/scripts/source-secrets.js resolve --env-file <path> --wix-env-file <path> --keys <A,B> --project <name> [--meta-site-id <id>] [--no-create-placeholders]',
    '',
    'Outputs only key names and statuses. Secret values are never printed.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    if (token === '--no-create-placeholders') {
      args.createPlaceholders = false;
      continue;
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command !== 'resolve' || !args.envFile || !args.wixEnvFile || !args.keys || !args.project) {
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }

  const wixEnv = await readEnvFile(path.resolve(args.wixEnvFile));
  const client = createWixSecretsClient({
    authToken: wixEnv.WIX_AUTH_TOKEN || process.env.WIX_AUTH_TOKEN,
    siteId: wixEnv.WIX_SITE_ID || process.env.WIX_SITE_ID,
  });
  const keys = String(args.keys).split(',').map((key) => key.trim()).filter(Boolean);
  const result = await resolveSourceSecrets({
    envFilePath: path.resolve(args.envFile),
    keys,
    project: args.project,
    metaSiteId: args.metaSiteId || wixEnv.WIX_META_SITE_ID || process.env.WIX_META_SITE_ID,
    client,
    createPlaceholders: args.createPlaceholders !== false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exit(1);
});
