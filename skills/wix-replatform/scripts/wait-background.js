#!/usr/bin/env node
'use strict';

// Waits for the toolkit's background work in one project (discovery capture, the source extract,
// the import and its supervisor, any script that writes execution/progress.ndjson) and returns as
// soon as it has ended, done or failed. Use it instead of any hand-written wait loop.
// See lib/background-work.js. Reads only; writes nothing.
//
//   node skills/wix-replatform/scripts/wait-background.js --project <dir> [--script <name>] [--timeout-ms <n>]
//
// --script      wait only for jobs whose script name contains this text
// --timeout-ms  longest wait (default 540000, under a host's 10-minute tool-call limit); 0 = status read
//
// Prints one JSON object. Exit 0: done or idle (nothing running). Exit 1: a job it waited for
// failed (see `failed`). Exit 12: still_running when the timeout passed; run the same command again.
// Exit 2: bad arguments.

const path = require('node:path');
const { waitForBackground } = require('../lib/background-work.js');

const DEFAULT_TIMEOUT_MS = 9 * 60000;
const NEXT = {
  done: 'Background work ended. Continue (read `failed` first, if any).',
  idle: 'Nothing is running. `recent` shows the newest result of each job.',
  still_running: 'Still running. Run the same command again (or end your turn if the host wakes you).',
};

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const project = arg('--project') || argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  const timeout = arg('--timeout-ms');
  const timeoutMs = timeout === null ? DEFAULT_TIMEOUT_MS : Number(timeout);
  if (!project || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    console.log(JSON.stringify({ ok: false, error: 'usage', message: 'wait-background.js --project <dir> [--script <name>] [--timeout-ms <n>]' }));
    return 2;
  }
  const result = waitForBackground(path.resolve(project), { script: arg('--script'), timeoutMs });
  console.log(JSON.stringify({ ok: result.outcome !== 'done' || !result.failed.length, ...result, nextAction: NEXT[result.outcome] }, null, 2));
  if (result.outcome === 'still_running') return 12;
  return result.outcome === 'done' && result.failed.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main };
