#!/usr/bin/env node
'use strict';

// Read-only cleanup aid. It never changes the journal, crosswalk, or target site.
const fs = require('node:fs/promises');
const path = require('node:path');

const JOURNAL = 'state/attempts/write-attempts.ndjson';
const CROSSWALK = 'state/crosswalk/crosswalk.ndjson';

function usage() {
  return `Usage:\n  node skills/wix-replatform/scripts/detect-crosswalk-duplicates.js --project <dir> [--json]\n\nLists source keys observed with more than one target id across the attempt journal and crosswalk. Read-only.\n`;
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
  return args;
}

async function readNdjson(file, warnings) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try { rows.push(JSON.parse(line)); }
    catch (error) {
      // A killed append can leave one partial final line. It is evidence to mention, but it is not
      // silently treated as a valid mapping. Any malformed interior line is a corruption warning.
      const final = i === lines.length - 1 || (i === lines.length - 2 && lines.at(-1) === '');
      warnings.push(`${path.relative(process.cwd(), file)}:${i + 1} ignored ${final ? 'partial trailing' : 'malformed'} JSON`);
    }
  }
  return rows;
}

function add(groups, sourceStableKey, targetId, source, row) {
  if (sourceStableKey == null || targetId == null || String(sourceStableKey) === '' || String(targetId) === '') return;
  const key = String(sourceStableKey), id = String(targetId);
  const entry = groups.get(key) || { sourceStableKey: key, targetIds: new Set(), attempts: new Set(), crosswalk: new Set() };
  entry.targetIds.add(id);
  entry[source].add(id);
  groups.set(key, entry);
}

async function detect(projectDir) {
  const warnings = [];
  const [attempts, crosswalk] = await Promise.all([
    readNdjson(path.join(projectDir, JOURNAL), warnings),
    readNdjson(path.join(projectDir, CROSSWALK), warnings),
  ]);
  const groups = new Map();
  for (const row of attempts) {
    // Terminal rows are enough for cleanup; a started row has no target identity by contract.
    if (row && row.sourceStableKey && row.status !== 'started') add(groups, row.sourceStableKey,
      row.targetId || row.targetEntityId || row.orderId, 'attempts', row);
  }
  for (const row of crosswalk) if (row) add(groups, row.sourceStableKey, row.targetId, 'crosswalk', row);
  const duplicates = [...groups.values()]
    .filter(row => row.targetIds.size > 1)
    .sort((a, b) => a.sourceStableKey.localeCompare(b.sourceStableKey))
    .map(row => ({ sourceStableKey: row.sourceStableKey, targetIds: [...row.targetIds].sort(),
      attempts: [...row.attempts].sort(), crosswalk: [...row.crosswalk].sort() }));
  return { schemaVersion: 1, projectDir, journal: JOURNAL, crosswalk: CROSSWALK, duplicates, warnings };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage()); return; }
  if (!args.project) throw new Error(`--project is required\n${usage()}`);
  const result = await detect(path.resolve(args.project));
  if (args.json) { process.stdout.write(`${JSON.stringify(result)}\n`); return; }
  if (!result.duplicates.length) process.stdout.write('No source keys with multiple target ids found.\n');
  for (const row of result.duplicates) process.stdout.write(`${row.sourceStableKey}: ${row.targetIds.join(', ')} (attempts: ${row.attempts.join(', ') || 'none'}; crosswalk: ${row.crosswalk.join(', ') || 'none'})\n`);
  for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.message || error}\n`); process.exit(1); });
module.exports = { detect, parseArgs };
