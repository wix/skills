#!/usr/bin/env node
'use strict';

// The only supported way for an agent to look at the write ledger or the import
// audit log. Bounded output; reads the file as a stream; writes nothing.

const path = require('node:path');
const { summarizeWriteLog, formatText } = require('../lib/write-log-summary.js');

function usage() {
  return `Usage:
  node skills/wix-replatform/scripts/write-log-summary.js --project <dir>
      [--log attempts|audit] [--run <runId>|latest] [--since-run <runId>]
      [--entity <targetEntityType>] [--status <status>] [--limit <n>] [--fields a,b,c] [--json]

Default: current status of every attempt (folded by attemptId), counts per entity x status,
top error classes per entity. --entity/--status add up to --limit matching rows (default 20).
Never open, cat, grep, tail or jq the raw ledger; use this instead.
`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') { args.json = true; continue; }
    if (token === '--help' || token === '-h') { args.help = true; continue; }
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${token}`);
    args[key] = value;
    i += 1;
  }
  if (args.fields) args.fields = args.fields.split(',').map((f) => f.trim()).filter(Boolean);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage()); return; }
  if (!args.project) throw new Error(`--project is required\n${usage()}`);
  const summary = await summarizeWriteLog(path.resolve(args.project), args);
  if (args.json) {
    const { file, ...rest } = summary;
    process.stdout.write(`${JSON.stringify({ ...rest, file: path.relative(path.resolve(args.project), file) })}\n`);
  } else {
    process.stdout.write(formatText(summary));
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exit(1);
});
