#!/usr/bin/env node
'use strict';

// Records an import that stopped without recording it (SIGKILL, a crash in finalize): writes an
// `aborted` completion report from the attempt journal, then the discovered-set status and the
// post-execution handoff, so cutover sees the pause. Never resumes or writes to Wix.
const fs = require('node:fs');
const path = require('node:path');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');
const { ensureInterruptedCompletionReport, refreshInterruptedHandoff } = require('../lib/import-interruption.js');

let progress;

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({ script: 'skills/wix-replatform/scripts/interrupted-completion-report.js', ...parsed.progress });
  const step = { phase: 'execution', step: 'interrupted-completion-report' };
  progress.start('Interrupted import report started', step);
  const projectDirArg = parsed.args[0];
  if (!projectDirArg) {
    console.error('Usage: node scripts/interrupted-completion-report.js <projectDir> [--progress-log <path>]');
    progress.error('Missing project directory', step);
    process.exit(1);
  }
  const projectDir = path.resolve(projectDirArg);
  // A report with no interruption is a finished run's record; only a resumed run replaces it.
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(path.join(projectDir, 'execution/completion-report.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && !existing.interruption) {
    console.error('execution/completion-report.json records a finished run; resume the import instead of replacing it');
    progress.error('Completion report already present', step);
    process.exitCode = 1;
    return;
  }
  const interruption = { kind: 'error', code: 'stopped_without_record', at: new Date().toISOString() };
  const result = await ensureInterruptedCompletionReport(projectDir, { interruption });
  const handoff = await refreshInterruptedHandoff(projectDir);
  console.log(JSON.stringify({
    ok: true,
    action: result.action,
    status: result.report.status,
    interruption: result.report.interruption,
    handoff: handoff.ok ? 'written' : handoff.reason,
  }, null, 2));
  progress.complete(`Interrupted import report ${result.action}`, { ...step, artifact: 'execution/completion-report.json' });
}

main().catch((error) => {
  if (progress) progress.error(error && error.message ? error.message : 'Interrupted import report failed', { phase: 'execution', step: 'interrupted-completion-report' });
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
