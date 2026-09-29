#!/usr/bin/env node
/**
 * Lints changed skill markdown for the mechanical stuff that's tedious to eyeball across a
 * dozen changed files: a SKILL.md/reference file that grew too large with no table of
 * contents, a relative link that resolves to nothing, and SKILL.md frontmatter that breaks
 * CONTRIBUTING.md's wiring rules. Process narration ("split out of X.md", "extracted from Y")
 * is a judgment call the skill asks you to read for by eye, not something this script greps
 * for — a fixed phrase list produces false positives on any doc that discusses the pattern
 * itself, and misses every phrasing it doesn't already know about.
 *
 * Usage: node check-pr-content.mjs [--files=a.md,b.md] [--base=main] [--fail]
 *        --files   comma-separated paths to check (as CI passes them). If omitted,
 *                   falls back to `git diff --name-only <base>...HEAD`.
 *        --base     base ref for the git-diff fallback. Default: main.
 *        --fail     exit 1 when there are findings (CI mode). Without it, the
 *                   script always exits 0 and just prints the report.
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join, normalize } from 'path';

// This script lives at <repo-root>/.claude/skills/wix-app-pr-check/scripts/ — four levels
// below the repo root.
const ROOT = new URL('../../../../', import.meta.url).pathname;
const FILES_ARG = process.argv.find(a => a.startsWith('--files='))?.split('=')[1];
const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1] ?? 'main';
const FAIL_ON_FINDINGS = process.argv.includes('--fail');

const SKILL_MD_SOFT_LIMIT = 500; // skill-creator's ideal ceiling for a SKILL.md body
const REFERENCE_TOC_THRESHOLD = 300; // skill-creator: reference files over this need a TOC
const DESCRIPTION_HARD_LIMIT = 1024; // CONTRIBUTING.md: hard limit, at most this many chars

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function changedFiles() {
  if (FILES_ARG) {
    return FILES_ARG.split(',').map(f => f.trim()).filter(Boolean).filter(f => f.endsWith('.md'));
  }
  const out = execSync(`git diff --name-only --diff-filter=ACMR ${BASE}...HEAD`, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').filter(f => f.endsWith('.md'));
}

function parseFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return null;
  const fm = m[1];
  const fields = {};
  for (const key of ['name', 'description']) {
    const km = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(fm);
    if (!km) continue;
    let val = km[1].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fields[key] = val;
  }
  return fields;
}

const findings = [];
function report(category, path, loc, message) {
  findings.push({ category, path, loc, message });
}

function checkLineCount(relPath, text) {
  // A trailing newline at EOF is normal and shouldn't count as an extra line —
  // match `wc -l` semantics instead of `split('\n').length`'s off-by-one on it.
  const n = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const base = relPath.split('/').pop();
  if (base === 'SKILL.md') {
    if (n > SKILL_MD_SOFT_LIMIT) {
      report(
        'size',
        relPath,
        n,
        `SKILL.md body is ${n} lines; skill-creator's ideal ceiling is ${SKILL_MD_SOFT_LIMIT}. ` +
          'Push detail into a reference file and leave a pointer, rather than growing the always-loaded index.',
      );
    }
  } else if (n > REFERENCE_TOC_THRESHOLD && !text.includes('## Contents') && !text.includes('## Table of Contents')) {
    report(
      'size',
      relPath,
      n,
      `Reference file is ${n} lines (over ${REFERENCE_TOC_THRESHOLD}) with no table-of-contents section. ` +
        'Add one, or split the file.',
    );
  }
}

function checkLinks(relPath, text) {
  const baseDir = dirname(relPath);
  let m;
  while ((m = LINK_RE.exec(text))) {
    const target = m[1];
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const pathPart = target.split('#')[0];
    if (!pathPart) continue;
    const resolved = normalize(join(baseDir, pathPart));
    if (!existsSync(join(ROOT, resolved))) {
      const line = text.slice(0, m.index).split('\n').length;
      report('broken-link', relPath, line, `Link target '${target}' does not resolve to a file in the repo (resolved: ${resolved}).`);
    }
  }
}

function checkFrontmatter(relPath, text) {
  if (relPath.split('/').pop() !== 'SKILL.md') return;
  const fields = parseFrontmatter(text);
  if (!fields) {
    report('frontmatter', relPath, 1, 'SKILL.md has no YAML frontmatter block.');
    return;
  }
  const desc = fields.description ?? '';
  if (!desc) {
    report('frontmatter', relPath, 1, 'SKILL.md frontmatter is missing a description.');
  } else if (desc.length > DESCRIPTION_HARD_LIMIT) {
    report('frontmatter', relPath, 1, `description is ${desc.length} chars, over the ${DESCRIPTION_HARD_LIMIT}-char hard limit in CONTRIBUTING.md.`);
  }
  if (!fields.name) {
    report('frontmatter', relPath, 1, 'SKILL.md frontmatter is missing a name.');
  }
}

const files = changedFiles();

if (!files.length) {
  console.log(`No changed .md files found${FILES_ARG ? '' : ` against ${BASE}`}.`);
  process.exit(0);
}

for (const relPath of files) {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) continue; // deleted
  const text = readFileSync(full, 'utf8');
  checkLineCount(relPath, text);
  checkLinks(relPath, text);
  checkFrontmatter(relPath, text);
}

console.log(`\n${'='.repeat(70)}`);
console.log('PR CONTENT CHECK');
console.log(`${'='.repeat(70)}\n`);

if (!findings.length) {
  console.log(`Checked ${files.length} changed .md file(s): clean.\n`);
} else {
  console.log(`Checked ${files.length} changed .md file(s): ${findings.length} finding(s).\n`);
  for (const { category, path, loc, message } of findings) {
    console.log(`[${category}] ${path}:${loc}`);
    console.log(`  ${message}\n`);
  }
}

if (FAIL_ON_FINDINGS && findings.length) {
  process.exit(1);
}
