#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../../../lib/multilingual-public.js');
const report = require('../../../lib/multilingual-public-report.js');
const target = require('../lib/multilingual-target.js');
const { loadAdapter } = require('./multilingual-execute.js');

async function request(projectDir, evidenceRef) {
  if (typeof evidenceRef !== 'string' || !evidenceRef.trim()) throw new Error('evidenceRef is required');
  const scopeDigest = core.digest({ collection: 'ReplatformTranslationRecovery', evidenceRef });
  const value = {
    schemaVersion: 1,
    status: 'requested',
    actionId: core.actionId('LANG_RECOVERY_JOURNAL_REMOVE', scopeDigest.slice(0, 24)),
    scopeDigest,
    evidenceRef,
    requestedAt: new Date().toISOString(),
  };
  await core.writeJsonAtomic(path.join(projectDir, report.JOURNAL_REMOVAL), value);
  return value;
}

async function remove(projectDir, { adapterModule, proofFile }) {
  const file = path.join(projectDir, report.JOURNAL_REMOVAL);
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  if (state.status !== 'requested') throw new Error('journal removal is not requested');
  const decisions = core.readNdjson(path.join(projectDir, report.DECISIONS));
  const authorized = decisions.some((row) => row.kind === 'authorize-journal-removal'
    && row.actionId === state.actionId && row.scopeDigest === state.scopeDigest);
  if (!authorized) throw new Error('journal removal lacks a current owner authorization decision');
  const proof = JSON.parse(await fs.readFile(proofFile, 'utf8'));
  target.requireRouteProof(proof, target.ROUTES.collectionDelete);
  target.requireRouteProof(proof, target.ROUTES.collectionRead);
  const adapter = await loadAdapter(adapterModule, projectDir);
  await adapter.deleteRecoveryCollection('ReplatformTranslationRecovery');
  const read = await adapter.inspectRecoveryCollection();
  if (read?.status !== 'absent') throw new Error('recovery collection absence read-back failed');
  const removed = { ...state, status: 'removed', removedAt: new Date().toISOString(), absenceVerified: true };
  await core.writeJsonAtomic(file, removed);
  return removed;
}

async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  const command = process.argv[3];
  if (!projectDir || !['request', 'remove'].includes(command)) throw new Error('Usage: multilingual-journal-removal.js <projectDir> request|remove [options]');
  if (command === 'request') {
    const evidenceIndex = process.argv.indexOf('--evidence-ref');
    if (evidenceIndex < 0) throw new Error('request requires --evidence-ref <reference>');
    const result = await request(projectDir, process.argv[evidenceIndex + 1]);
    process.stdout.write(`${JSON.stringify({ status: result.status, actionId: result.actionId })}\n`);
    return;
  }
  const adapterIndex = process.argv.indexOf('--adapter');
  const proofIndex = process.argv.indexOf('--proof');
  if (adapterIndex < 0 || proofIndex < 0) throw new Error('remove requires --adapter <module.js> --proof <contract-evidence.json>');
  const result = await remove(projectDir, { adapterModule: process.argv[adapterIndex + 1], proofFile: path.resolve(process.argv[proofIndex + 1]) });
  process.stdout.write(`${JSON.stringify({ status: result.status, absenceVerified: result.absenceVerified })}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { remove, request };
