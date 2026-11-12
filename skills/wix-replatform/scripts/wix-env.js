#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { RUN_FLAG_KEYS, setRunFlag } = require('../lib/config-env.js');

function usage() {
  return [
    'Usage:',
    `  node skills/wix-replatform/scripts/wix-env.js set --project-dir <dir> --key ${RUN_FLAG_KEYS.join('|')} --value true|false`,
    '',
    'Records a run flag the owner chose in <dir>/config/wix.env. Other keys and lines are kept;',
    'no value is ever printed except the flag just set.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (!token.startsWith('--')) {
      args._.push(token);
    } else {
      const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args._[0] !== 'set' || !args.projectDir || !args.key || args.value === undefined) {
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }
  const result = await setRunFlag(path.resolve(args.projectDir), args.key, args.value);
  console.log(JSON.stringify({ ok: true, ...result }));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
