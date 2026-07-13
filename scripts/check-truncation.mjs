#!/usr/bin/env node
/**
 * Diagnoses which skill reference files exceed the ~10k char fetch limit
 * that some agents apply when reading files. Reports what gets cut off.
 *
 * Usage: node scripts/check-truncation.mjs [--limit N]
 *        default limit: 10000 chars
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '10000', 10);
const ROOT = new URL('..', import.meta.url).pathname;
const SKILLS_DIR = join(ROOT, 'skills');

function scanDir(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...scanDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function extractExports(content) {
  return [...content.matchAll(/^export\s+(async\s+)?function\s+(\w+)/gm)].map(m => m[2]);
}

function analyze(filePath, content) {
  const size = content.length;
  if (size <= LIMIT) return { ok: true, size };

  const before = content.slice(0, LIMIT);
  const after = content.slice(LIMIT);

  const linesKept = before.split('\n').length - 1;
  const totalLines = content.split('\n').length - 1;

  const allExports = extractExports(content);
  const keptExports = extractExports(before);
  const lostExports = allExports.filter(e => !keptExports.includes(e));

  // Check if the cut happens mid-function (no newline right before limit)
  const isMidFunction = !before.endsWith('\n}\n') && !before.endsWith('\n}\n\n');

  return {
    ok: false,
    size,
    over: size - LIMIT,
    pctLost: Math.round((size - LIMIT) / size * 100),
    linesKept,
    totalLines,
    lostExports,
    isMidFunction,
    lastContext: before.slice(-120).trim(),
  };
}

const overLimit = [];
const ok = [];

for (const skillDir of readdirSync(SKILLS_DIR)) {
  const refsDir = join(SKILLS_DIR, skillDir, 'references');
  let files;
  try {
    files = scanDir(refsDir);
  } catch {
    continue; // skill has no references/
  }

  for (const f of files) {
    const content = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f);
    const result = analyze(f, content);
    result.path = rel;
    if (result.ok) {
      ok.push(result);
    } else {
      overLimit.push(result);
    }
  }
}

overLimit.sort((a, b) => b.over - a.over);

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(70)}`);
console.log(`SKILL REFERENCE FILE TRUNCATION REPORT  (limit: ${LIMIT.toLocaleString()} chars)`);
console.log(`${'='.repeat(70)}\n`);

if (overLimit.length === 0) {
  console.log('✓ All reference files are under the limit.\n');
} else {
  console.log(`✗ ${overLimit.length} file(s) exceed the ${LIMIT.toLocaleString()}-char limit:\n`);

  for (const r of overLimit) {
    const severity = r.pctLost >= 50 ? '🔴' : r.pctLost >= 25 ? '🟠' : '🟡';
    console.log(`${severity}  ${r.path}`);
    console.log(`   size: ${r.size.toLocaleString()} chars  |  over by: +${r.over.toLocaleString()} (${r.pctLost}% lost)`);
    console.log(`   lines kept: ${r.linesKept}/${r.totalLines}`);
    if (r.lostExports.length > 0) {
      console.log(`   lost exports (${r.lostExports.length}): ${r.lostExports.join(', ')}`);
    } else if (r.isMidFunction) {
      console.log(`   cut mid-function (no clean export boundary)`);
    }
    console.log(`   cut context: "…${r.lastContext.slice(-80)}"`);
    console.log();
  }
}

if (ok.length > 0) {
  console.log(`✓ ${ok.length} file(s) within limit:`);
  for (const r of ok) {
    console.log(`   ${r.size.toLocaleString().padStart(6)} chars — ${r.path}`);
  }
}

console.log(`\nSummary: ${overLimit.length} over-limit, ${ok.length} ok`);
const totalLost = overLimit.reduce((s, r) => s + r.over, 0);
if (totalLost > 0) {
  console.log(`Total chars that would be truncated: ${totalLost.toLocaleString()}`);
  const allLostExports = [...new Set(overLimit.flatMap(r => r.lostExports))];
  console.log(`Total distinct exported functions lost: ${allLostExports.length}`);
}
console.log();
