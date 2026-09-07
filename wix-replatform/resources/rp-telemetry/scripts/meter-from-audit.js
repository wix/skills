#!/usr/bin/env node
'use strict';

// Derive MEASURED api_ms / api_calls / api_retries from a generated import's audit log, and emit
// them as a `meter` call. This exists so the API half of the latency split is populated
// mechanically rather than depending on anyone remembering to report it.
//
//   node scripts/meter-from-audit.js --project <migration dir> [--stage import] [--dry-run]
//
// TRAP this deliberately handles: a bulk write logs ONE audit row PER ITEM, each carrying the
// BATCH's total latency. Summing `latencyMs` across rows therefore multiplies one call's latency by
// its item count — on a real run that turned 346s of elapsed import into 1,050,992ms of "API time",
// three times longer than the stage existed. Rows are collapsed per distinct
// (runId, endpoint, batch, latencyMs) so a batch counts once, while genuinely separate calls
// (category creates, link calls) each count individually.

const fs = require('node:fs');
const path = require('node:path');
const recorder = require('../lib/telemetry-recorder.js');

function parseArgs(argv) {
  const args = { project: process.cwd(), stage: 'import', auditFile: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') { args.project = argv[i + 1]; i += 1; }
    else if (argv[i] === '--stage') { args.stage = argv[i + 1]; i += 1; }
    else if (argv[i] === '--audit') { args.auditFile = argv[i + 1]; i += 1; }
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

function deriveFromAudit(records) {
  const calls = new Map();
  let retries = 0;
  for (const row of records) {
    if (typeof row.latencyMs !== 'number') continue;
    // `batch` present => a bulk call fanned out across one row per item. Collapse on the batch's
    // identity PLUS the latency, because a single logical batch number can cover more than one
    // physical request (a contract probe followed by the remainder).
    const key = row.batch === undefined
      ? `single|${row.runId}|${row.endpoint || row.operation}|${row.ts}`
      : `bulk|${row.runId}|${row.endpoint || row.operation}|${row.batch}|${row.latencyMs}`;
    if (!calls.has(key)) calls.set(key, row.latencyMs);
    if (typeof row.retryCount === 'number') retries += row.retryCount;
  }
  const apiMs = [...calls.values()].reduce((sum, ms) => sum + ms, 0);
  return { api_ms: Math.round(apiMs), api_calls: calls.size, api_retries: retries };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const auditFile = args.auditFile || path.join(args.project, 'logs', 'import-audit.ndjson');
  if (!fs.existsSync(auditFile)) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: [`audit log not found: ${auditFile}`] })}\n`);
    process.exit(1);
  }
  const records = fs
    .readFileSync(auditFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);

  const derived = deriveFromAudit(records);
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, auditRecords: records.length, ...derived })}\n`);
    return;
  }
  const result = recorder.meter(args.project, { ...derived, stage: args.stage });
  process.stdout.write(`${JSON.stringify({ ok: true, auditRecords: records.length, ...derived, ...result })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const errors = error instanceof recorder.ValidationError ? error.errors : [error.message || String(error)];
    process.stdout.write(`${JSON.stringify({ ok: false, errors })}\n`);
    process.exit(1);
  }
}

module.exports = { deriveFromAudit };
