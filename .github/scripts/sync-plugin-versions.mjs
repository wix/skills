#!/usr/bin/env node
// Syncs the version of every per-platform plugin manifest to match the
// `version` in package.json (the single source of truth, @wix/agent-skills).
//
// Run automatically via the `version` npm lifecycle hook during
// `npm version <strategy>`, so manifests are bumped as part of every release.
// Can also be run manually: `node .github/scripts/sync-plugin-versions.mjs`.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// repo root = two levels up from this script (.github/scripts/ -> root)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MANIFESTS = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  'plugin.json',
  'gemini-extension.json',
];

const VERSION_LINE = /("version"\s*:\s*")([^"]*)(")/;

const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
if (!version) {
  console.error('package.json has no "version" field — aborting.');
  process.exit(1);
}

let changed = 0;
for (const rel of MANIFESTS) {
  const file = join(repoRoot, rel);
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    console.error(`Manifest not found: ${rel}`);
    process.exit(1);
  }

  const match = contents.match(VERSION_LINE);
  if (!match) {
    console.error(`No "version" field in ${rel} — aborting.`);
    process.exit(1);
  }

  const current = match[2];
  if (current === version) {
    console.log(`${rel}: already ${version}`);
    continue;
  }

  writeFileSync(file, contents.replace(VERSION_LINE, `$1${version}$3`));
  console.log(`${rel}: ${current} → ${version}`);
  changed++;
}

console.log(`Synced ${changed} manifest(s) to ${version}.`);
