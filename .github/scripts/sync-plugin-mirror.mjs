#!/usr/bin/env node
// Mirrors repo-root agent-plugin content into plugins/wix/ so the Codex
// marketplace (source.path: "./plugins/wix") sees real files, not symlinks.
// Symlinks break on Windows git checkouts (core.symlinks=false) and on the
// Codex local-plugin cache copy (openai/codex#18863).
//
// Usage:
//   node .github/scripts/sync-plugin-mirror.mjs           # write mode (refresh mirror)
//   node .github/scripts/sync-plugin-mirror.mjs --check   # verify-only (exit 1 on drift)

import { readFile, readdir, stat, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const MIRROR_DIR = join(REPO_ROOT, 'plugins', 'wix');
const ENTRIES = ['.codex-plugin', '.mcp.json', 'assets', 'skills'];

// Refuse to operate on a mirror dir that resolves outside this repo. Catches the case where
// plugins/wix/ has been replaced with a symlink pointing somewhere else.
function assertMirrorPathIsSafe() {
  const realRepo = realpathSync(REPO_ROOT);
  const expectedMirror = join(realRepo, 'plugins', 'wix');

  if (!existsSync(MIRROR_DIR)) return; // first-run, write mode will create it
  const realMirror = realpathSync(MIRROR_DIR);
  if (realMirror !== expectedMirror) {
    throw new Error(
      `refusing to operate: plugins/wix/ resolves to ${realMirror}, expected ${expectedMirror}`,
    );
  }
}

async function listFiles(dir) {
  const out = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(relative(dir, full));
      } else if (entry.isSymbolicLink()) {
        throw new Error(
          `unexpected symlink in source tree: ${relative(REPO_ROOT, full)} — the mirror only ` +
            `supports regular files and directories`,
        );
      }
    }
  }
  await walk(dir);
  return out.sort();
}

async function listEntry(entryName) {
  const sourcePath = join(REPO_ROOT, entryName);
  if (!existsSync(sourcePath)) return [];
  const s = await stat(sourcePath);
  if (s.isFile()) return [entryName];
  if (s.isDirectory()) {
    const files = await listFiles(sourcePath);
    return files.map((f) => join(entryName, f));
  }
  throw new Error(`source entry is neither file nor directory: ${entryName}`);
}

async function readSource(relPath) {
  return readFile(join(REPO_ROOT, relPath));
}

async function readMirror(relPath) {
  return readFile(join(MIRROR_DIR, relPath));
}

async function buildExpectedFileList() {
  const all = [];
  for (const e of ENTRIES) {
    const files = await listEntry(e);
    all.push(...files);
  }
  return all.sort();
}

async function buildActualFileList() {
  if (!existsSync(MIRROR_DIR)) return [];
  const files = await listFiles(MIRROR_DIR);
  return files.sort();
}

async function check() {
  const expected = await buildExpectedFileList();
  const actual = await buildActualFileList();

  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((f) => !actualSet.has(f));
  const extra = actual.filter((f) => !expectedSet.has(f));

  const contentMismatches = [];
  for (const f of expected) {
    if (!actualSet.has(f)) continue;
    const [src, dst] = await Promise.all([readSource(f), readMirror(f)]);
    if (!src.equals(dst)) contentMismatches.push(f);
  }

  if (missing.length === 0 && extra.length === 0 && contentMismatches.length === 0) {
    console.log(`plugins/wix/ mirror is in sync (${expected.length} files).`);
    return 0;
  }

  console.error('plugins/wix/ mirror is out of sync with repo root.');
  if (missing.length > 0) {
    console.error(`  missing in plugins/wix/ (${missing.length}):`);
    for (const f of missing.slice(0, 20)) console.error(`    - ${f}`);
    if (missing.length > 20) console.error(`    … and ${missing.length - 20} more`);
  }
  if (extra.length > 0) {
    console.error(`  extra in plugins/wix/ that have no source (${extra.length}):`);
    for (const f of extra.slice(0, 20)) console.error(`    + ${f}`);
    if (extra.length > 20) console.error(`    … and ${extra.length - 20} more`);
  }
  if (contentMismatches.length > 0) {
    console.error(`  content differs (${contentMismatches.length}):`);
    for (const f of contentMismatches.slice(0, 20)) console.error(`    ~ ${f}`);
    if (contentMismatches.length > 20)
      console.error(`    … and ${contentMismatches.length - 20} more`);
  }
  console.error('');
  console.error('  Run `npm run sync:plugin` and commit the result.');
  return 1;
}

async function write() {
  // Replace the mirror entries wholesale so deletions in the source are reflected.
  for (const e of ENTRIES) {
    const target = join(MIRROR_DIR, e);
    if (existsSync(target)) {
      await rm(target, { recursive: true, force: true });
    }
  }

  const expected = await buildExpectedFileList();
  for (const f of expected) {
    const dst = join(MIRROR_DIR, f);
    await mkdir(dst.substring(0, dst.lastIndexOf(sep)), { recursive: true });
    await copyFile(join(REPO_ROOT, f), dst);
  }
  console.log(`Mirrored ${expected.length} files into plugins/wix/.`);
  return 0;
}

async function main() {
  assertMirrorPathIsSafe();
  await mkdir(MIRROR_DIR, { recursive: true });

  const mode = process.argv.includes('--check') ? 'check' : 'write';
  const exitCode = mode === 'check' ? await check() : await write();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(2);
});
