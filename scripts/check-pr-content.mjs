#!/usr/bin/env node
/**
 * Lints changed skill markdown for the defects that keep recurring in doc-heavy PRs:
 * process narration shipped as content ("Split out of X.md", "extracted from Y"),
 * files that grew past the point a reader can hold in their head with no table of
 * contents, relative links that resolve to nothing, and SKILL.md/wix-manage
 * frontmatter that breaks the wiring rules in CONTRIBUTING.md.
 *
 * Usage: node scripts/check-pr-content.mjs [--files=a.md,b.md] [--base=main] [--fail]
 *        --files   comma-separated paths to check (as CI passes them). If omitted,
 *                   falls back to `git diff --name-only <base>...HEAD`.
 *        --base     base ref for the git-diff fallback. Default: main.
 *        --fail     exit 1 when there are findings (CI mode). Without it, the
 *                   script always exits 0 and just prints the report.
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join, normalize, relative } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES_ARG = process.argv.find(a => a.startsWith('--files='))?.split('=')[1];
const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1] ?? 'main';
const FAIL_ON_FINDINGS = process.argv.includes('--fail');

const BANNED_PHRASES = [
  /\bsplit out of\b/i,
  /\bsplit from\b/i,
  /\bextracted from\b/i,
  /\bmoved from\b/i,
  /\bmoved out of\b/i,
  /\brefactored (?:out|from)\b/i,
  /\bthis file used to\b/i,
  /\bpreviously (?:lived|was) in\b/i,
  /\bwas split into\b/i,
  /\bwe split this\b/i,
];

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

function checkBannedPhrases(relPath, text) {
  text.split('\n').forEach((line, i) => {
    if (BANNED_PHRASES.some(re => re.test(line))) {
      report(
        'process-narration',
        relPath,
        i + 1,
        `Shipped doc line narrates the authoring/refactor process: ${JSON.stringify(line.trim().slice(0, 120))}. ` +
          'That belongs in the PR description or commit message, not in content a future reader/agent loads.',
      );
    }
  });
}

function checkLineCount(relPath, text) {
  const n = text.split('\n').length;
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

function checkWixManageIndexSync(relPath, text) {
  if (!relPath.includes('skills/wix-manage/references/') || relPath.split('/').pop() === 'SKILL.md') return;
  const fields = parseFrontmatter(text);
  if (!fields) {
    report('frontmatter', relPath, 1, 'wix-manage reference has no frontmatter (needs name + description).');
    return;
  }
  const desc = fields.description ?? '';
  if (desc && desc.length > DESCRIPTION_HARD_LIMIT) {
    report('frontmatter', relPath, 1, `description is ${desc.length} chars, over the ${DESCRIPTION_HARD_LIMIT}-char hard limit.`);
  }
  const indexPath = join(ROOT, 'skills/wix-manage/SKILL.md');
  if (!desc || !existsSync(indexPath)) return;
  const indexText = readFileSync(indexPath, 'utf8');
  if (!indexText.includes(desc.trim())) {
    report(
      'index-mismatch',
      relPath,
      1,
      "This reference's frontmatter `description` does not appear verbatim in skills/wix-manage/SKILL.md. " +
        'The index entry must quote the frontmatter description word for word, not paraphrase it.',
    );
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
  checkBannedPhrases(relPath, text);
  checkLineCount(relPath, text);
  checkLinks(relPath, text);
  checkFrontmatter(relPath, text);
  checkWixManageIndexSync(relPath, text);
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
