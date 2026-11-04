#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../../../lib/multilingual-public.js');
const siteRegional = require('../../../lib/site-regional.js');
const target = require('../../rp-target-wix/lib/multilingual-target.js');
const { loadAdapter } = require('../../rp-target-wix/scripts/multilingual-execute.js');

async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }

async function run(projectDir, { adapterModule, proofFile }) {
  const [topology, proof] = await Promise.all([
    readJson(path.join(projectDir, 'discovery/public-source-languages.json')),
    readJson(proofFile),
  ]);
  const adapter = await loadAdapter(adapterModule, projectDir);
  const current = await adapter.readLocaleState();
  await core.writeJsonAtomic(path.join(projectDir, 'state/multilingual-public/locale-visibility-before.json'), {
    schemaVersion: 1,
    locales: (current.locales || []).map((row) => ({ locale: row.locale, visibility: row.visibility })),
    digest: core.digest((current.locales || []).map((row) => ({ locale: row.locale, visibility: row.visibility }))),
  });
  const decisions = core.readNdjson(path.join(projectDir, 'state/multilingual-public/decisions.ndjson'));
  const siteId = siteRegional.destinationSiteId(projectDir);
  const siteOrigin = siteRegional.siteOriginFor(projectDir, siteId);
  let result;
  try {
    result = await target.executeSetup({
      adapter,
      proof,
      current,
      additionalLocales: (topology.additionalLocales || []).filter((row) => row.state === 'reachable').map((row) => row.locale),
      siteOrigin,
      decisions,
    });
  } catch (error) {
    await core.writeJsonAtomic(path.join(projectDir, 'state/multilingual-public/setup.json'), {
      schemaVersion: 1,
      status: 'failed',
      siteOrigin,
      beforeDigest: core.digest(current),
      requests: error.requests || [],
      failure: { code: error.code || 'LANG_TARGET_PLAN_BLOCKED', route: error.route || null, rowId: 'setup' },
    });
    throw error;
  }
  await core.writeJsonAtomic(path.join(projectDir, 'state/multilingual-public/setup.json'), {
    schemaVersion: 1,
    status: result.status,
    siteOrigin,
    proposal: result.proposal,
    proposalDigest: result.proposalDigest,
    action: result.action,
    beforeDigest: core.digest(current),
    afterDigest: core.digest(result.after),
    requests: result.requests,
  });
  return result;
}

async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  const adapterIndex = process.argv.indexOf('--adapter');
  const proofIndex = process.argv.indexOf('--proof');
  if (!projectDir || adapterIndex < 0 || proofIndex < 0) {
    throw new Error('Usage: multilingual-setup.js <projectDir> --adapter <module.js> --proof <contract-evidence.json>');
  }
  const result = await run(projectDir, { adapterModule: process.argv[adapterIndex + 1], proofFile: path.resolve(process.argv[proofIndex + 1]) });
  process.stdout.write(`${JSON.stringify({ status: result.status, requests: result.requests.length })}\n`);
  if (result.status === 'confirmation-required') process.exitCode = 2;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
