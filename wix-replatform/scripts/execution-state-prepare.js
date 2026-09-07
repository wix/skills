#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { prepareExecutionState } = require('../lib/execution-state.js');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');

let progress;

function usage() {
  console.error(`Usage:
  node scripts/execution-state-prepare.js <projectDir> [--manifest <path>] [--cms-mirror-file <taskId:path>] [--progress-log <path>]

CMS mirror files may be NDJSON or JSON arrays of crosswalk rows. Use one --cms-mirror-file
per import task that has cmsMirror.mode download/download-and-upload.
`);
}

function parseArgs(argv) {
  const args = { cmsMirrorFiles: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--manifest') {
      args.manifest = argv[i + 1];
      i += 1;
    } else if (token === '--cms-mirror-file') {
      args.cmsMirrorFiles.push(argv[i + 1]);
      i += 1;
    } else if (!args.projectDir) {
      args.projectDir = token;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

async function readRows(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error(`${filePath} must contain a JSON array when using JSON format`);
    }
    return parsed;
  }
  return trimmed.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${filePath}:${index + 1} invalid NDJSON: ${error.message}`);
    }
  });
}

async function readMirrorRows(projectDir, specs) {
  const rowsByTaskId = {};
  for (const spec of specs) {
    const separator = spec.indexOf(':');
    if (separator <= 0) {
      throw new Error(`--cms-mirror-file must be <taskId:path>, got: ${spec}`);
    }
    const taskId = spec.slice(0, separator);
    const filePath = path.resolve(projectDir, spec.slice(separator + 1));
    rowsByTaskId[taskId] = await readRows(filePath);
  }
  return rowsByTaskId;
}

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/wix-replatform/scripts/execution-state-prepare.js',
    ...parsed.progress,
  });
  progress.start('Execution state preparation started', { phase: 'execution', step: 'prepare-state' });

  const args = parseArgs(parsed.args);
  if (!args.projectDir) {
    usage();
    progress.error('Missing project directory', { phase: 'execution', step: 'prepare-state' });
    process.exit(1);
  }

  const projectDir = path.resolve(args.projectDir);
  const manifestPath = args.manifest
    ? path.resolve(projectDir, args.manifest)
    : path.join(projectDir, 'execution', 'execution-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const cmsMirrorRowsByTaskId = await readMirrorRows(projectDir, args.cmsMirrorFiles);

  const result = await prepareExecutionState(projectDir, manifest, { cmsMirrorRowsByTaskId });
  console.log(JSON.stringify(result, null, 2));
  if (result.ok) {
    progress.complete('Execution state preparation completed', {
      phase: 'execution',
      step: 'prepare-state',
      artifact: projectDir,
      count: result.actions.length,
      unit: 'actions',
    });
  } else {
    progress.error('Execution state preparation blocked', {
      phase: 'execution',
      step: 'prepare-state',
      artifact: projectDir,
      count: result.errors.length,
      unit: 'errors',
    });
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  if (progress) {
    progress.error(error && error.message ? error.message : 'Execution state preparation failed', {
      phase: 'execution',
      step: 'prepare-state',
    });
  }
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
