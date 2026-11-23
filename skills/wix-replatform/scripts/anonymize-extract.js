#!/usr/bin/env node
'use strict';

// Anonymize a source-extract folder into a fixtures folder (design v2, D2).
//
//   node scripts/anonymize-extract.js --project <migration dir> --out <fixtures dir> [--limit 50] [--entities customer,order]
//   node scripts/anonymize-extract.js --in <extract dir> --salt-file <file> --out <fixtures dir>
//
// Every *.ndjson file is streamed line by line through lib/anonymize.js `record()`; every
// *.json file (manifests, deferred notes) goes through the same function. One anonymizer per
// call, so the same real value gets the same fake value across files and links survive
// (customer email ↔ order billing email). The salt comes from the project's
// state/anonymize-salt (created if missing) and is never printed. Folders whose name starts
// with "." (e.g. .extract-ledger) are not copied.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { createAnonymizer, loadProjectSalt } = require('../lib/anonymize.js');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    if (key === 'help') { args.help = true; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`--${key} needs a value`);
    args[key] = v;
    i += 1;
  }
  return args;
}

const USAGE = 'usage: anonymize-extract.js (--project <dir> | --in <extract dir> --salt-file <file>) --out <dir> [--limit N] [--entities a,b]';

async function anonymizeNdjson(src, dest, anonymizer, limit) {
  const input = fs.createReadStream(src, 'utf8');
  const out = fs.createWriteStream(dest, 'utf8');
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let count = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (limit && count >= limit) break;
    let parsed;
    try { parsed = JSON.parse(line); } catch {
      throw new Error(`${path.basename(src)} line ${count + 1} is not JSON`);
    }
    out.write(`${JSON.stringify(anonymizer.record(parsed))}\n`);
    count += 1;
  }
  rl.close();
  input.destroy();
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  return count;
}

function sourceHostsOf(inDir) {
  const hosts = new Set();
  for (const name of fs.readdirSync(inDir).filter((n) => n.endsWith('.ndjson'))) {
    let first = '';
    try {
      const fd = fs.openSync(path.join(inDir, name), 'r');
      const buf = Buffer.alloc(256 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      first = buf.subarray(0, n).toString('utf8').split('\n')[0];
    } catch { continue; }
    for (const m of first.matchAll(/"(?:href|permalink|link)":"https?:(?:\\?\/){2}([^"\\/:?#]+)/g)) hosts.add(m[1].toLowerCase());
  }
  return [...hosts];
}

async function anonymizeExtract({ inDir, outDir, salt, limit = 0, entities = null }) {
  if (!fs.existsSync(inDir)) throw new Error(`no extract folder: ${inDir}`);
  if (path.resolve(inDir) === path.resolve(outDir)) throw new Error('--out must differ from the extract folder');
  // The store's own hosts, from each file's first record (`_links`, permalinks): a bare mention
  // ("tuticafe.co.il" in a note) is then replaced even before any URL with that host is seen.
  const anonymizer = createAnonymizer({ salt, sourceHosts: sourceHostsOf(inDir) });
  const summary = { files: [], records: 0 };
  const wanted = (name) => {
    if (!entities) return true;
    const base = name.replace(/\.(manifest\.)?(ndjson|json)$/, '');
    return entities.includes(base) || name === 'manifest.json';
  };

  async function walk(rel) {
    const dir = path.join(inDir, rel);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const relPath = path.join(rel, entry.name);
      if (entry.isDirectory()) { await walk(relPath); continue; }
      if (!wanted(entry.name)) continue;
      const src = path.join(inDir, relPath);
      const dest = path.join(outDir, relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (entry.name.endsWith('.ndjson')) {
        const n = await anonymizeNdjson(src, dest, anonymizer, limit);
        summary.records += n;
        summary.files.push({ file: relPath, records: n });
      } else if (entry.name.endsWith('.json')) {
        const data = JSON.parse(fs.readFileSync(src, 'utf8'));
        fs.writeFileSync(dest, `${JSON.stringify(anonymizer.record(data), null, 2)}\n`);
        summary.files.push({ file: relPath });
      }
      // Other file types are not copied: they are unknown shapes and could carry anything.
    }
  }
  await walk('');
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args.out || (!args.project && !args.in)) throw new Error(USAGE);
  let inDir = args.in;
  let salt;
  if (args.project) {
    inDir = inDir || path.join(args.project, 'data', 'source-extract');
    salt = loadProjectSalt(args.project);
  } else {
    if (!args['salt-file']) throw new Error('--in needs --salt-file (or use --project)');
    salt = fs.readFileSync(args['salt-file'], 'utf8').trim();
    if (!salt) throw new Error('salt file is empty');
  }
  const limit = args.limit ? Number(args.limit) : 0;
  if (args.limit && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit must be a positive integer');
  const entities = args.entities ? args.entities.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const summary = await anonymizeExtract({ inDir, outDir: args.out, salt, limit, entities });
  console.log(JSON.stringify({ ok: true, out: args.out, ...summary }));
}

if (require.main === module) {
  main().catch((err) => { console.error(`anonymize-extract: ${err.message}`); process.exit(1); });
}

module.exports = { anonymizeExtract };
