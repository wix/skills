#!/usr/bin/env node
'use strict';

// Deterministic mapping stage.
//
//   node scripts/resolve-mapping.js --fileset <discovery fileset.json> --out <mapping dir>
//   node scripts/resolve-mapping.js --headers "A,B,C" --vendor shopify        # ad-hoc check
//
// Reads the header set the discovery capture actually observed, joins it against the vendor overlay
// and the Wix target spec, and writes the machine mapping artifacts plus an explicit residue queue.
//
// What this REPLACES: an LLM reading source-schema.json and authoring mapping-plan.json field by
// field on every run. What it does NOT replace: deciding what to do with `residue`. That is the
// genuinely open part, and it is now the only part.
//
// Exit codes: 0 resolved (residue may be non-empty); 2 blocked (a required Wix input is unfilled,
// or an overlay names a canonical field that does not exist).

const fs = require('fs');
const path = require('path');
const { resolveMapping } = require('../lib/mapping-resolve.js');

function parseArgs(argv) {
  const args = { fileset: null, out: null, headers: null, vendor: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const next = () => argv[i + 1];
    if (argv[i] === '--fileset') { args.fileset = next(); i += 1; }
    else if (argv[i] === '--out') { args.out = next(); i += 1; }
    else if (argv[i] === '--headers') { args.headers = next(); i += 1; }
    else if (argv[i] === '--vendor') { args.vendor = next(); i += 1; }
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

// The fileset is the discovery capture's machine output. Header and vendor are read from the
// primary product stream, which is where the capture records what it actually saw.
function fromFileset(filesetPath) {
  const fileset = JSON.parse(fs.readFileSync(filesetPath, 'utf8'));
  const streams = fileset.streams || [];
  const stream = streams.find((s) => s.role === 'product') || streams[0];
  if (!stream) throw new Error(`${filesetPath}: no streams recorded`);
  const vendor = (stream.vendor && stream.vendor.name) || 'custom';
  let headers = stream.header || stream.columns || null;
  if (!headers) {
    // Older captures record the header per source file rather than per stream.
    const sourceFile = (fileset.sourceFiles || []).find((f) => f.role === stream.role);
    headers = (sourceFile && (sourceFile.header || sourceFile.columns)) || null;
  }
  if (!headers) {
    // Captures written before fileset.json carried `header` still have it in the sibling
    // raw-capture.json. Fall back rather than force a re-run of discovery.
    const raw = path.join(path.dirname(filesetPath), 'raw-capture.json');
    if (fs.existsSync(raw)) {
      const rawDoc = JSON.parse(fs.readFileSync(raw, 'utf8'));
      const rawStream = (rawDoc.streams || []).find((s) => s.role === stream.role) || (rawDoc.streams || [])[0];
      if (rawStream) {
        headers = rawStream.header
          || (Array.isArray(rawStream.columns) ? rawStream.columns.map((c) => c.name).filter(Boolean) : null);
      }
    }
  }
  if (!headers) {
    throw new Error(
      `${filesetPath}: the capture did not record a header list for role "${stream.role}", and no ` +
        'sibling raw-capture.json supplied one. Pass --headers explicitly, or re-run csv-discovery.',
    );
  }
  return { headers, vendor };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let headers;
  let vendor;

  if (args.fileset) ({ headers, vendor } = fromFileset(args.fileset));
  else if (args.headers) { headers = args.headers.split(',').map((h) => h.trim()); vendor = args.vendor || 'custom'; }
  else {
    console.error('resolve-mapping: pass --fileset <path> or --headers "A,B,C"');
    process.exit(64);
  }
  if (args.vendor) vendor = args.vendor;

  const resolved = resolveMapping({ headers, vendor });
  const blocked = resolved.residue.unfilledRequired.length > 0 || resolved.canonicalErrors.length > 0;

  if (args.json) {
    console.log(JSON.stringify(resolved, null, 2));
  } else {
    const c = resolved.coverage;
    console.log(`vendor ${resolved.vendor}${resolved.overlayVersion ? ` (profile ${resolved.overlayVersion})` : ''}`);
    console.log(`  columns          : ${c.totalColumns}`);
    console.log(`  mapped by overlay: ${c.mappedColumns} (${(c.ratio * 100).toFixed(1)}%)`);
    console.log(`  landing in Wix   : ${c.landingInWix}`);
    console.log(`  residue for agent: ${resolved.residue.unmappedColumns.length} unmapped, ${resolved.residue.unsupportedTargets.length} with no Wix home`);
    if (resolved.derivedEntities.length) {
      console.log(`  derived entities : ${resolved.derivedEntities.map((d) => `${d.entity}${d.present ? '' : ' (column absent)'}`).join(', ')}`);
    }
    if (resolved.overlayDrift.length) console.log(`  overlay drift    : ${resolved.overlayDrift.length} declared field(s) not in this header`);
    if (resolved.duplicateColumns.length) console.log(`  DUPLICATE columns: ${resolved.duplicateColumns.join(', ')}`);
    if (resolved.canonicalErrors.length) {
      console.log('  CANONICAL ERRORS (overlay bug — fix the overlay, do not work around it):');
      for (const e of resolved.canonicalErrors) console.log(`    - ${e.wixTarget}: ${e.reason}`);
    }
    if (resolved.residue.unfilledRequired.length) {
      console.log('  BLOCKED — required Wix inputs nothing feeds:');
      for (const f of resolved.residue.unfilledRequired) console.log(`    - ${f}`);
    }
    if (resolved.residue.unmappedColumns.length) {
      console.log('  --- residue: decide each of these (the agentic step) ---');
      for (const col of resolved.residue.unmappedColumns) console.log(`    ? ${col}`);
    }
  }

  if (args.out) {
    fs.mkdirSync(args.out, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(args.out, 'mapping-resolution.json'),
      `${JSON.stringify({ schemaVersion: 1, generatedAt: now, generator: 'rp-mapper/resolve-mapping.js', deterministic: true, ...resolved }, null, 2)}\n`,
    );
    // The residue is written as its own artifact so the agentic step has a single, explicit queue
    // instead of having to re-derive "what is left" from the full resolution.
    fs.writeFileSync(
      path.join(args.out, 'mapping-residue.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: now,
          note: 'Every entry needs an explicit decision: map it to a canonical field, or record it as intentionally skipped. Leaving it here is how a stale overlay becomes silently dropped data.',
          vendor: resolved.vendor,
          unmappedColumns: resolved.residue.unmappedColumns,
          unsupportedTargets: resolved.residue.unsupportedTargets,
          unfilledRequired: resolved.residue.unfilledRequired,
          overlayDrift: resolved.overlayDrift,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nwrote mapping-resolution.json + mapping-residue.json to ${args.out}`);
  }

  process.exit(blocked ? 2 : 0);
}

main();
