#!/usr/bin/env node
'use strict';

// Layer 2 — the committed pre-write gate.
//
// Layer 1 is the generated entrypoint checking itself: `run-import.js` calls
// `assertGeneratedImporterContract` as the first statement of `main()`, so an operator cannot
// skip it. This is the outside check, run before the first write, that catches the importer
// which never emitted that call at all — such an importer also cannot answer `--describe`.
//
// Neither layer replaces the other. Layer 1 covers the run an operator starts directly; layer 2
// is what makes the boundary testable, because a test can spawn a real script the same way the
// suite already spawns execution-state-prepare.js.
//
// This writes no state and touches no target.

const fsSync = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyPluginHandoff } = require('../lib/generated-plugin-handoff.js');
const { parseSelectionArgs } = require('../resources/rp-source-wordpress/lib/plugin-entity-read-plan.js');
const { assertGeneratedImporterContract } = require('../lib/import-recovery.js');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');

const DEFAULT_ENTRYPOINTS = ['src/import/run-import.js'];
const DESCRIBE_TIMEOUT_MS = 30000;

let progress;

function usage() {
  console.error(`Usage:
  node skills/wix-replatform/scripts/import-contract-verify.js <projectDir> [--entrypoint <path>]

Spawns each generated import entrypoint with --describe, parses the single JSON object it
prints, and checks it against the generated-importer contract. Exits non-zero naming every
missing selection mode and every misplaced ledger path. Writes no state, touches no target.

--entrypoint may be repeated; paths are resolved against <projectDir>. When omitted, the
conventional entrypoint ${DEFAULT_ENTRYPOINTS.join(', ')} is used.
`);
}

function parseArgs(argv) {
  const args = { entrypoints: [], selection: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      args.selection = parseSelectionArgs(argv.slice(i + 1));
      break;
    } else if (token === '--extract-entrypoint') {
      args.extractEntrypoint = argv[++i];
    } else if (token === '--entrypoint') {
      args.entrypoints.push(argv[i + 1]);
      i += 1;
    } else if (!args.projectDir) {
      args.projectDir = token;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

// The entrypoint prints ONE JSON object. Generated importers habitually log a banner line
// first, so take the last balanced top-level object rather than demanding a pristine stdout —
// but never guess: unparsable stdout is a gate failure, not a pass.
function parseDescriptor(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) {
    throw new Error('printed nothing on --describe (an entrypoint that ignores --describe fails the gate)');
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`printed no JSON object on --describe: ${trimmed.slice(0, 200)}`);
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch (error) {
    throw new Error(`printed unparsable JSON on --describe: ${error.message}`);
  }
}

function verifyEntrypoint(projectDir, relativePath) {
  const absolute = path.resolve(projectDir, relativePath);
  if (!fsSync.existsSync(absolute)) {
    return { entrypoint: relativePath, ok: false, error: 'entrypoint not found' };
  }
  const described = spawnSync(process.execPath, [absolute, '--describe'], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: DESCRIBE_TIMEOUT_MS,
  });
  if (described.error) {
    return { entrypoint: relativePath, ok: false, error: `could not run --describe: ${described.error.message}` };
  }
  if (described.status !== 0) {
    const detail = (described.stderr || described.stdout || '').trim().slice(0, 400);
    return { entrypoint: relativePath, ok: false, error: `--describe exited ${described.status}: ${detail}` };
  }
  let descriptor;
  try {
    descriptor = parseDescriptor(described.stdout);
  } catch (error) {
    return { entrypoint: relativePath, ok: false, error: error.message };
  }
  try {
    assertGeneratedImporterContract(descriptor);
    const readiness = require('../lib/import-readiness-contract').verifyReadinessContract(projectDir, descriptor);
    if (!readiness.ok) throw new Error(readiness.errors.join(';'));
  } catch (error) {
    return { entrypoint: relativePath, ok: false, error: error.message };
  }
  return { entrypoint: relativePath, ok: true, error: null };
}

function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/wix-replatform/scripts/import-contract-verify.js',
    ...parsed.progress,
  });
  progress.start('Import contract verification started', { phase: 'execution', step: 'verify-import-contract' });

  const args = parseArgs(parsed.args);
  if (!args.projectDir) {
    usage();
    progress.error('Missing project directory', { phase: 'execution', step: 'verify-import-contract' });
    process.exit(1);
  }

  const projectDir = path.resolve(args.projectDir);
  const entrypoints = args.entrypoints.length ? args.entrypoints : DEFAULT_ENTRYPOINTS;
  // Inspect canonical inventory and exact generated bytes BEFORE executing --describe.
  const plugin = verifyPluginHandoff(projectDir, args.selection);
  if (plugin.applicable && entrypoints.some((entrypoint) => entrypoint !== 'src/import/run-import.js')) throw new Error('unsupported generated plugin importer entrypoint');
  if (plugin.applicable && args.extractEntrypoint && args.extractEntrypoint !== 'src/extract/run-extract.js') throw new Error('unsupported generated plugin extractor entrypoint');
  const results = entrypoints.map((entrypoint) => verifyEntrypoint(projectDir, entrypoint));
  const failures = results.filter((result) => !result.ok);

  console.log(JSON.stringify({
    ok: failures.length === 0,
    projectDir,
    entrypoints: results,
  }, null, 2));

  if (failures.length) {
    for (const failure of failures) {
      console.error(`${failure.entrypoint}: ${failure.error}`);
    }
    console.error('Import aborted: the generated importer does not satisfy the entry contract. Route back to codegen — there is no degraded mode and no skip flag.');
    progress.error('Import contract verification failed', {
      phase: 'execution',
      step: 'verify-import-contract',
      artifact: projectDir,
      count: failures.length,
      unit: 'entrypoints',
    });
    process.exit(1);
  }

  progress.complete('Import contract verification passed', {
    phase: 'execution',
    step: 'verify-import-contract',
    artifact: projectDir,
    count: results.length,
    unit: 'entrypoints',
  });
  process.exit(0);
}

try {
  main();
} catch (error) {
  if (progress) {
    progress.error(error && error.message ? error.message : 'Import contract verification failed', {
      phase: 'execution',
      step: 'verify-import-contract',
    });
  }
  console.error(error && error.message ? error.message : error);
  process.exit(1);
}
