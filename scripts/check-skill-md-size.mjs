#!/usr/bin/env node
/**
 * Flags skills/wix-app/SKILL.md when it grows past skill-creator's ~500-line
 * ideal ceiling for a SKILL.md body. That file is always loaded once the skill
 * triggers, so it's the most expensive real estate in the whole skill — detail
 * belongs in a reference file with a pointer left behind, not in the index.
 *
 * Usage: node scripts/check-skill-md-size.mjs [--limit N] [--files=a,b,c] [--fail]
 *        --limit    line-count ceiling. Default: 500
 *        --files    comma-separated changed paths (as CI passes them). Only
 *                   checks when skills/wix-app/SKILL.md is among them — same
 *                   "gate what a PR touches" scoping as check-truncation.mjs.
 *                   If omitted, checks the file unconditionally.
 *        --fail     exit 1 when over the limit. Without it, always exits 0.
 */

import { readFileSync } from 'fs';

const TARGET = 'skills/wix-app/SKILL.md';
const ROOT = new URL('..', import.meta.url).pathname;

const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '500', 10);
const FILES_ARG = process.argv.find(a => a.startsWith('--files='))?.split('=')[1];
const FAIL_ON_OVER = process.argv.includes('--fail');

if (FILES_ARG !== undefined) {
  const files = FILES_ARG.split(',').map(f => f.trim()).filter(Boolean);
  if (!files.includes(TARGET)) {
    console.log(`${TARGET} not in the changed files — nothing to check.`);
    process.exit(0);
  }
}

const text = readFileSync(`${ROOT}${TARGET}`, 'utf8');
// A trailing newline at EOF is normal and shouldn't count as an extra line.
const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

console.log(`${TARGET}: ${lines} lines (limit: ${LIMIT})`);

if (lines > LIMIT) {
  console.error(
    `\n❌ ${TARGET} is ${lines} lines, over the ${LIMIT}-line ideal ceiling for a SKILL.md ` +
      `body (skill-creator's guideline — it's always loaded once the skill triggers). ` +
      `Push detail into a reference file and leave a pointer, rather than growing the index.`,
  );
  if (FAIL_ON_OVER) process.exit(1);
} else {
  console.log(`✓ within the ${LIMIT}-line limit.`);
}
