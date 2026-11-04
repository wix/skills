#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const review = require('../lib/migration-review.js');

function usage() {
  return `Usage:
  node skills/wix-replatform/scripts/migration-review.js <operation> <projectDir> [options]

Mutation operations read one JSON request from --request <path>:
  init | register-execution | capture-evidence | publish-evidence | record-action |
  prepare-handoff | recover-lock

Read operations:
  report | overview | handoff | tasks [--group Data|Manual|Plugins] [--disposition <value>]
         [--offset <n>] [--limit <n>]
  task --task-id <id>
  check-execution --execution-id <id>

All output is one JSON object. The command never edits store JSON through an agent-authored
patch: every mutation goes through the versioned interface and returns a durable receipt.
`;
}

function parseArgs(argv) {
  const result = { operation: argv[0], projectDir: argv[1] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
    result[key] = value;
    i += 1;
  }
  return result;
}

async function requestFrom(args) {
  if (!args.request) throw new Error(`${args.operation} requires --request <json-file>`);
  return JSON.parse(await fs.readFile(path.resolve(args.request), 'utf8'));
}

async function run(args) {
  if (!args.operation || !args.projectDir || args.operation === 'help') throw new Error(usage());
  const projectDir = path.resolve(args.projectDir);
  const mutation = async (fn) => fn(projectDir, await requestFrom(args));
  switch (args.operation) {
    case 'init': return mutation(review.initialize);
    case 'register-execution': return mutation(review.registerExecution);
    case 'capture-evidence': return mutation(review.captureEvidence);
    case 'publish-evidence': return mutation(review.publishEvidence);
    case 'record-action': return mutation(review.recordAction);
    case 'prepare-handoff': return mutation(review.prepareHandoff);
    case 'recover-lock': return mutation(review.recoverLock);
    case 'report': return review.readReport(projectDir);
    case 'overview': return review.overview(projectDir);
    case 'handoff': return { handoff: await review.readLatestHandoff(projectDir) };
    case 'check-execution':
      if (!args.executionId) throw new Error('check-execution requires --execution-id <id>');
      return review.checkExecutionCaptureBoundaries(projectDir, args.executionId);
    case 'tasks': return review.listTasks(projectDir, {
      group: args.group,
      disposition: args.disposition,
      offset: args.offset,
      limit: args.limit,
    });
    case 'task':
      if (!args.taskId) throw new Error('task requires --task-id <id>');
      return review.readTask(projectDir, args.taskId);
    default: throw new Error(`unknown migration-review operation: ${args.operation}\n\n${usage()}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await run(parseArgs(argv));
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: {
        code: error.code || 'invalid_request',
        message: error.message,
        details: error.details || {},
      },
    }, null, 2)}\n`);
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { main, run, parseArgs };
