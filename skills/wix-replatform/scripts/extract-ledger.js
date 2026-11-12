#!/usr/bin/env node
'use strict';

// Record or check a source extract version in the toolkit's extract ledger.
//   node scripts/extract-ledger.js record --project <dir> --entity <entity> --extract <path> [--key-field id]
//   node scripts/extract-ledger.js check  --project <dir> --extract <path>
// Prints JSON with typed codes only (never source text); exits 2 when the extract is unrecorded,
// changed since recorded, or lost fields.

const ledger = require('../lib/extract-ledger');

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) flags[rest[i].replace(/^--/, '')] = rest[i + 1];
  if (!flags.project || !flags.extract || !['record', 'check'].includes(command) || (command === 'record' && !flags.entity)) return { ok: false, errors: ['extract_ledger_usage'] };
  if (command === 'record') {
    try { await ledger.recordExtract(flags.project, { entity: flags.entity, extractPath: flags.extract, keyField: flags['key-field'] || 'id', recordedBy: 'extract-ledger-cli' }); }
    catch (error) { const code = /^(extract|source_extract)_[a-z_]+$/.test(error.code || '') ? error.code : 'extract_unreadable'; return { ok: false, errors: [code], next: [ledger.nextStep(code)].filter(Boolean) }; }
  }
  const errors = await ledger.extractErrors(flags.project, flags.extract);
  let latest = null;
  try { latest = ledger.entries(flags.project, flags.extract).pop() || null; } catch { /* reported by extractErrors */ }
  return { ok: errors.length === 0, extract: latest ? { path: latest.extractPath, version: latest.version, sha256: latest.sha256, rows: latest.rows, lostPaths: latest.lostPaths } : null, errors, next: [...new Set(errors.map(ledger.nextStep).filter(Boolean))] };
}
main().then(result => { console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 2; },
  () => { console.log(JSON.stringify({ ok: false, errors: ['extract_ledger_failed'] })); process.exitCode = 2; });
