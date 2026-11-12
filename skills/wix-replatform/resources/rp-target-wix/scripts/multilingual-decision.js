#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../../../lib/multilingual-public.js');
const report = require('../../../lib/multilingual-public-report.js');

async function record(projectDir, input) {
  const existing = core.readNdjson(path.join(projectDir, report.DECISIONS));
  const duplicate = existing.find((row) => row.kind === input.kind && row.actionId === input.actionId
    && row.scopeDigest === input.scopeDigest && row.evidenceRef === input.evidenceRef
    && (row.recoveryRowId || null) === (input.recoveryRowId || null));
  if (duplicate) return duplicate;
  const openActions = report.multilingualReportRows(projectDir).operatorActions.map((row) => ({
    actionId: row.actionId,
    reasonCode: row.reasonCode,
    scopeDigest: row.scopeDigest,
    affectedIds: row.affectedIds,
  }));
  if (input.kind === 'request-restore' && !openActions.some((row) => row.actionId === input.actionId)) {
    const historical = report.candidateActionsForProject(projectDir)
      .find((row) => row.reasonCode === 'LANG_TARGET_TRANSLATION_OVERWRITTEN'
        && row.actionId === input.actionId && row.scopeDigest === input.scopeDigest);
    const acknowledged = existing.some((row) => row.kind === 'ack-overwrite-notice'
      && row.actionId === input.actionId && row.scopeDigest === input.scopeDigest);
    if (historical && acknowledged) openActions.push(historical);
  }
  const entry = core.normalizeDecision(input, openActions, existing);
  await core.appendNdjson(path.join(projectDir, report.DECISIONS), entry);
  return entry;
}

async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  const inputIndex = process.argv.indexOf('--input');
  if (!projectDir || inputIndex < 0 || !process.argv[inputIndex + 1]) throw new Error('Usage: multilingual-decision.js <projectDir> --input <decision.json>');
  const input = JSON.parse(await fs.readFile(path.resolve(process.argv[inputIndex + 1]), 'utf8'));
  const entry = await record(projectDir, input);
  process.stdout.write(`${JSON.stringify({ decisionId: entry.decisionId, actionId: entry.actionId, kind: entry.kind })}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { record };
