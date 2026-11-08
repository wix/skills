#!/usr/bin/env node
'use strict';

// Write the handoff a fresh subagent starts from. Prints one JSON line:
// { ok, file, round, outcome, bytes, budgetRoundsWithoutProgress }.

const path = require('node:path');
const { writeHandoff } = require('../lib/subagent-handoff.js');

function usage() {
  return `Usage:
  node skills/wix-replatform/scripts/subagent-handoff.js write --project <dir> --stage <stage>
      [--resource <resources/rp-...>] [--outcome done|failed|budget_exceeded|needs_decision|resume_limit|qa_findings]
      [--reason budget_exceeded] [--findings <qa-result.json|.md>] [--changed a,b,c] [--notes <text>] [--worker-id <id>] [--cap-bytes <n>]

Writes <project>/state/handoffs/<stage>-<round>.json from durable state only (write-log summary,
completion-report status, pending user actions, QA findings), capped at 8 KB by default.
`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') { args.help = true; continue; }
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${token}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._[0] !== 'write') { process.stdout.write(usage()); if (!args.help) process.exitCode = 2; return; }
  if (!args.project || !args.stage) throw new Error(`--project and --stage are required\n${usage()}`);
  const projectDir = path.resolve(args.project);
  const result = await writeHandoff(projectDir, {
    stage: args.stage,
    resource: args.resource,
    outcome: args.outcome || args.reason,
    findingsFile: args.findings ? path.resolve(args.findings) : null,
    changedFiles: args.changed ? args.changed.split(',').map((s) => s.trim()).filter(Boolean) : [],
    notes: args.notes,
    workerId: args.workerId,
    capBytes: args.capBytes,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    file: path.relative(projectDir, result.file),
    round: result.handoff.round,
    outcome: result.handoff.outcome,
    bytes: result.bytes,
    budgetRoundsWithoutProgress: result.handoff.budgetRoundsWithoutProgress,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exit(1);
});
