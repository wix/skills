#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const {
  COMPLETION_FILE,
  createMigrationCompletion,
  loadMigrationCompletionInputs,
  validateCompletionArtifacts,
} = require('../lib/migration-completion.js');
const { validateEntityQaAttestation } = require('../lib/entity-qa-attestation.js');
const { loadArtifacts, writeJsonAtomic } = require('../lib/orchestration-state.js');
const { getDecisionValue } = require('../lib/orchestration-decisions.js');

async function main() {
  const projectDirArg = process.argv[2];
  if (!projectDirArg) throw new Error('Usage: node scripts/migration-completion.js <projectDir>');
  const projectDir = path.resolve(projectDirArg);
  const artifacts = await loadArtifacts(projectDir);
  const deliveryMode = getDecisionValue(artifacts.decisions || {}, 'deliveryMode');
  const inputs = await loadMigrationCompletionInputs(projectDir);
  // Surface the completion-artifact refusals as typed reasons the caller can route on, rather than as a
  // bare stack trace. The run is not finished until all four artifacts exist; saying which one
  // is missing is the difference between a fixable stop and a mystery.
  const artifactCheck = validateCompletionArtifacts(inputs);
  if (!artifactCheck.ok) {
    console.error(JSON.stringify({ ok: false, reason: artifactCheck.reason, projectDir }, null, 2));
    process.exit(1);
  }
  // Same treatment for a missing, stale or failed entity-QA attestation -- a typed
  // refusal carrying `entityQa` (the same object the router's refusal carries), not a bare
  // "migration cannot complete" thrown out of createMigrationCompletion.
  const entityQa = validateEntityQaAttestation({
    attestation: inputs.entityQaAttestation,
    report: inputs.backendCompletion,
    reportDigest: inputs.reportDigest,
    mappedEntities: inputs.mappedEntities,
  });
  if (!entityQa.ok) {
    console.error(JSON.stringify({
      ok: false,
      reason: entityQa.reasons[0],
      entityQa: { qaStatus: entityQa.qaStatus, entities: entityQa.entities, recheck: entityQa.recheck },
      projectDir,
    }, null, 2));
    // The CLI refusal prints the Import Operator prompt with the project path
    // and affected entities filled in. A missing or stale attestation (recheck: 'full') has no
    // per-entity list yet -- the whole mapped-entity set needs a fresh pass.
    const entityList = entityQa.entities.length
      ? entityQa.entities.map((entry) => `${entry.entity}/${entry.subtype}`).join(', ')
      : '(all mapped entities -- the attestation is missing or stale)';
    console.error(
      `\nImport Operator action required: in project \`${projectDir}\`, run the entity-by-entity QA pass `
      + 'from `rp-execute-import` against the current completion report, fix the listed entities '
      + 'through a fresh Developer dispatch, then run `scripts/entity-qa-attestation.js` and re-route.\n'
      + `qaStatus: ${entityQa.qaStatus}\n`
      + `Entities to recheck: ${entityList}`,
    );
    process.exit(1);
  }
  const completion = createMigrationCompletion({ deliveryMode, ...inputs });
  const outputPath = path.join(projectDir, COMPLETION_FILE);
  if (inputs.completion?.schemaVersion === 1) {
    const archive = path.join(projectDir, 'completion/migration-completion.v1.json');
    // Preserve the original receipt once; never overwrite its historical bytes.
    await fs.copyFile(outputPath, archive, require('node:fs').constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  await writeJsonAtomic(outputPath, completion);
  console.log(JSON.stringify({ ok: true, outputPath, completion }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, reason: error.code || error.message, staleInputs: error.staleInputs }));
  process.exit(1);
});
